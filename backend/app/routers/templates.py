from typing import Annotated
from uuid import UUID
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.auth import get_owner_id
from app.database import get_session
from app.schemas import MutationResponse, TemplateDetails
from app.template_schemas import TemplateCreate, TemplatePatch
from app.services import templates, tracker

router = APIRouter(prefix='/api/templates', tags=['templates'])
Session = Annotated[AsyncSession, Depends(get_session)]
Owner = Annotated[str, Depends(get_owner_id)]


@router.get('', response_model=MutationResponse)
async def list_templates(session: Session, owner_id: Owner):
    async with tracker.owner_transaction(session, owner_id):
        return await tracker.snapshot(session, owner_id)


@router.get('/{identifier}', response_model=TemplateDetails)
async def get_template(identifier: str, session: Session, owner_id: Owner):
    async with tracker.owner_transaction(session, owner_id):
        return await templates.detail(session, owner_id, identifier)


@router.post('', response_model=MutationResponse, status_code=201)
async def create_template(body: TemplateCreate, session: Session, owner_id: Owner):
    async with tracker.owner_transaction(session, owner_id):
        return await templates.create(session, owner_id, body)


@router.patch('/{identifier}', response_model=MutationResponse)
async def edit_template(identifier: UUID, body: TemplatePatch, session: Session, owner_id: Owner):
    async with tracker.owner_transaction(session, owner_id):
        return await templates.edit(session, owner_id, identifier, body)


@router.delete('/{identifier}', response_model=MutationResponse)
async def delete_template(identifier: UUID, session: Session, owner_id: Owner):
    async with tracker.owner_transaction(session, owner_id):
        return await templates.remove(session, owner_id, identifier)
