from typing import Annotated
import secrets

from fastapi import APIRouter, Cookie, Depends, Header, Query, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_owner_id, normalize_guest_id
from app.config import settings
from app.database import get_session
from app.schemas import MutationResponse
from app.services import accounts

router = APIRouter(prefix="/api/auth", tags=["Authentication"])


class AuthResponse(MutationResponse):
    access_token: str | None = None
    token_type: str | None = None
    user: dict | None = None
    message: str | None = None
    retry_after: int | None = None
    authorization_url: str | None = None
    image_url: str | None = None


class RegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=40, pattern=r"^[a-zA-Z0-9_\-.]+$")
    email: EmailStr | None = None
    email_code: str | None = Field(default=None, pattern=r"^\d{6}$")
    password: str = Field(min_length=10, max_length=72)
    migrate_guest: bool = True


class LoginRequest(BaseModel):
    identifier: str = Field(min_length=1, max_length=254)
    password: str = Field(min_length=1, max_length=72)
    migrate_guest: bool = True


class EmailCodeRequest(BaseModel):
    email: EmailStr


class EmailLoginRequest(EmailCodeRequest):
    code: str = Field(pattern=r"^\d{6}$")
    migrate_guest: bool = True


class TicketRequest(BaseModel):
    ticket: str = Field(min_length=30, max_length=128)


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


@router.post("/register", response_model=AuthResponse, status_code=201)
async def register(body: RegisterRequest, request: Request,
                   x_guest_id: Annotated[str | None, Header()] = None,
                   session: AsyncSession = Depends(get_session)):
    guest = normalize_guest_id(x_guest_id)
    return await accounts.register(session, body.username, str(body.email) if body.email else None, body.password,
                                   guest if body.migrate_guest else None, _client_ip(request), body.email_code)


@router.post("/login", response_model=AuthResponse)
async def login(body: LoginRequest, request: Request,
                x_guest_id: Annotated[str | None, Header()] = None,
                session: AsyncSession = Depends(get_session)):
    guest = normalize_guest_id(x_guest_id)
    return await accounts.login(session, body.identifier, body.password,
                                guest if body.migrate_guest else None, _client_ip(request))


@router.post("/email-code", response_model=AuthResponse)
async def request_email_code(body: EmailCodeRequest, request: Request,
                             owner_id: str = Depends(get_owner_id), session: AsyncSession = Depends(get_session)):
    return await accounts.request_email_code(session, str(body.email), owner_id, _client_ip(request))


@router.post("/email-login", response_model=AuthResponse)
async def email_login(body: EmailLoginRequest, request: Request,
                      x_guest_id: Annotated[str | None, Header()] = None,
                      session: AsyncSession = Depends(get_session)):
    guest = normalize_guest_id(x_guest_id)
    return await accounts.email_login(session, str(body.email), body.code,
                                      guest if body.migrate_guest else None, _client_ip(request))


@router.post("/wechat/start", response_model=AuthResponse)
async def start_wechat(request: Request, response: Response, owner_id: str = Depends(get_owner_id),
                       session: AsyncSession = Depends(get_session)):
    browser_secret = secrets.token_urlsafe(32)
    result = await accounts.start_wechat(session, owner_id, browser_secret, _client_ip(request))
    response.set_cookie("pawnsteps_oauth", browser_secret, max_age=600, httponly=True,
                        secure=settings.environment == "production", samesite="lax", path="/api/auth/wechat")
    return result


@router.get("/wechat/callback", include_in_schema=False)
async def wechat_callback(state: str = Query(min_length=20, max_length=128),
                          code: str = Query(min_length=1, max_length=256),
                          pawnsteps_oauth: Annotated[str | None, Cookie()] = None,
                          session: AsyncSession = Depends(get_session)):
    redirect = await accounts.wechat_callback(session, state, code, pawnsteps_oauth)
    return RedirectResponse(redirect, status_code=303, headers={"Referrer-Policy": "no-referrer", "Cache-Control": "no-store"})


@router.post("/wechat/exchange", response_model=AuthResponse)
async def exchange_wechat(body: TicketRequest, response: Response,
                          pawnsteps_oauth: Annotated[str | None, Cookie()] = None,
                          x_guest_id: Annotated[str | None, Header()] = None,
                          session: AsyncSession = Depends(get_session)):
    result = await accounts.exchange_wechat(session, body.ticket, pawnsteps_oauth, normalize_guest_id(x_guest_id))
    response.delete_cookie("pawnsteps_oauth", path="/api/auth/wechat")
    return result
