"""Ordered task choices for one owner's business day."""

from datetime import date
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import DayPlanItem, Task
from app.schemas import DayPlanUpdate, TaskOut


async def projection(session: AsyncSession, owner_id: str, day: date) -> dict:
    task_ids = list((await session.scalars(select(DayPlanItem.task_id).join(Task)
        .where(DayPlanItem.owner_id == owner_id, DayPlanItem.date == day,
               Task.owner_id == owner_id, Task.deleted_at.is_(None), Task.archived_at.is_(None))
        .order_by(DayPlanItem.position))).all())
    return {'date': day, 'task_ids': task_ids}


async def replace(session: AsyncSession, owner_id: str, day: date,
                  body: DayPlanUpdate, tasks: list[TaskOut]) -> None:
    if body.date != day:
        raise HTTPException(409, "The day has changed. Refresh today's plan and try again.")
    selected = set((await session.scalars(select(DayPlanItem.task_id)
        .where(DayPlanItem.owner_id == owner_id, DayPlanItem.date == day))).all())
    task_map = {task.id: task for task in tasks}
    for task_id in body.task_ids:
        task = task_map.get(task_id)
        if task is None:
            raise HTTPException(404, 'Task not found')
        if task_id not in selected:
            if task.is_done:
                raise HTTPException(409, 'A completed task cannot be added to today\'s plan')
            if task.daily_plan is not None and (
                task.plan_expired or task.daily_quota <= 0
                or (task.plan_start_date is not None and task.plan_start_date > day)
            ):
                raise HTTPException(409, 'The task plan is not active today')
    # Delete before inserting to make reordering safe under both unique constraints.
    await session.execute(delete(DayPlanItem).where(
        DayPlanItem.owner_id == owner_id, DayPlanItem.date == day))
    session.add_all([DayPlanItem(owner_id=owner_id, date=day, position=position, task_id=task_id)
                     for position, task_id in enumerate(body.task_ids)])
    await session.flush()


async def migrate_owner(session: AsyncSession, source: str, target: str) -> None:
    source_rows = (await session.scalars(select(DayPlanItem).join(Task)
        .where(DayPlanItem.owner_id == source, Task.owner_id == target)
        .order_by(DayPlanItem.date, DayPlanItem.position))).all()
    target_rows = (await session.scalars(select(DayPlanItem)
        .where(DayPlanItem.owner_id == target)
        .order_by(DayPlanItem.date, DayPlanItem.position))).all()
    plans: dict[date, list[UUID]] = {}
    for row in target_rows:
        plans.setdefault(row.date, []).append(row.task_id)
    for row in source_rows:
        selected = plans.setdefault(row.date, [])
        if row.task_id not in selected and len(selected) < 3:
            selected.append(row.task_id)
    affected_dates = {row.date for row in source_rows}
    if affected_dates:
        await session.execute(delete(DayPlanItem).where(
            DayPlanItem.owner_id == target, DayPlanItem.date.in_(affected_dates)))
    await session.execute(delete(DayPlanItem).where(DayPlanItem.owner_id == source))
    session.add_all([DayPlanItem(owner_id=target, date=day, position=position, task_id=task_id)
                     for day in sorted(affected_dates)
                     for position, task_id in enumerate(plans[day])])
    await session.flush()


async def export_plans(session: AsyncSession, owner_id: str) -> list[dict]:
    rows = (await session.execute(select(DayPlanItem.date, DayPlanItem.task_id).join(Task)
        .where(DayPlanItem.owner_id == owner_id, Task.owner_id == owner_id)
        .order_by(DayPlanItem.date, DayPlanItem.position))).all()
    plans: dict[date, list[UUID]] = {}
    for day, task_id in rows:
        plans.setdefault(day, []).append(task_id)
    return [{'date': day, 'task_ids': task_ids} for day, task_ids in plans.items()]
