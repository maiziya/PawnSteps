import asyncio
import calendar
import secrets
import weakref
from contextlib import AsyncExitStack, asynccontextmanager
from datetime import date, datetime, timedelta, timezone
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import DailyHistory, Owner, Reward, Task
from app.schemas import CourseUpdate, RewardCreate, RewardOut, RewardPatch, TaskCreate, TaskOut, TaskPatch


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


def _record(task: Task, day: date) -> DailyHistory:
    for row in task.history:
        if row.date == day:
            return row
    record = DailyHistory(task_id=task.id, date=day, completed=False, progress=0)
    task.history.append(record)
    return record


def _finish(task: Task, done: bool) -> None:
    if done and not task.is_done:
        task.done_at = utcnow()
        task._just_completed = True
    elif not done:
        task.done_at = None
    task.is_done = done


def _refresh_task(task: Task, day: date) -> None:
    if task.daily_plan is not None:
        start = task.plan_start_date or day
        index = (day - start).days
        if task.daily_date != day:
            task.daily_date = day
            task.daily_progress = 0
            task.daily_done = False
        if index < 0:
            task.daily_quota = 0
            return
        # Rest days are automatic even when the app was not opened that day.
        for offset in range(min(index + 1, len(task.daily_plan))):
            if task.daily_plan[offset] <= 0:
                row = _record(task, start + timedelta(days=offset))
                row.completed = True
                row.progress = 0
        if index >= len(task.daily_plan):
            task.daily_quota = 0
            task.progress = task.target
            _finish(task, True)
            return
        quota = max(task.daily_plan[index], 0)
        task.daily_quota = quota
        row = _record(task, day)
        task.daily_progress = min(row.progress, quota)
        task.daily_done = row.completed if quota else True
        task.progress = min(task.target, sum(max(0, row.progress) for row in task.history))
        # All-rest plans remain scheduled until their final rest day.
        done = task.progress >= task.target if task.target else index == len(task.daily_plan) - 1
        _finish(task, done)
    elif task.daily_quota > 0:
        if task.daily_date != day:
            task.daily_date = day
            task.daily_progress = 0
            task.daily_done = False
        row = next((record for record in task.history if record.date == day), None)
        if row is not None:
            task.daily_progress = min(task.daily_quota, row.progress)
            task.daily_done = row.completed
        task.progress = min(task.target, sum(1 for record in task.history if record.completed))
        _finish(task, task.progress >= task.target)


async def _cleanup(session: AsyncSession, owner_id: str) -> None:
    pending = (await session.scalars(select(Task).where(Task.owner_id == owner_id, Task.deleted_at.is_not(None)))).all()
    now = utcnow()
    for task in pending:
        if task.undo_expires_at is None or aware(task.undo_expires_at) <= now:
            await session.delete(task)
    await session.flush()


async def _streak(session: AsyncSession, owner_id: str) -> int:
    days = set((await session.scalars(select(DailyHistory.date).join(Task).where(Task.owner_id == owner_id, Task.deleted_at.is_(None), DailyHistory.completed.is_(True), DailyHistory.date <= today()).distinct())).all())
    count = 0
    day = today()
    while day in days:
        count += 1
        day -= timedelta(days=1)
    return count


async def snapshot(session: AsyncSession, owner_id: str) -> dict:
    await ensure_owner(session, owner_id)
    await _cleanup(session, owner_id)
    tasks = await _tasks(session, owner_id)
    day = today()
    for task in tasks:
        _refresh_task(task, day)
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
    streak = await _streak(session, owner_id)
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
    daily_tasks = [task for task in tasks if (task.daily_quota > 0 or task.daily_plan is not None) and (not task.is_done or task.daily_done) and (task.plan_start_date is None or task.plan_start_date <= day)]
    return {
        'today': day,
        'timezone': settings.timezone,
        'tasks': [TaskOut.model_validate(task) for task in sorted(tasks, key=lambda task: (task.is_done, task.position, task.created_at))],
        'rewards': [RewardOut.model_validate(reward) for reward in sorted(rewards, key=lambda reward: reward.position)],
        'stats': {'total': len(tasks), 'completed': completed, 'in_progress': len(tasks) - completed, 'xp': completed * 100, 'streak': streak, 'today_completed': sum(task.daily_done for task in daily_tasks), 'today_total': len(daily_tasks)},
        'unlocked_reward': RewardOut.model_validate(unlocked) if unlocked else None,
    }


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
    if body.daily_plan is not None:
        values['target'] = sum(max(0, item) for item in body.daily_plan)
        values['plan_start_date'] = body.plan_start_date or today()
    if body.course_items is not None:
        values['course_items'] = [{'name': item.name, 'done': False} for item in body.course_items]
        values['target'] = sum(not item.name.endswith('/') for item in body.course_items)
    task = Task(**values, owner_id=owner_id, position=max((item.position for item in tasks), default=-1) + 1, progress=0, daily_date=today(), history=[])
    session.add(task)
    await session.flush()
    return await snapshot(session, owner_id)


async def update_task(session: AsyncSession, owner_id: str, task_id: UUID, body: TaskPatch) -> dict:
    await snapshot(session, owner_id)
    task = await get_task(session, owner_id, task_id)
    values = body.model_dump(exclude_unset=True)
    for key, value in values.items():
        if value is None and key != 'reward_id':
            raise HTTPException(422, f'{key} cannot be null')
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
    for key, value in values.items():
        setattr(task, key, value)
    if 'daily_quota' in values:
        record = next((row for row in task.history if row.date == today()), None)
        if record:
            record.progress = min(record.progress, task.daily_quota)
            record.completed = record.progress >= task.daily_quota
            task.daily_progress = record.progress
            task.daily_done = record.completed
    task.progress = min(task.progress, task.target)
    _finish(task, task.progress >= task.target)
    await session.flush()
    return await snapshot(session, owner_id)


async def set_progress(session: AsyncSession, owner_id: str, task_id: UUID, progress: int) -> dict:
    await snapshot(session, owner_id)
    task = await get_task(session, owner_id, task_id)
    if task.daily_quota > 0 or task.daily_plan is not None or task.course_items is not None:
        raise HTTPException(422, 'Use the daily or course progress endpoint for this task')
    if progress > task.target:
        raise HTTPException(422, 'Progress exceeds target')
    task.progress = progress
    _finish(task, progress >= task.target)
    await session.flush()
    return await snapshot(session, owner_id)


async def set_daily(session: AsyncSession, owner_id: str, task_id: UUID, progress: int, undo: bool = False) -> dict:
    await snapshot(session, owner_id)
    task = await get_task(session, owner_id, task_id)
    if task.daily_quota <= 0 and task.daily_plan is None:
        raise HTTPException(422, 'This task is not a daily task')
    if task.daily_plan is not None:
        index = (today() - task.plan_start_date).days
        if index < 0 or index >= len(task.daily_plan):
            raise HTTPException(409, 'The plan is not active today')
        if task.daily_plan[index] <= 0:
            raise HTTPException(409, 'Rest days are completed automatically')
    if task.is_done and not task.daily_done:
        raise HTTPException(409, 'This task is already complete')
    if progress > task.daily_quota:
        raise HTTPException(422, 'Daily progress exceeds quota')
    row = _record(task, today())
    row.progress = 0 if undo else progress
    row.completed = row.progress >= task.daily_quota
    task.daily_progress = row.progress
    task.daily_done = row.completed
    _refresh_task(task, today())
    await session.flush()
    return await snapshot(session, owner_id)


async def set_course(session: AsyncSession, owner_id: str, task_id: UUID, body: CourseUpdate) -> dict:
    await snapshot(session, owner_id)
    task = await get_task(session, owner_id, task_id)
    if task.course_items is None:
        raise HTTPException(422, 'This task is not a course')
    if any(index < 0 or index >= len(task.course_items) for index in body.indices):
        raise HTTPException(422, 'Course item index is out of range')
    items = [dict(item) for item in task.course_items]
    for index in set(body.indices):
        if not items[index]['name'].endswith('/'):
            items[index]['done'] = body.done
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


async def history(session: AsyncSession, owner_id: str, month: str | None = None) -> dict:
    await snapshot(session, owner_id)
    query = select(DailyHistory, Task.name).join(Task).where(Task.owner_id == owner_id, Task.deleted_at.is_(None))
    if month:
        try:
            first = date.fromisoformat(month + '-01')
            last = first.replace(day=calendar.monthrange(first.year, first.month)[1])
        except (ValueError, TypeError):
            raise HTTPException(422, 'Month must use YYYY-MM format') from None
        query = query.where(DailyHistory.date >= first, DailyHistory.date <= last)
    rows = (await session.execute(query.order_by(DailyHistory.date.desc(), Task.name))).all()
    return {'history': [{'task_id': row.task_id, 'task_name': name, 'date': row.date, 'completed': row.completed} for row, name in rows], 'streak': await _streak(session, owner_id)}
