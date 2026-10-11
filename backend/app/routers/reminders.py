from typing import Annotated
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.auth import get_owner_id
from app.database import get_session
from app.reminder_schemas import ReminderClaim, ReminderReceipt, ReminderState
from app.schemas import MutationResponse
from app.services import reminders, tracker

router = APIRouter(prefix='/api/reminders', tags=['reminders'])
Session = Annotated[AsyncSession, Depends(get_session)]
Owner = Annotated[str, Depends(get_owner_id)]


@router.get('', response_model=ReminderState)
async def configuration(owner_id: Owner):
    return reminders.state()


@router.post('/claim', response_model=MutationResponse)
async def claim(body: ReminderClaim, session: Session, owner_id: Owner):
    async with tracker.owner_transaction(session, owner_id):
        return await reminders.claim(session, owner_id, body)


@router.post('/ack', response_model=MutationResponse)
async def acknowledge(body: ReminderReceipt, session: Session, owner_id: Owner):
    async with tracker.owner_transaction(session, owner_id):
        return await reminders.settle(session, owner_id, body, True)


@router.post('/release', response_model=MutationResponse)
async def release(body: ReminderReceipt, session: Session, owner_id: Owner):
    async with tracker.owner_transaction(session, owner_id):
        return await reminders.settle(session, owner_id, body, False)
