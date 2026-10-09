"""Timer routes validate inputs; all persistence lives in the focus service."""
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_owner_id
from app.database import get_session
from app.focus_schemas import FocusSettle, FocusSettingsPatch, FocusStart, FocusState
from app.schemas import MutationResponse
from app.services import focus, tracker

router = APIRouter(prefix='/api/focus', tags=['focus'])
Session = Annotated[AsyncSession, Depends(get_session)]
Owner = Annotated[str, Depends(get_owner_id)]


@router.get('', response_model=FocusState)
async def get_state(session: Session, owner_id: Owner):
    async with tracker.owner_transaction(session, owner_id):
        return await focus.state(session, owner_id)


@router.patch('/settings', response_model=MutationResponse)
async def update_settings(body: FocusSettingsPatch, session: Session, owner_id: Owner):
    async with tracker.owner_transaction(session, owner_id):
        return await focus.update_settings(session, owner_id, body)


@router.post('/start', response_model=MutationResponse, status_code=201)
async def start(body: FocusStart, session: Session, owner_id: Owner):
    async with tracker.owner_transaction(session, owner_id):
        return await focus.start(session, owner_id, body)


@router.post('/{session_id}/pause', response_model=MutationResponse)
async def pause(session_id: UUID, session: Session, owner_id: Owner):
    async with tracker.owner_transaction(session, owner_id):
        return await focus.control(session, owner_id, session_id, 'pause')


@router.post('/{session_id}/resume', response_model=MutationResponse)
async def resume(session_id: UUID, session: Session, owner_id: Owner):
    async with tracker.owner_transaction(session, owner_id):
        return await focus.control(session, owner_id, session_id, 'resume')


@router.post('/{session_id}/end', response_model=MutationResponse)
async def end(session_id: UUID, session: Session, owner_id: Owner):
    async with tracker.owner_transaction(session, owner_id):
        return await focus.control(session, owner_id, session_id, 'end')


@router.post('/{session_id}/settle', response_model=MutationResponse)
async def settle(session_id: UUID, body: FocusSettle, session: Session, owner_id: Owner):
    async with tracker.owner_transaction(session, owner_id):
        return await focus.settle(session, owner_id, session_id, body)


@router.post('/{session_id}/notify', response_model=MutationResponse)
async def notify(session_id: UUID, session: Session, owner_id: Owner):
    async with tracker.owner_transaction(session, owner_id):
        return await focus.claim_notification(session, owner_id, session_id)
