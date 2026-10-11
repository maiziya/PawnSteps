"""Owner-scoped daily notification claims; delivery remains browser opt-in."""
from datetime import datetime, timedelta, timezone
from uuid import uuid4
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import ReminderDelivery
from app.reminder_schemas import ReminderClaim, ReminderReceipt, ReminderState
from app.services import tracker


def now() -> datetime:
    return datetime.now(ZoneInfo(settings.timezone))


def state() -> ReminderState:
    current = now()
    return ReminderState(timezone=settings.timezone, server_now=current, date=current.date(), due=current.hour == 10)


async def claim(session: AsyncSession, owner_id: str, body: ReminderClaim) -> dict:
    snapshot = await tracker.snapshot(session, owner_id)
    reminder = state()
    if not reminder.due:
        return {**snapshot, 'reminder': reminder}
    current = reminder.server_now
    await session.execute(delete(ReminderDelivery).where(
        ReminderDelivery.owner_id == owner_id, ReminderDelivery.date < reminder.date - timedelta(days=2)))
    key = (owner_id, body.device_id, reminder.date)
    receipt = await session.get(ReminderDelivery, key)
    if receipt and (receipt.delivered or receipt.lease_until and tracker.aware(receipt.lease_until) > current):
        return {**snapshot, 'reminder': reminder}
    planned = {task_id: index for index, task_id in enumerate(snapshot['today_plan']['task_ids'])}
    tasks = [task for task in snapshot['tasks'] if not task.is_done and not task.daily_done and task.is_scheduled_today
             and not task.plan_expired and not (task.daily_plan is not None and task.daily_quota == 0)]
    tasks.sort(key=lambda task: (planned.get(task.id, 100), {'high': 0, 'medium': 1, 'low': 2}[task.priority], task.position))
    if receipt is None:
        receipt = ReminderDelivery(owner_id=owner_id, device_id=body.device_id, date=reminder.date)
        session.add(receipt)
    receipt.token = uuid4()
    receipt.delivered = not bool(tasks)
    receipt.lease_until = current.astimezone(timezone.utc) + timedelta(seconds=60) if tasks else None
    reminder.claimed = bool(tasks)
    reminder.token = receipt.token if tasks else None
    reminder.task_count = len(tasks)
    if tasks:
        names = '、'.join(task.name[:24] + ('…' if len(task.name) > 24 else '') for task in tasks[:3])
        reminder.body = f'今天还有 {len(tasks)} 项任务待推进：{names}{"等" if len(tasks) > 3 else ""}。日拱一卒，功不唐捐。'
        reminder.url = '/#today' if any(task.id in planned for task in tasks) else '/#tasks'
    await session.flush()
    return {**snapshot, 'reminder': reminder}


async def settle(session: AsyncSession, owner_id: str, body: ReminderReceipt, delivered: bool) -> dict:
    receipt = await session.get(ReminderDelivery, (owner_id, body.device_id, body.date))
    if receipt is None or receipt.token != body.token:
        raise HTTPException(409, '提醒状态已变化，请重试')
    if not receipt.delivered:
        receipt.delivered = delivered
        receipt.lease_until = None
    await session.flush()
    return {**await tracker.snapshot(session, owner_id), 'reminder': state()}
