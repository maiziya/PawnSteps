from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_owner_id
from app.database import get_session
from app.schemas import CourseUpdate, HistoryResponse, MutationResponse, ProgressUpdate, Reorder, RewardCreate, RewardPatch, TaskCreate, TaskPatch, UndoRequest
from app.services import tracker


router = APIRouter(prefix='/api', tags=['tracking'])
Session = Annotated[AsyncSession, Depends(get_session)]
OwnerId = Annotated[str, Depends(get_owner_id)]


@router.get('/state', response_model=MutationResponse)
@router.get('/tasks', response_model=MutationResponse)
@router.get('/rewards', response_model=MutationResponse)
async def state(session: Session, owner_id: OwnerId):
    async with tracker.owner_transaction(session, owner_id):
        return await tracker.snapshot(session, owner_id)


@router.get('/history', response_model=HistoryResponse)
async def history(session: Session, owner_id: OwnerId, month: str | None = Query(default=None, pattern=r'^\d{4}-\d{2}$')):
    async with tracker.owner_transaction(session, owner_id):
        return await tracker.history(session, owner_id, month)


@router.post('/tasks', response_model=MutationResponse, status_code=201)
async def create_task(body: TaskCreate, session: Session, owner_id: OwnerId):
    async with tracker.owner_transaction(session, owner_id):
        return await tracker.create_task(session, owner_id, body)


@router.post('/tasks/reorder', response_model=MutationResponse)
async def reorder_tasks(body: Reorder, session: Session, owner_id: OwnerId):
    async with tracker.owner_transaction(session, owner_id):
        return await tracker.reorder_tasks(session, owner_id, body.ids)


@router.post('/tasks/undo', response_model=MutationResponse)
async def undo_task(body: UndoRequest, session: Session, owner_id: OwnerId):
    async with tracker.owner_transaction(session, owner_id):
        return await tracker.undo_task(session, owner_id, body.token)


@router.patch('/tasks/{task_id}', response_model=MutationResponse)
async def update_task(task_id: UUID, body: TaskPatch, session: Session, owner_id: OwnerId):
    async with tracker.owner_transaction(session, owner_id):
        return await tracker.update_task(session, owner_id, task_id, body)


@router.post('/tasks/{task_id}/progress', response_model=MutationResponse)
async def set_progress(task_id: UUID, body: ProgressUpdate, session: Session, owner_id: OwnerId):
    async with tracker.owner_transaction(session, owner_id):
        return await tracker.set_progress(session, owner_id, task_id, body.progress)


@router.post('/tasks/{task_id}/daily', response_model=MutationResponse)
async def set_daily(task_id: UUID, body: ProgressUpdate, session: Session, owner_id: OwnerId):
    async with tracker.owner_transaction(session, owner_id):
        return await tracker.set_daily(session, owner_id, task_id, body.progress)


@router.post('/tasks/{task_id}/daily/undo', response_model=MutationResponse)
async def undo_daily(task_id: UUID, session: Session, owner_id: OwnerId):
    async with tracker.owner_transaction(session, owner_id):
        return await tracker.set_daily(session, owner_id, task_id, 0, undo=True)


@router.post('/tasks/{task_id}/course', response_model=MutationResponse)
async def set_course(task_id: UUID, body: CourseUpdate, session: Session, owner_id: OwnerId):
    async with tracker.owner_transaction(session, owner_id):
        return await tracker.set_course(session, owner_id, task_id, body)


@router.delete('/tasks/{task_id}', response_model=MutationResponse)
async def delete_task(task_id: UUID, session: Session, owner_id: OwnerId):
    async with tracker.owner_transaction(session, owner_id):
        return await tracker.delete_task(session, owner_id, task_id)


@router.post('/rewards', response_model=MutationResponse, status_code=201)
async def create_reward(body: RewardCreate, session: Session, owner_id: OwnerId):
    async with tracker.owner_transaction(session, owner_id):
        return await tracker.create_reward(session, owner_id, body)


@router.post('/rewards/reorder', response_model=MutationResponse)
async def reorder_rewards(body: Reorder, session: Session, owner_id: OwnerId):
    async with tracker.owner_transaction(session, owner_id):
        return await tracker.reorder_rewards(session, owner_id, body.ids)


@router.patch('/rewards/{reward_id}', response_model=MutationResponse)
async def update_reward(reward_id: UUID, body: RewardPatch, session: Session, owner_id: OwnerId):
    async with tracker.owner_transaction(session, owner_id):
        return await tracker.update_reward(session, owner_id, reward_id, body)


@router.delete('/rewards/{reward_id}', response_model=MutationResponse)
async def delete_reward(reward_id: UUID, session: Session, owner_id: OwnerId):
    async with tracker.owner_transaction(session, owner_id):
        return await tracker.delete_reward(session, owner_id, reward_id)
