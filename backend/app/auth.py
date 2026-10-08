"""Strict user/administrator JWT authentication and unguessable guest ownership."""
from datetime import datetime, timedelta, timezone
from typing import Annotated
from uuid import UUID

from anyio import to_thread
from fastapi import Depends, Header, HTTPException
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_session

password_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
DUMMY_PASSWORD_HASH = password_context.hash("unusable-account-timing-placeholder")


def normalize_guest_id(value: str | None) -> str | None:
    if value is None:
        return None
    try:
        parsed = UUID(value)
    except (ValueError, TypeError, AttributeError) as exc:
        raise HTTPException(400, "Invalid X-Guest-Id; a random UUID is required") from exc
    if parsed.version != 4:
        raise HTTPException(400, "X-Guest-Id must be a random UUID v4")
    return f"guest:{parsed}"


def validate_password(password: str) -> None:
    if len(password) < 10 or len(password.encode("utf-8")) > 72:
        raise HTTPException(422, "Password must contain at least 10 characters and at most 72 UTF-8 bytes")


async def hash_password(password: str) -> str:
    validate_password(password)
    return await to_thread.run_sync(password_context.hash, password)


async def verify_password(password: str, hashed: str | None) -> bool:
    if len(password.encode("utf-8")) > 72:
        return False
    valid = await to_thread.run_sync(password_context.verify, password, hashed or DUMMY_PASSWORD_HASH)
    return bool(hashed and valid)


def create_access_token(user, *, admin: bool = False) -> str:
    now = datetime.now(timezone.utc)
    return jwt.encode(
        {"sub": str(user.id), "aud": "pawnsteps-admin" if admin else "pawnsteps", "iss": "pawnsteps",
         "role": "admin" if admin else "user", "ver": user.token_version,
         "iat": now, "exp": now + timedelta(days=30)},
        settings.jwt_secret, algorithm="HS256",
    )


def decode_access_token(authorization: str, *, admin: bool = False) -> dict:
    scheme, separator, token = authorization.partition(" ")
    if not separator or scheme.lower() != "bearer" or not token or " " in token:
        raise HTTPException(401, "Invalid authorization header", headers={"WWW-Authenticate": "Bearer"})
    try:
        claims = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"],
                            audience="pawnsteps-admin" if admin else "pawnsteps", issuer="pawnsteps",
                            options={"require_exp": True, "require_iat": True, "require_sub": True})
        UUID(claims["sub"])
        if claims.get("role") != ("admin" if admin else "user") or not isinstance(claims.get("ver"), int):
            raise ValueError("Invalid token role or version")
        return claims
    except (JWTError, ValueError, KeyError, TypeError) as exc:
        raise HTTPException(401, "Your session has expired. Please sign in again.",
                            headers={"WWW-Authenticate": "Bearer"}) from exc


async def get_owner_id(
    authorization: Annotated[str | None, Header()] = None,
    x_guest_id: Annotated[str | None, Header()] = None,
    session: AsyncSession = Depends(get_session),
) -> str:
    if authorization is not None:
        claims = decode_access_token(authorization)
        from app.services.accounts import session_user
        user = await session_user(session, claims)
        return f"user:{user.id}"
    guest_owner = normalize_guest_id(x_guest_id)
    if guest_owner is None:
        raise HTTPException(401, "Sign in or provide X-Guest-Id", headers={"WWW-Authenticate": "Bearer"})
    return guest_owner


async def require_user(owner_id: str = Depends(get_owner_id)) -> UUID:
    if not owner_id.startswith("user:"):
        raise HTTPException(401, "Please sign in to access your account")
    return UUID(owner_id.split(":", 1)[1])


async def require_admin(
    authorization: Annotated[str | None, Header()] = None,
    session: AsyncSession = Depends(get_session),
) -> UUID:
    if authorization is None:
        raise HTTPException(401, "Administrator sign-in required")
    claims = decode_access_token(authorization, admin=True)
    from app.services.accounts import session_user
    user = await session_user(session, claims)
    if not user.is_admin:
        raise HTTPException(403, "Administrator permission required")
    return user.id
