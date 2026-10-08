from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_admin
from app.database import get_session
from app.routers.auth import AuthResponse, LoginRequest
from app.services import accounts

router = APIRouter(prefix="/api/admin", tags=["Administration"])


@router.post("/login", response_model=AuthResponse)
async def admin_login(body: LoginRequest, request: Request, session: AsyncSession = Depends(get_session)):
    return await accounts.login(session, body.identifier, body.password, None,
                                request.client.host if request.client else "unknown", admin=True)


@router.get("/users")
async def list_users(q: str = Query(default="", max_length=100), offset: int = Query(default=0, ge=0),
                     limit: int = Query(default=50, ge=1, le=100),
                     admin_id: UUID = Depends(require_admin), session: AsyncSession = Depends(get_session)):
    return await accounts.admin_users(session, q, offset, limit)


@router.get("/users/{user_id}")
async def user_data(user_id: UUID, admin_id: UUID = Depends(require_admin),
                    session: AsyncSession = Depends(get_session)):
    return await accounts.admin_user_data(session, user_id)
