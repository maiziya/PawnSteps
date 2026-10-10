"""Owner-scoped classification; the task ledger remains unchanged."""
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Task, TaskCategory
from app.schemas import CategoryCreate, CategoryPatch
from app.services import tracker


async def get_category(session: AsyncSession, owner_id: str, category_id: UUID) -> TaskCategory:
    category = await session.scalar(select(TaskCategory).where(TaskCategory.id == category_id, TaskCategory.owner_id == owner_id))
    if category is None:
        raise HTTPException(404, 'Category not found')
    return category


async def unique_name(session: AsyncSession, owner_id: str, name: str, except_id: UUID | None = None) -> None:
    rows = (await session.scalars(select(TaskCategory).where(TaskCategory.owner_id == owner_id))).all()
    if any(row.id != except_id and row.name.casefold() == name.casefold() for row in rows):
        raise HTTPException(409, 'A category with this name already exists')


async def create(session: AsyncSession, owner_id: str, body: CategoryCreate) -> dict:
    await tracker.ensure_owner(session, owner_id)
    await unique_name(session, owner_id, body.name)
    positions = (await session.scalars(select(TaskCategory.position).where(TaskCategory.owner_id == owner_id))).all()
    session.add(TaskCategory(owner_id=owner_id, name=body.name, color=body.color, position=max(positions, default=-1) + 1))
    await session.flush()
    return await tracker.snapshot(session, owner_id)


async def edit(session: AsyncSession, owner_id: str, category_id: UUID, body: CategoryPatch) -> dict:
    category = await get_category(session, owner_id, category_id)
    if body.name is not None:
        await unique_name(session, owner_id, body.name, category.id)
    for key, value in body.model_dump(exclude_unset=True).items():
        setattr(category, key, value)
    await session.flush()
    return await tracker.snapshot(session, owner_id)


async def remove(session: AsyncSession, owner_id: str, category_id: UUID) -> dict:
    category = await get_category(session, owner_id, category_id)
    # Include deleted and archived tasks so restore/undo cannot revive a removed category.
    await session.execute(update(Task).where(Task.owner_id == owner_id, Task.category_id == category.id).values(category_id=None))
    await session.delete(category)
    await session.flush()
    return await tracker.snapshot(session, owner_id)


async def reorder(session: AsyncSession, owner_id: str, ids: list[UUID]) -> dict:
    rows = (await session.scalars(select(TaskCategory).where(TaskCategory.owner_id == owner_id))).all()
    if set(ids) != {row.id for row in rows}:
        raise HTTPException(422, 'Ordering must contain every category exactly once')
    positions = {category_id: index for index, category_id in enumerate(ids)}
    for row in rows:
        row.position = positions[row.id]
    await session.flush()
    return await tracker.snapshot(session, owner_id)


async def assign(session: AsyncSession, owner_id: str, task_id: UUID, category_id: UUID | None) -> dict:
    task = await tracker.get_task(session, owner_id, task_id)
    if category_id is not None:
        await get_category(session, owner_id, category_id)
    task.category_id = category_id
    task.updated_at = tracker.utcnow()
    await session.flush()
    return await tracker.snapshot(session, owner_id)
