"""Account lifecycle, provider authentication and tenant-safe account administration."""
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
import hashlib
import hmac
import logging
import secrets
import smtplib
import ssl
from urllib.parse import urlencode
from uuid import UUID, uuid4

from anyio import to_thread
from fastapi import HTTPException
import httpx
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import create_access_token, hash_password, verify_password
from app.config import settings
from app.models import AuthRate, AuthState, DailyHistory, EmailCode, Owner, Reward, Task, User
from app.services import tracker
from app.services.storage import save_image

logger = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def public_user(user: User) -> dict:
    return {"id": str(user.id), "username": user.username, "email": user.email,
            "avatar_url": user.avatar_url, "is_premium": user.is_premium,
            "has_password": bool(user.password_hash), "created_at": user.created_at}


async def session_user(session: AsyncSession, claims: dict) -> User:
    user = await session.get(User, UUID(claims["sub"]))
    if user is None or user.token_version != claims["ver"]:
        raise HTTPException(401, "Your session has expired. Please sign in again.")
    return user


async def _user(session: AsyncSession, user_id: UUID) -> User:
    user = await session.get(User, user_id, populate_existing=True)
    if user is None:
        raise HTTPException(404, "Account not found")
    return user


async def _rate_limit(session: AsyncSession, key: str, limit: int, seconds: int) -> None:
    """Persist the counter before credentials are checked, including unsuccessful requests."""
    digest = hashlib.sha256(key.encode()).hexdigest()
    now = _now()
    # Savepoint makes initial creation safe across concurrent workers.
    if await session.get(AuthRate, digest) is None:
        try:
            async with session.begin_nested():
                session.add(AuthRate(key=digest, count=0, window_start=now))
                await session.flush()
        except IntegrityError:
            pass
    await session.execute(update(AuthRate).where(
        AuthRate.key == digest, AuthRate.window_start <= now - timedelta(seconds=seconds)
    ).values(count=0, window_start=now))
    result = await session.execute(update(AuthRate).where(
        AuthRate.key == digest, AuthRate.count < limit
    ).values(count=AuthRate.count + 1).returning(AuthRate.count))
    count = result.scalar_one_or_none()
    await session.commit()
    if count is None:
        raise HTTPException(429, "Too many attempts. Please try again later.", headers={"Retry-After": str(seconds)})


async def migrate_guest(session: AsyncSession, guest_owner: str | None, user: User) -> None:
    if not guest_owner:
        return
    user_owner = f"user:{user.id}"
    await tracker.ensure_owner(session, guest_owner)
    await tracker.ensure_owner(session, user_owner)
    # A stable lock order protects a shared guest namespace from concurrent logins.
    await session.execute(select(Owner).where(Owner.id.in_([guest_owner, user_owner])).order_by(Owner.id).with_for_update())
    user_rewards = list((await session.scalars(select(Reward).where(Reward.owner_id == user_owner))).all())
    milestones = {reward.streak_target: reward for reward in user_rewards if reward.streak_target is not None}
    guest_rewards = list((await session.scalars(select(Reward).where(Reward.owner_id == guest_owner))).all())
    duplicates = []
    for reward in guest_rewards:
        existing = milestones.get(reward.streak_target) if reward.streak_target is not None else None
        if existing:
            existing.is_unlocked = existing.is_unlocked or reward.is_unlocked
            existing.streak_claimed = existing.streak_claimed or reward.streak_claimed
            await session.execute(update(Task).where(Task.owner_id == guest_owner, Task.reward_id == reward.id)
                                  .values(reward_id=existing.id))
            duplicates.append(reward)
        else:
            reward.owner_id = user_owner
    await session.flush()
    for reward in duplicates:
        await session.delete(reward)
    existing_names = set((await session.scalars(select(Task.name).where(Task.owner_id == user_owner))).all())
    tasks = list((await session.scalars(select(Task).where(Task.owner_id == guest_owner).order_by(Task.created_at, Task.id))).all())
    for task in tasks:
        original, name, suffix = task.name, task.name, 2
        while name in existing_names:
            ending = f" ({suffix})"
            name = original[:100 - len(ending)] + ending
            suffix += 1
        task.name = name
        task.owner_id = user_owner
        existing_names.add(name)
    await session.flush()


async def _auth_response(session: AsyncSession, user: User, guest_owner: str | None, *, admin: bool = False) -> dict:
    owner_id = f"user:{user.id}"
    owners = [owner_id, guest_owner] if guest_owner and not admin else [owner_id]
    async with tracker.owners_transaction(session, owners):
        if not admin:
            await migrate_guest(session, guest_owner, user)
        result = await tracker.snapshot(session, owner_id)
        response = {**result, "access_token": create_access_token(user, admin=admin), "token_type": "bearer",
                    "user": public_user(user)}
    return response


async def register(session: AsyncSession, username: str, email: str | None, password: str,
                   guest_owner: str | None, client_ip: str, email_code: str | None = None) -> dict:
    await _rate_limit(session, f"register:{client_ip}", 10, 3600)
    username = username.strip().lower()
    email = email.lower() if email else None
    if await session.scalar(select(User.id).where(or_(User.username == username,
                                                     User.email == email if email else False))):
        raise HTTPException(409, "Username or email is already in use")
    if email:
        if not email_code:
            raise HTTPException(422, "Verify your email address before registering it")
        await _consume_email_code(session, email, email_code)
    user = User(id=uuid4(), username=username, email=email, password_hash=await hash_password(password))
    session.add(user)
    try:
        await session.flush()
        return await _auth_response(session, user, guest_owner)
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(409, "Username or email is already in use") from exc


async def login(session: AsyncSession, identifier: str, password: str, guest_owner: str | None,
                client_ip: str, *, admin: bool = False) -> dict:
    identifier = identifier.strip().lower()
    await _rate_limit(session, f"login-ip:{client_ip}", 60, 900)
    await _rate_limit(session, f"login-account:{identifier}", 12, 900)
    user = await session.scalar(select(User).where(or_(User.username == identifier, User.email == identifier)))
    valid = await verify_password(password, user.password_hash if user else None)
    if not valid or user is None or (admin and not user.is_admin):
        raise HTTPException(401, "Incorrect account or password")
    return await _auth_response(session, user, guest_owner, admin=admin)


def _email_code_digest(email: str, code: str) -> str:
    return hmac.new(settings.jwt_secret.encode(), f"email-code:{email.lower()}:{code}".encode(), hashlib.sha256).hexdigest()


async def _send_email(email: str, code: str) -> None:
    if not settings.smtp_host:
        if settings.environment != "production" and settings.smtp_allow_console:
            logger.warning("Development-only email code for %s: %s", email, code)
            return
        raise HTTPException(503, "Email sign-in is not configured")
    message = EmailMessage()
    message["Subject"] = "PawnSteps sign-in code"
    message["From"] = settings.smtp_from
    message["To"] = email
    message.set_content(f"Your PawnSteps sign-in code is {code}. It expires in 10 minutes. Do not share this code.")

    def send() -> None:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as smtp:
            smtp.ehlo()
            if settings.smtp_use_tls:
                smtp.starttls(context=ssl.create_default_context())
                smtp.ehlo()
            if settings.smtp_username:
                smtp.login(settings.smtp_username, settings.smtp_password)
            smtp.send_message(message)
    try:
        await to_thread.run_sync(send)
    except (smtplib.SMTPException, OSError) as exc:
        raise HTTPException(503, "Email delivery is temporarily unavailable") from exc


async def request_email_code(session: AsyncSession, email: str, owner_id: str, client_ip: str) -> dict:
    email = email.lower()
    await _rate_limit(session, f"email-ip:{client_ip}", 15, 3600)
    await _rate_limit(session, f"email-address-hour:{email}", 8, 3600)
    await _rate_limit(session, f"email-address-minute:{email}", 1, 60)
    code = f"{secrets.randbelow(1_000_000):06d}"
    record = await session.get(EmailCode, email)
    if record is None:
        record = EmailCode(email=email)
        session.add(record)
    record.code = _email_code_digest(email, code)
    record.expires_at = _now() + timedelta(minutes=10)
    record.sent_at = _now()
    record.attempts = 0
    await _send_email(email, code)
    await session.flush()
    async with tracker.owner_transaction(session, owner_id):
        result = await tracker.snapshot(session, owner_id)
    return {**result, "message": "Verification code sent", "retry_after": 60}


async def _consume_email_code(session: AsyncSession, email: str, code: str) -> None:
    # Atomic update limits attempts and takes a write lock on SQLite/Postgres.
    record = (await session.execute(update(EmailCode).where(
        EmailCode.email == email, EmailCode.expires_at > _now(), EmailCode.attempts < 5,
    ).values(attempts=EmailCode.attempts + 1).returning(EmailCode))).scalar_one_or_none()
    if record is None:
        await session.commit()
        raise HTTPException(401, "Verification code is invalid or expired")
    if not hmac.compare_digest(record.code, _email_code_digest(email, code)):
        await session.commit()
        raise HTTPException(401, "Verification code is invalid or expired")
    await session.delete(record)


async def email_login(session: AsyncSession, email: str, code: str, guest_owner: str | None,
                      client_ip: str) -> dict:
    email = email.lower()
    await _rate_limit(session, f"email-login-ip:{client_ip}", 30, 900)
    await _consume_email_code(session, email, code)
    user = await session.scalar(select(User).where(User.email == email))
    if user is None:
        user = User(id=uuid4(), username=f"member_{secrets.token_hex(5)}", email=email)
        session.add(user)
        await session.flush()
    return await _auth_response(session, user, guest_owner)


def _opaque_hash(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


async def start_wechat(session: AsyncSession, owner_id: str, browser_secret: str, client_ip: str) -> dict:
    if not settings.wechat_app_id or not settings.wechat_app_secret or not settings.wechat_redirect_uri:
        raise HTTPException(503, "WeChat sign-in is not configured")
    await _rate_limit(session, f"wechat-start:{client_ip}", 20, 600)
    await session.execute(delete(AuthState).where(AuthState.expires_at < _now()))
    state = secrets.token_urlsafe(32)
    session.add(AuthState(id=_opaque_hash(state), purpose="wechat-state",
                          guest_owner=owner_id if owner_id.startswith("guest:") else None,
                          browser_hash=_opaque_hash(browser_secret), expires_at=_now() + timedelta(minutes=10)))
    query = urlencode({"appid": settings.wechat_app_id, "redirect_uri": settings.wechat_redirect_uri,
                       "response_type": "code", "scope": "snsapi_login", "state": state})
    async with tracker.owner_transaction(session, owner_id):
        result = await tracker.snapshot(session, owner_id)
    return {**result, "authorization_url": f"https://open.weixin.qq.com/connect/qrconnect?{query}#wechat_redirect"}


async def wechat_callback(session: AsyncSession, state: str, code: str, browser_secret: str | None) -> str:
    if not browser_secret:
        raise HTTPException(401, "WeChat session expired. Start sign-in again.")
    record = (await session.execute(delete(AuthState).where(
        AuthState.id == _opaque_hash(state), AuthState.purpose == "wechat-state",
        AuthState.browser_hash == _opaque_hash(browser_secret), AuthState.expires_at > _now(),
    ).returning(AuthState))).scalar_one_or_none()
    if record is None:
        raise HTTPException(401, "WeChat state is invalid or expired")
    guest_owner = record.guest_owner
    await session.commit()
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.get("https://api.weixin.qq.com/sns/oauth2/access_token", params={
                "appid": settings.wechat_app_id, "secret": settings.wechat_app_secret,
                "code": code, "grant_type": "authorization_code",
            })
            response.raise_for_status()
            identity = response.json()
            if identity.get("errcode") or not identity.get("openid") or not identity.get("access_token"):
                raise HTTPException(401, "WeChat authorization failed. Start sign-in again.")
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(502, "WeChat is temporarily unavailable") from exc
    openid = identity["openid"]
    user = await session.scalar(select(User).where(User.wechat_openid == openid))
    if user is None:
        user = User(id=uuid4(), username=f"wechat_{secrets.token_hex(5)}", wechat_openid=openid)
        session.add(user)
        try:
            await session.flush()
        except IntegrityError:
            await session.rollback()
            user = await session.scalar(select(User).where(User.wechat_openid == openid))
            if user is None:
                raise HTTPException(409, "Please retry WeChat sign-in")
    ticket = secrets.token_urlsafe(40)
    session.add(AuthState(id=_opaque_hash(ticket), purpose="wechat-ticket", guest_owner=guest_owner,
                          user_id=user.id, browser_hash=_opaque_hash(browser_secret),
                          expires_at=_now() + timedelta(minutes=2)))
    await session.commit()
    # Only a short-lived, single-use, browser-bound ticket appears in the redirect fragment.
    return f"{settings.frontend_url.rstrip('/')}/auth/callback#ticket={ticket}"


async def exchange_wechat(session: AsyncSession, ticket: str, browser_secret: str | None,
                           guest_owner: str | None) -> dict:
    if not browser_secret:
        raise HTTPException(401, "WeChat session expired")
    record = (await session.execute(delete(AuthState).where(
        AuthState.id == _opaque_hash(ticket), AuthState.purpose == "wechat-ticket",
        AuthState.browser_hash == _opaque_hash(browser_secret), AuthState.expires_at > _now(),
    ).returning(AuthState))).scalar_one_or_none()
    if record is None:
        raise HTTPException(401, "WeChat ticket is invalid or expired")
    if record.guest_owner is not None and record.guest_owner != guest_owner:
        raise HTTPException(401, "The original guest session is required")
    user = await _user(session, record.user_id)
    return await _auth_response(session, user, record.guest_owner)


async def profile(session: AsyncSession, user_id: UUID) -> dict:
    async with tracker.owner_transaction(session, f"user:{user_id}"):
        user = await _user(session, user_id)
        result = {**await tracker.snapshot(session, f"user:{user.id}"), "user": public_user(user)}
    return result


async def update_profile(session: AsyncSession, user_id: UUID, username: str) -> dict:
    async with tracker.owner_transaction(session, f"user:{user_id}"):
        user = await _user(session, user_id)
        username = username.strip().lower()
        if await session.scalar(select(User.id).where(User.username == username, User.id != user.id)):
            raise HTTPException(409, "Username is already in use")
        user.username = username
        await session.flush()
        result = {**await tracker.snapshot(session, f"user:{user.id}"), "user": public_user(user)}
    return result


async def change_password(session: AsyncSession, user_id: UUID, current_password: str | None,
                          new_password: str) -> dict:
    await _rate_limit(session, f"password-change:{user_id}", 8, 900)
    async with tracker.owner_transaction(session, f"user:{user_id}"):
        user = await _user(session, user_id)
        if user.password_hash and (not current_password or not await verify_password(current_password, user.password_hash)):
            raise HTTPException(401, "Current password is incorrect")
        user.password_hash = await hash_password(new_password)
        user.token_version += 1
        await session.flush()
        result = {**await tracker.snapshot(session, f"user:{user.id}"), "user": public_user(user),
                  "access_token": create_access_token(user), "token_type": "bearer"}
    return result


async def update_avatar(session: AsyncSession, user_id: UUID, upload) -> dict:
    await _rate_limit(session, f"image-upload:user:{user_id}", 30, 3600)
    image_url = await save_image(upload, f"user:{user_id}")
    async with tracker.owner_transaction(session, f"user:{user_id}"):
        user = await _user(session, user_id)
        user.avatar_url = image_url
        await session.flush()
        result = {**await tracker.snapshot(session, f"user:{user.id}"), "user": public_user(user), "image_url": image_url}
    return result


async def export_data(session: AsyncSession, user_id: UUID) -> dict:
    async with tracker.owner_transaction(session, f"user:{user_id}"):
        user = await _user(session, user_id)
        state = await tracker.snapshot(session, f"user:{user.id}")
        history = (await session.execute(select(DailyHistory, Task.name).join(Task, Task.id == DailyHistory.task_id)
            .where(Task.owner_id == f"user:{user.id}").order_by(DailyHistory.date, Task.name))).all()
        result = {"format_version": 1, "exported_at": _now(), "user": public_user(user), **state,
                  "daily_history": [{"task_id": str(entry.task_id), "task_name": name,
                                     "date": entry.date, "completed": entry.completed} for entry, name in history]}
    return result


async def admin_users(session: AsyncSession, query: str, offset: int, limit: int) -> dict:
    predicate = or_(User.username.ilike(f"%{query}%"), User.email.ilike(f"%{query}%")) if query else True
    total = await session.scalar(select(func.count()).select_from(User).where(predicate))
    users = (await session.scalars(select(User).where(predicate).order_by(User.created_at.desc())
                                   .offset(offset).limit(limit))).all()
    return {"users": [{**public_user(user), "is_admin": user.is_admin} for user in users],
            "total": total, "offset": offset, "limit": limit}


async def admin_user_data(session: AsyncSession, user_id: UUID) -> dict:
    return await export_data(session, user_id)


async def create_admin(session: AsyncSession) -> str:
    if not settings.admin_username or not settings.admin_password:
        raise RuntimeError("Set ADMIN_USERNAME and ADMIN_PASSWORD before bootstrapping an administrator")
    username = settings.admin_username.strip().lower()
    user = await session.scalar(select(User).where(User.username == username))
    if user is not None:
        if not user.is_admin:
            raise RuntimeError("An ordinary account already uses ADMIN_USERNAME; choose a separate administrator name")
        return "Administrator already exists; password unchanged"
    session.add(User(id=uuid4(), username=username, email=settings.admin_email or None,
                     password_hash=await hash_password(settings.admin_password), is_admin=True))
    await session.commit()
    return "Administrator created"


async def upload_image(session: AsyncSession, owner_id: str, upload) -> dict:
    await _rate_limit(session, f"image-upload:{owner_id}", 30, 3600)
    image_url = await save_image(upload, owner_id)
    async with tracker.owner_transaction(session, owner_id):
        result = await tracker.snapshot(session, owner_id)
    return {**result, "image_url": image_url}


async def health(session: AsyncSession) -> dict:
    await session.execute(select(1))
    return {"status": "ok", "service": "pawnsteps-api"}
