from uuid import UUID

from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_owner_id, require_user
from app.database import get_session
from app.routers.auth import AuthResponse
from app.services import accounts

router = APIRouter(prefix="/api", tags=["Profile and uploads"])


class ProfileUpdate(BaseModel):
    username: str = Field(min_length=3, max_length=40, pattern=r"^[a-zA-Z0-9_\-.]+$")


class PasswordUpdate(BaseModel):
    current_password: str | None = Field(default=None, max_length=72)
    new_password: str = Field(min_length=10, max_length=72)


@router.get("/profile", response_model=AuthResponse)
async def get_profile(user_id: UUID = Depends(require_user), session: AsyncSession = Depends(get_session)):
    return await accounts.profile(session, user_id)


@router.patch("/profile", response_model=AuthResponse)
async def update_profile(body: ProfileUpdate, user_id: UUID = Depends(require_user),
                         session: AsyncSession = Depends(get_session)):
    return await accounts.update_profile(session, user_id, body.username)


@router.post("/profile/password", response_model=AuthResponse)
async def change_password(body: PasswordUpdate, user_id: UUID = Depends(require_user),
                          session: AsyncSession = Depends(get_session)):
    return await accounts.change_password(session, user_id, body.current_password, body.new_password)


@router.post("/profile/avatar", response_model=AuthResponse)
async def upload_avatar(file: UploadFile = File(), user_id: UUID = Depends(require_user),
                        session: AsyncSession = Depends(get_session)):
    return await accounts.update_avatar(session, user_id, file)


@router.get("/profile/export")
async def export_data(user_id: UUID = Depends(require_user), session: AsyncSession = Depends(get_session)):
    result = await accounts.export_data(session, user_id)
    return JSONResponse(jsonable_encoder(result), headers={"Content-Disposition": 'attachment; filename="pawnsteps-export.json"'})


@router.post("/uploads", response_model=AuthResponse)
async def upload_image(file: UploadFile = File(), owner_id: str = Depends(get_owner_id),
                       session: AsyncSession = Depends(get_session)):
    return await accounts.upload_image(session, owner_id, file)
