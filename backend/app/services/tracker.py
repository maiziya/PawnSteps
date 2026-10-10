import asyncio
import calendar
import hashlib
import json
import secrets
import weakref
from contextlib import AsyncExitStack, asynccontextmanager
from datetime import date, datetime, timedelta, timezone
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import DailyHistory, Owner, ProgressAdjustment, ProgressRecord, Reward, Task, TaskSchedule
from app.schemas import CourseUpdate, DayPlanUpdate, ProgressRecordCreate, ProgressRecordOut, ProgressRecordPatch, RewardCreate, RewardOut, RewardPatch, ScheduleConfig, TaskCreate, TaskOut, TaskPatch


from app.services import day_plan, schedules


MILESTONES = (3, 7, 14, 30, 60, 100)
_locks: weakref.WeakValueDictionary[str, asyncio.Lock] = weakref.WeakValueDictionary()


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def today() -> date:
    return datetime.now(ZoneInfo(settings.timezone)).date()


def aware(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


async def ensure_owner(session: AsyncSession, owner_id: str) -> Owner:
    owner = await session.get(Owner, owner_id)
    if owner is None:
        try:
            async with session.begin_nested():
                owner = Owner(id=owner_id)
                session.add(owner)
                await session.flush()
        except IntegrityError:
            owner = await session.get(Owner, owner_id)
    return owner


@asynccontextmanager
async def owner_transaction(session: AsyncSession, owner_id: str):
    async with owners_transaction(session, [owner_id]):
        yield


@asynccontextmanager
async def owners_transaction(session: AsyncSession, owner_ids: list[str]):
    async with AsyncExitStack() as stack:
        for owner_id in sorted(set(owner_ids)):
            lock = _locks.setdefault(owner_id, asyncio.Lock())
            await stack.enter_async_context(lock)
        try:
            for owner_id in sorted(set(owner_ids)):
                await ensure_owner(session, owner_id)
            await session.execute(select(Owner).where(Owner.id.in_(owner_ids)).order_by(Owner.id).with_for_update())
            yield
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def _tasks(session: AsyncSession, owner_id: str) -> list[Task]:
    return list((await session.scalars(select(Task).where(Task.owner_id == owner_id, Task.deleted_at.is_(None)).order_by(Task.is_done, Task.position, Task.created_at))).all())


async def get_task(session: AsyncSession, owner_id: str, task_id: UUID) -> Task:
    task = await session.scalar(select(Task).where(Task.id == task_id, Task.owner_id == owner_id, Task.deleted_at.is_(None)))
    if task is None:
        raise HTTPException(404, 'Task not found')
    return task


async def get_reward(session: AsyncSession, owner_id: str, reward_id: UUID) -> Reward:
    reward = await session.scalar(select(Reward).where(Reward.id == reward_id, Reward.owner_id == owner_id))
    if reward is None:
        raise HTTPException(404, 'Reward not found')
    return reward


def _history_row(task: Task, day: date, quota: int) -> DailyHistory:
    for row in task.history:
        if row.date == day:
            return row
    record = DailyHistory(task_id=task.id, date=day, completed=False, progress=0, quota=quota)
    task.history.append(record)
    return record


def _finish(task: Task, done: bool) -> None:
    if done and not task.is_done:
        task.done_at = utcnow()
        task._just_completed = True
    elif not done:
        task.done_at = None
    task.is_done = done


def _course_day_amounts(task: Task) -> dict[date, int]:
    amounts: dict[date, int] = {}
    for item in task.course_items or []:
        if item.get('done') and not item['name'].endswith('/') and item.get('done_date'):
            day = date.fromisoformat(item['done_date'])
            amounts[day] = amounts.get(day, 0) + 1
    return amounts


def _refresh_minimum(task: Task, day: date, amounts: dict[date | None, int]) -> None:
    """Track daily achievement separately from quantity or course completion."""
    task.today_amount = amounts.get(day, 0)
    task.daily_date = day
    task.daily_progress = min(task.today_amount, task.daily_minimum)
    if task.daily_minimum > 0 and task.today_amount > 0:
        _history_row(task, day, task.daily_minimum)
    for row in task.history:
        if row.date <= day:
            row.progress = amounts.get(row.date, 0)
            row.completed = row.quota > 0 and row.progress >= row.quota
    current = next((row for row in task.history if row.date == day), None)
    task.daily_done = bool(current and current.completed and task.daily_minimum > 0)


def _refresh_task(task: Task, day: date, amounts: dict[date | None, int], record_count: int) -> None:
    """Rebuild cached task/history projections from active progress records."""
    task.today_amount = amounts.get(day, 0)
    task.record_count = record_count
    task.plan_expired = False
    if task.course_items is not None:
        _refresh_minimum(task, day, _course_day_amounts(task))
        task.progress = sum(bool(item['done']) for item in task.course_items if not item['name'].endswith('/'))
        _finish(task, task.progress >= task.target)
        return
    if task.daily_plan is None and task.daily_quota == 0:
        task.progress = min(task.target, sum(amount for record_day, amount in amounts.items()
                                             if record_day is None or record_day <= day))
        _refresh_minimum(task, day, amounts)
        _finish(task, task.progress >= task.target)
        return

    task.daily_date = day
    task.daily_progress = 0
    task.daily_done = False
    if task.daily_plan is not None:
        start = task.plan_start_date or day
        index = (day - start).days
        task.plan_expired = index >= len(task.daily_plan)
        task.daily_quota = max(0, task.daily_plan[index]) if 0 <= index < len(task.daily_plan) else 0
        # Rest days project automatically; they never become fabricated work records.
        for offset in range(max(0, min(index + 1, len(task.daily_plan)))):
            record_day = start + timedelta(days=offset)
            quota = max(0, task.daily_plan[offset])
            existing = next((row for row in task.history if row.date == record_day), None)
            if quota == 0 or record_day in amounts or existing is not None:
                row = existing or _history_row(task, record_day, quota)
                row.quota = quota
                row.progress = amounts.get(record_day, 0) if quota else 0
                row.completed = quota == 0 or row.progress >= quota
        task.progress = min(task.target, sum(min(amount, max(0, task.daily_plan[(record_day - start).days]))
            for record_day, amount in amounts.items()
            if record_day is not None and record_day <= day and 0 <= (record_day - start).days < len(task.daily_plan)))
        if 0 <= index < len(task.daily_plan):
            task.daily_progress = min(task.today_amount, task.daily_quota)
            task.daily_done = task.daily_quota == 0 or task.today_amount >= task.daily_quota
        # An expired plan finishes on schedule while retaining its actual recorded work.
        done = task.plan_expired or (task.progress >= task.target if task.target else index == len(task.daily_plan) - 1)
        _finish(task, done and index >= 0)
        return

    for record_day in amounts:
        if record_day is not None and record_day <= day:
            _history_row(task, record_day, task.daily_quota)
    for row in task.history:
        if row.date <= day:
            if row.quota <= 0:
                row.quota = task.daily_quota
            row.progress = amounts.get(row.date, 0)
            row.completed = row.progress >= row.quota
    current = next((row for row in task.history if row.date == day), None)
    task.daily_progress = min(task.today_amount, task.daily_quota)
    task.daily_done = current.completed if current is not None else False
    task.progress = min(task.target, sum(row.completed for row in task.history if row.date <= day))
    _finish(task, task.progress >= task.target)


async def _record_totals(session: AsyncSession, tasks: list[Task]) -> tuple[dict, dict]:
    if not tasks:
        return {}, {}
    rows = (await session.execute(select(ProgressRecord.task_id, ProgressRecord.date,
        func.sum(ProgressRecord.amount), func.count(ProgressRecord.id))
        .where(ProgressRecord.task_id.in_([task.id for task in tasks]), ProgressRecord.deleted_at.is_(None))
        .group_by(ProgressRecord.task_id, ProgressRecord.date))).all()
    amounts: dict[UUID, dict[date | None, int]] = {}
    counts: dict[UUID, int] = {}
    for task_id, record_day, amount, count in rows:
        amounts.setdefault(task_id, {})[record_day] = int(amount)
        counts[task_id] = counts.get(task_id, 0) + count
    return amounts, counts


async def _cleanup(session: AsyncSession, owner_id: str) -> None:
    pending = (await session.scalars(select(Task).where(Task.owner_id == owner_id, Task.deleted_at.is_not(None)))).all()
    now = utcnow()
    for task in pending:
        if task.undo_expires_at is None or aware(task.undo_expires_at) <= now:
            await session.delete(task)
    await session.flush()


async def _streak(session: AsyncSession, owner_id: str, tasks: list[Task] | None = None) -> int:
    return schedules.streak(tasks if tasks is not None else await _tasks(session, owner_id), today())


async def snapshot(session: AsyncSession, owner_id: str) -> dict:
    await ensure_owner(session, owner_id)
    await _cleanup(session, owner_id)
    tasks = await _tasks(session, owner_id)
    day = today()
    amounts, counts = await _record_totals(session, tasks)
    for task in tasks:
        _refresh_task(task, day, amounts.get(task.id, {}), counts.get(task.id, 0))
        schedules.project(task, day)
    rewards = list((await session.scalars(select(Reward).where(Reward.owner_id == owner_id).order_by(Reward.position, Reward.id))).all())
    existing = {reward.streak_target for reward in rewards if reward.streak_target}
    last_position = max((reward.position for reward in rewards), default=-1)
    for step in MILESTONES:
        if step not in existing:
            last_position += 1
            reward = Reward(name=f'{step} 天连续打卡', owner_id=owner_id, streak_target=step, position=last_position, is_unlocked=False)
            session.add(reward)
            rewards.append(reward)
    await session.flush()
    streak = await _streak(session, owner_id, tasks)
    unlocked = None
    reward_map = {reward.id: reward for reward in rewards}
    for task in tasks:
        if task.is_done and getattr(task, '_just_completed', False) and task.reward_id in reward_map:
            reward = reward_map[task.reward_id]
            if not reward.is_unlocked:
                reward.is_unlocked = True
                unlocked = reward
        task._just_completed = False
    for reward in rewards:
        if reward.streak_target is not None and streak >= reward.streak_target and not reward.streak_claimed:
            reward.is_unlocked = True
            reward.streak_claimed = True
            unlocked = reward
    await session.flush()
    completed = sum(task.is_done for task in tasks)
    daily_tasks = [task for task in tasks if schedules.counts_today(task, day)
                   and (not task.is_done or task.daily_done)]
    return {
        'today': day,
        'timezone': settings.timezone,
        'today_plan': await day_plan.projection(session, owner_id, day),
        'tasks': [TaskOut.model_validate(task) for task in sorted(tasks, key=lambda task: (task.is_done, task.position, task.created_at))],
        'rewards': [RewardOut.model_validate(reward) for reward in sorted(rewards, key=lambda reward: reward.position)],
        'stats': {'total': len(tasks), 'completed': completed, 'in_progress': len(tasks) - completed, 'xp': completed * 100, 'streak': streak, 'today_completed': sum(task.daily_done for task in daily_tasks), 'today_total': len(daily_tasks)},
        'unlocked_reward': RewardOut.model_validate(unlocked) if unlocked else None,
    }


async def set_day_plan(session: AsyncSession, owner_id: str, body: DayPlanUpdate) -> dict:
    state = await snapshot(session, owner_id)
    await day_plan.replace(session, owner_id, state['today'], body, state['tasks'])
    state['today_plan'] = await day_plan.projection(session, owner_id, state['today'])
    return state


async def _unique_name(session: AsyncSession, owner_id: str, name: str, except_id: UUID | None = None) -> None:
    query = select(Task.id).where(Task.owner_id == owner_id, Task.name == name)
    if except_id is not None:
        query = query.where(Task.id != except_id)
    if await session.scalar(query):
        raise HTTPException(409, 'A task with this name already exists')


async def create_task(session: AsyncSession, owner_id: str, body: TaskCreate) -> dict:
    await snapshot(session, owner_id)
    tasks = await _tasks(session, owner_id)
    if owner_id.startswith('guest:'):
        if len(tasks) >= settings.guest_task_limit:
            raise HTTPException(403, 'Guest task limit reached; create an account to continue')
        if (body.daily_quota > 0 or body.daily_plan is not None) and sum(task.daily_quota > 0 or task.daily_plan is not None for task in tasks) >= settings.guest_daily_limit:
            raise HTTPException(403, 'Guest daily task limit reached; create an account to continue')
    await _unique_name(session, owner_id, body.name)
    if body.reward_id:
        await get_reward(session, owner_id, body.reward_id)
    values = body.model_dump()
    schedule = values.pop('schedule')
    if body.daily_plan is not None:
        values['target'] = sum(max(0, item) for item in body.daily_plan)
        values['plan_start_date'] = body.plan_start_date or today()
    if body.course_items is not None:
        values['course_items'] = [{'name': item.name, 'done': False} for item in body.course_items]
        values['target'] = sum(not item.name.endswith('/') for item in body.course_items)
        values['unit'] = '节'
    task = Task(**values, owner_id=owner_id, position=max((item.position for item in tasks), default=-1) + 1, progress=0, daily_date=today(), history=[], schedules=[TaskSchedule(starts_on=today(), enabled=bool(body.daily_quota or body.daily_minimum or body.daily_plan is not None), **schedule)])
    session.add(task)
    await session.flush()
    return await snapshot(session, owner_id)


async def update_task(session: AsyncSession, owner_id: str, task_id: UUID, body: TaskPatch) -> dict:
    await snapshot(session, owner_id)
    task = await get_task(session, owner_id, task_id)
    values = body.model_dump(exclude_unset=True)
    for key, value in values.items():
        if value is None and key not in {'reward_id', 'deadline'} and not (key == 'daily_goal' and task.course_items is not None):
            raise HTTPException(422, f'{key} cannot be null')
    requested_schedule = values.pop('schedule', None)
    if 'name' in values:
        await _unique_name(session, owner_id, values['name'], task.id)
    if values.get('reward_id'):
        await get_reward(session, owner_id, values['reward_id'])
        if task.is_done and values['reward_id'] != task.reward_id:
            task._just_completed = True
    if 'target' in values and (task.daily_plan is not None or task.course_items is not None):
        raise HTTPException(422, 'Plan and course targets are calculated automatically')
    if 'daily_quota' in values and (task.daily_plan is not None or task.course_items is not None or task.daily_quota == 0):
        raise HTTPException(422, 'Only existing daily tasks have an editable daily quota')
    if values.get('daily_minimum', task.daily_minimum) > values.get('target', task.target):
        raise HTTPException(422, 'Daily minimum cannot exceed the total target')
    if 'daily_minimum' in values and (task.daily_quota > 0 or task.daily_plan is not None):
        raise HTTPException(422, 'Only ordinary and course tasks have a separate daily minimum')
    daily_goal = values.get('daily_goal', task.daily_goal)
    if 'daily_goal' in values and task.daily_plan is not None:
        raise HTTPException(422, 'Plan tasks derive daily goals from their schedule')
    if daily_goal is not None:
        minimum = values.get('daily_quota', task.daily_quota) or values.get('daily_minimum', task.daily_minimum)
        if daily_goal < minimum:
            raise HTTPException(422, 'Daily goal cannot be lower than the daily minimum')
        if not task.daily_quota and daily_goal > values.get('target', task.target):
            raise HTTPException(422, 'Daily goal cannot exceed the total target')
    effective_on = today() + timedelta(days=1)
    config = ScheduleConfig.model_validate(requested_schedule) if requested_schedule is not None else schedules.configuration(task, effective_on)[0]
    enabled = bool(values.get('daily_quota', task.daily_quota) or values.get('daily_minimum', task.daily_minimum) or task.daily_plan is not None)
    if config.mode != 'daily' and (not enabled or task.daily_plan is not None):
        raise HTTPException(422, 'Flexible schedules require a minimum and cannot override a day-by-day plan')
    # Frequency changes apply tomorrow; editing other fields must retain a pending change.
    if enabled != schedules.enabled_on(task, today()):
        current = schedules.configuration(task, today())[0] if enabled else ScheduleConfig()
        schedules.set_schedule(task, today(), current, enabled)
    schedules.set_schedule(task, effective_on, config, enabled)
    for key, value in values.items():
        setattr(task, key, value)
    if 'daily_minimum' in values:
        current = next((row for row in task.history if row.date == today()), None)
        if current:
            current.quota = task.daily_minimum
    if 'daily_quota' in values:
        record = next((row for row in task.history if row.date == today()), None)
        if record:
            record.quota = task.daily_quota
    task.progress = min(task.progress, task.target)
    await session.flush()
    return await snapshot(session, owner_id)


async def retired_progress_endpoint(session: AsyncSession, owner_id: str, task_id: UUID) -> None:
    await get_task(session, owner_id, task_id)
    raise HTTPException(410, 'Direct progress updates are retired; use the task records endpoints')


def _request_fingerprint(body: ProgressRecordCreate) -> str:
    payload = json.dumps({'amount': body.amount, 'note': body.note}, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(payload.encode('utf-8')).hexdigest()


async def _get_progress_record(session: AsyncSession, task_id: UUID, record_id: UUID) -> ProgressRecord:
    record = await session.scalar(select(ProgressRecord).where(ProgressRecord.id == record_id, ProgressRecord.task_id == task_id))
    if record is None:
        raise HTTPException(404, 'Progress record not found')
    return record


async def list_records(session: AsyncSession, owner_id: str, task_id: UUID, offset: int, limit: int) -> dict:
    await snapshot(session, owner_id)
    task = await get_task(session, owner_id, task_id)
    predicate = (ProgressRecord.task_id == task.id, ProgressRecord.deleted_at.is_(None))
    total = await session.scalar(select(func.count()).select_from(ProgressRecord).where(*predicate))
    records = (await session.scalars(select(ProgressRecord).where(*predicate)
        .order_by(ProgressRecord.date.desc().nullslast(), ProgressRecord.created_at.desc(), ProgressRecord.id.desc())
        .offset(offset).limit(limit))).all()
    return {'records': [ProgressRecordOut.model_validate(record) for record in records],
            'total': total, 'offset': offset, 'limit': limit}


async def create_record(session: AsyncSession, owner_id: str, task_id: UUID, body: ProgressRecordCreate) -> dict:
    await snapshot(session, owner_id)
    task = await get_task(session, owner_id, task_id)
    fingerprint = _request_fingerprint(body)
    if body.request_id is not None:
        if await session.get(ProgressAdjustment, (task.id, body.request_id)) is not None:
            raise HTTPException(409, 'This request ID was already used for a decrement')
        existing = await session.scalar(select(ProgressRecord).where(
            ProgressRecord.task_id == task.id, ProgressRecord.request_id == body.request_id))
        if existing is not None:
            if existing.request_fingerprint != fingerprint:
                raise HTTPException(409, 'This request ID was already used for a different record')
            return {**await snapshot(session, owner_id), 'record': ProgressRecordOut.model_validate(existing)}
    if task.course_items is not None:
        raise HTTPException(422, 'Course progress is recorded through its checklist')
    if task.daily_plan is not None:
        index = (today() - task.plan_start_date).days
        if index < 0 or index >= len(task.daily_plan):
            raise HTTPException(409, 'The plan is not active today')
        if task.daily_plan[index] <= 0:
            raise HTTPException(409, 'Rest days are completed automatically')
    elif task.is_done and not (task.daily_quota > 0 and task.daily_done):
        raise HTTPException(409, 'This task is already complete')
    record = ProgressRecord(task_id=task.id, amount=body.amount, note=body.note, date=today(),
        source='manual', request_id=body.request_id or uuid4(), request_fingerprint=fingerprint)
    session.add(record)
    task.updated_at = utcnow()
    await session.flush()
    return {**await snapshot(session, owner_id), 'record': ProgressRecordOut.model_validate(record)}


async def decrement_progress(session: AsyncSession, owner_id: str, task_id: UUID, request_id: UUID) -> dict:
    await snapshot(session, owner_id)
    task = await get_task(session, owner_id, task_id)
    if await session.scalar(select(ProgressRecord.id).where(
            ProgressRecord.task_id == task.id, ProgressRecord.request_id == request_id)) is not None:
        raise HTTPException(409, 'This request ID was already used to create a record')
    receipt = await session.get(ProgressAdjustment, (task.id, request_id))
    if receipt is not None:
        record = await _get_progress_record(session, task.id, receipt.record_id)
        return {**await snapshot(session, owner_id), 'record': ProgressRecordOut.model_validate(record)}

    if task.course_items is not None:
        raise HTTPException(422, 'Course progress is recorded through its checklist')
    day = today()
    if task.daily_plan is not None:
        index = (day - task.plan_start_date).days
        if index < 0 or index >= len(task.daily_plan):
            raise HTTPException(409, 'The plan is not active today')
        if task.daily_plan[index] <= 0:
            raise HTTPException(409, 'Rest days are completed automatically')
    query = select(ProgressRecord).where(ProgressRecord.task_id == task.id, ProgressRecord.deleted_at.is_(None))
    if task.daily_quota > 0 or task.daily_plan is not None:
        query = query.where(ProgressRecord.date == day)
    record = await session.scalar(query.order_by(ProgressRecord.date.desc().nullslast(),
        ProgressRecord.created_at.desc(), ProgressRecord.id.desc()).limit(1))
    if record is None:
        raise HTTPException(409, 'There is no recorded progress to decrease')

    now = utcnow()
    if record.amount > 1:
        record.amount -= 1
    else:
        record.deleted_at = now
    record.updated_at = now
    task.updated_at = now
    session.add(ProgressAdjustment(task_id=task.id, request_id=request_id, record_id=record.id, created_at=now))
    await session.flush()
    return {**await snapshot(session, owner_id), 'record': ProgressRecordOut.model_validate(record)}


async def update_record(session: AsyncSession, owner_id: str, task_id: UUID, record_id: UUID,
                        body: ProgressRecordPatch) -> dict:
    await snapshot(session, owner_id)
    task = await get_task(session, owner_id, task_id)
    record = await _get_progress_record(session, task.id, record_id)
    if record.deleted_at is not None:
        raise HTTPException(409, 'A revoked record cannot be edited')
    for key, value in body.model_dump(exclude_unset=True).items():
        setattr(record, key, value)
    record.updated_at = utcnow()
    task.updated_at = utcnow()
    await session.flush()
    return {**await snapshot(session, owner_id), 'record': ProgressRecordOut.model_validate(record)}


async def revoke_record(session: AsyncSession, owner_id: str, task_id: UUID, record_id: UUID) -> dict:
    await snapshot(session, owner_id)
    task = await get_task(session, owner_id, task_id)
    record = await _get_progress_record(session, task.id, record_id)
    if record.deleted_at is None:
        record.deleted_at = utcnow()
        record.updated_at = record.deleted_at
        task.updated_at = record.deleted_at
        await session.flush()
    return {**await snapshot(session, owner_id), 'record': ProgressRecordOut.model_validate(record)}


async def set_course(session: AsyncSession, owner_id: str, task_id: UUID, body: CourseUpdate) -> dict:
    await snapshot(session, owner_id)
    task = await get_task(session, owner_id, task_id)
    if task.course_items is None:
        raise HTTPException(422, 'This task is not a course')
    if any(index < 0 or index >= len(task.course_items) for index in body.indices):
        raise HTTPException(422, 'Course item index is out of range')
    items = [dict(item) for item in task.course_items]
    for index in set(body.indices):
        if not items[index]['name'].endswith('/') and items[index]['done'] != body.done:
            items[index]['done'] = body.done
            if body.done:
                items[index]['done_date'] = today().isoformat()
            else:
                items[index].pop('done_date', None)
    task.course_items = items
    task.progress = sum(bool(item['done']) for item in items if not item['name'].endswith('/'))
    _finish(task, task.progress >= task.target)
    await session.flush()
    return await snapshot(session, owner_id)


async def reorder_tasks(session: AsyncSession, owner_id: str, ids: list[UUID]) -> dict:
    await snapshot(session, owner_id)
    tasks = [task for task in await _tasks(session, owner_id) if not task.is_done]
    if set(ids) != {task.id for task in tasks}:
        raise HTTPException(422, 'Ordering must contain every unfinished task exactly once')
    task_map = {task.id: task for task in tasks}
    for position, task_id in enumerate(ids):
        task_map[task_id].position = position
    await session.flush()
    return await snapshot(session, owner_id)


async def delete_task(session: AsyncSession, owner_id: str, task_id: UUID) -> dict:
    await snapshot(session, owner_id)
    task = await get_task(session, owner_id, task_id)
    task.deleted_at = utcnow()
    task.undo_expires_at = task.deleted_at + timedelta(seconds=5)
    task.undo_token = secrets.token_urlsafe(32)
    token = task.undo_token
    await session.flush()
    return {**await snapshot(session, owner_id), 'undo_token': token}


async def undo_task(session: AsyncSession, owner_id: str, token: str) -> dict:
    task = await session.scalar(select(Task).where(Task.owner_id == owner_id, Task.undo_token == token, Task.deleted_at.is_not(None)))
    if task is None or task.undo_expires_at is None or aware(task.undo_expires_at) <= utcnow():
        raise HTTPException(410, 'The undo window has expired')
    if owner_id.startswith('guest:'):
        active = await _tasks(session, owner_id)
        if len(active) >= settings.guest_task_limit:
            raise HTTPException(403, 'Guest task limit reached; create an account to restore this task')
        if (task.daily_quota > 0 or task.daily_plan is not None) and sum(item.daily_quota > 0 or item.daily_plan is not None for item in active) >= settings.guest_daily_limit:
            raise HTTPException(403, 'Guest daily task limit reached; create an account to restore this task')
    task.deleted_at = None
    task.undo_expires_at = None
    task.undo_token = None
    await session.flush()
    return await snapshot(session, owner_id)


async def create_reward(session: AsyncSession, owner_id: str, body: RewardCreate) -> dict:
    await snapshot(session, owner_id)
    rewards = list((await session.scalars(select(Reward).where(Reward.owner_id == owner_id))).all())
    session.add(Reward(**body.model_dump(), owner_id=owner_id, position=max((reward.position for reward in rewards), default=-1) + 1))
    await session.flush()
    return await snapshot(session, owner_id)


async def update_reward(session: AsyncSession, owner_id: str, reward_id: UUID, body: RewardPatch) -> dict:
    await snapshot(session, owner_id)
    reward = await get_reward(session, owner_id, reward_id)
    for key, value in body.model_dump(exclude_unset=True).items():
        if value is None and key != 'image_url':
            raise HTTPException(422, f'{key} cannot be null')
        setattr(reward, key, value)
    await session.flush()
    result = await snapshot(session, owner_id)
    # An explicit manual state is retained after the one-time automatic award.
    if body.is_unlocked is not None:
        reward.is_unlocked = body.is_unlocked
        await session.flush()
        result['rewards'] = [RewardOut.model_validate(reward) if item.id == reward.id else item for item in result['rewards']]
        result['unlocked_reward'] = RewardOut.model_validate(reward) if body.is_unlocked else None
    return result


async def delete_reward(session: AsyncSession, owner_id: str, reward_id: UUID) -> dict:
    await snapshot(session, owner_id)
    reward = await get_reward(session, owner_id, reward_id)
    if reward.streak_target is not None:
        raise HTTPException(403, 'Milestone rewards cannot be deleted')
    tasks = (await session.scalars(select(Task).where(Task.owner_id == owner_id, Task.reward_id == reward_id))).all()
    for task in tasks:
        task.reward_id = None
    await session.delete(reward)
    await session.flush()
    return await snapshot(session, owner_id)


async def reorder_rewards(session: AsyncSession, owner_id: str, ids: list[UUID]) -> dict:
    await snapshot(session, owner_id)
    rewards = list((await session.scalars(select(Reward).where(Reward.owner_id == owner_id))).all())
    if set(ids) != {reward.id for reward in rewards}:
        raise HTTPException(422, 'Ordering must contain every reward exactly once')
    reward_map = {reward.id: reward for reward in rewards}
    for position, reward_id in enumerate(ids):
        reward_map[reward_id].position = position
    await session.flush()
    return await snapshot(session, owner_id)


async def history(session: AsyncSession, owner_id: str, month: str | None = None,
                  week_of: date | None = None) -> dict:
    if month is not None and week_of is not None:
        raise HTTPException(422, 'Choose either month or week_of, not both')
    await snapshot(session, owner_id)
    first, last = date.min, today()
    end = None
    if week_of is not None:
        try:
            first = week_of - timedelta(days=week_of.weekday())
            end = first + timedelta(days=6)
            last = min(today(), end)
        except OverflowError:
            raise HTTPException(422, 'The selected week is outside the supported date range') from None
    elif month:
        try:
            first = date.fromisoformat(month + '-01')
            end = first.replace(day=calendar.monthrange(first.year, first.month)[1])
            last = min(today(), end)
        except (ValueError, TypeError):
            raise HTTPException(422, 'Month must use YYYY-MM format') from None
    tasks = await _tasks(session, owner_id)
    amounts, _ = await _record_totals(session, tasks)
    entries = []
    for task in tasks:
        kind = 'course' if task.course_items is not None else 'plan' if task.daily_plan is not None else 'daily' if task.daily_quota else 'normal'
        totals = _course_day_amounts(task) if kind == 'course' else amounts.get(task.id, {})
        daily = {row.date: row for row in task.history}
        for day in set(totals) | set(daily):
            if day is None or not first <= day <= last:
                continue
            row = daily.get(day)
            entries.append({'task_id': task.id, 'task_name': task.name, 'date': day,
                'completed': row.completed if row else task.is_done,
                'amount': totals.get(day, 0), 'unit': '节' if kind == 'course' else task.unit,
                'task_kind': kind, 'quota': row.quota if row else None})
    entries.sort(key=lambda entry: (-entry['date'].toordinal(), entry['task_name']))
    rest_dates = []
    if end is not None:
        rest_dates = [first + timedelta(days=index) for index in range((end - first).days + 1)
                      if schedules.rest_day(tasks, first + timedelta(days=index))]
    return {'history': entries, 'rest_dates': rest_dates, 'streak': await _streak(session, owner_id, tasks)}
