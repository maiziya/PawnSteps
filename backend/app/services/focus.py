"""Owner-serialized timers with server timestamps and explicit progress settlement."""
import hashlib
import json
from datetime import datetime, time, timedelta, timezone
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings as app_settings
from app.focus_schemas import FocusSettle, FocusSettingsOut, FocusSettingsPatch, FocusStart
from app.models import FocusInterval, FocusPreferences, FocusSession, ProgressRecord
from app.schemas import CourseUpdate, ProgressRecordCreate, ProgressRecordOut
from app.services import tracker


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def aware(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def elapsed(row: FocusSession, now: datetime) -> float:
    return min(row.duration_seconds, sum(max(0.0, (aware(interval.ended_at) if interval.ended_at else now).timestamp() - aware(interval.started_at).timestamp()) for interval in row.intervals))


async def preferences(session: AsyncSession, owner_id: str) -> FocusPreferences:
    await tracker.ensure_owner(session, owner_id)
    value = await session.get(FocusPreferences, owner_id)
    if value is None:
        value = FocusPreferences(owner_id=owner_id)
        session.add(value)
        await session.flush()
    return value


async def owned_session(session: AsyncSession, owner_id: str, session_id: UUID) -> FocusSession:
    row = await session.scalar(select(FocusSession).where(FocusSession.id == session_id, FocusSession.owner_id == owner_id))
    if row is None:
        raise HTTPException(404, '这条专注记录不存在')
    return row


async def current(session: AsyncSession, owner_id: str) -> FocusSession | None:
    return await session.scalar(select(FocusSession).where(FocusSession.owner_id == owner_id, FocusSession.active_slot == 1))


def synchronize(row: FocusSession | None, prefs: FocusPreferences, now: datetime) -> None:
    if row is None or row.status != 'running':
        return
    running = next((interval for interval in row.intervals if interval.ended_at is None), None)
    if running is None:
        return
    closed = sum(max(0, (aware(item.ended_at) - aware(item.started_at)).total_seconds()) for item in row.intervals if item.ended_at is not None)
    deadline = aware(running.started_at) + timedelta(seconds=max(0, row.duration_seconds - closed))
    if now >= deadline:
        running.ended_at = deadline
        row.status = 'completed'
        row.ended_at = deadline
        if row.phase == 'focus':
            prefs.rounds_completed += 1
        prefs.revision += 1


def output(row: FocusSession, now: datetime) -> dict:
    seconds = int(elapsed(row, now))
    running = next((item for item in row.intervals if item.ended_at is None), None)
    deadline = None
    if row.status == 'running' and running:
        closed = sum(max(0, (aware(item.ended_at) - aware(item.started_at)).total_seconds()) for item in row.intervals if item.ended_at)
        deadline = aware(running.started_at) + timedelta(seconds=max(0, row.duration_seconds - closed))
    task = row.task
    available = task is not None and task.deleted_at is None and task.archived_at is None
    can_record = available and (('节' if task.course_items is not None else task.unit) == row.task_unit) and (not task.is_done or (task.daily_quota > 0 and task.daily_done and task.daily_date == tracker.today()))
    if available and task.daily_plan is not None:
        index = (tracker.today() - task.plan_start_date).days
        can_record = can_record and 0 <= index < len(task.daily_plan) and task.daily_plan[index] > 0
    return {'id': row.id, 'task_id': row.task_id if available else None, 'task_name': row.task_name, 'task_unit': row.task_unit,
            'is_course': row.is_course, 'can_record': bool(can_record), 'phase': row.phase, 'status': row.status,
            'duration_seconds': row.duration_seconds, 'elapsed_seconds': seconds,
            'remaining_seconds': max(0, row.duration_seconds - seconds), 'deadline_at': deadline,
            'started_at': aware(row.started_at), 'ended_at': aware(row.ended_at) if row.ended_at else None,
            'settled_at': aware(row.settled_at) if row.settled_at else None,
            'cycle_round': row.cycle_round, 'cycle_length': row.cycle_length, 'progress_record_id': row.progress_record_id}


async def state(session: AsyncSession, owner_id: str, *, claimed: bool = False) -> dict:
    now = utcnow()
    prefs = await preferences(session, owner_id)
    active = await current(session, owner_id)
    synchronize(active, prefs, now)
    await session.flush()
    zone = ZoneInfo(app_settings.timezone)
    day = now.astimezone(zone).date()
    start = datetime.combine(day, time.min, zone).astimezone(timezone.utc)
    end = datetime.combine(day + timedelta(days=1), time.min, zone).astimezone(timezone.utc)
    intervals = (await session.execute(select(FocusInterval.started_at, FocusInterval.ended_at)
        .join(FocusSession).where(FocusSession.owner_id == owner_id, FocusSession.phase == 'focus',
        FocusInterval.started_at < end, or_(FocusInterval.ended_at.is_(None), FocusInterval.ended_at > start)))).all()
    seconds = int(sum(max(0, (min(aware(last) if last else now, end) - max(aware(first), start)).total_seconds()) for first, last in intervals))
    completed = await session.scalar(select(func.count()).select_from(FocusSession).where(
        FocusSession.owner_id == owner_id, FocusSession.phase == 'focus', FocusSession.status == 'completed',
        FocusSession.ended_at >= start, FocusSession.ended_at < end))
    recent = (await session.scalars(select(FocusSession).where(FocusSession.owner_id == owner_id,
        FocusSession.phase == 'focus', FocusSession.status.in_(['completed', 'ended']))
        .order_by(FocusSession.started_at.desc(), FocusSession.id.desc()).limit(8))).all()
    return {'owner_id': owner_id, 'generation': prefs.generation, 'revision': prefs.revision, 'server_now': now,
            'settings': FocusSettingsOut.model_validate(prefs), 'active_session': output(active, now) if active else None,
            'summary': {'today_seconds': seconds, 'today_pomodoros': completed or 0, 'total_pomodoros': prefs.rounds_completed},
            'recent_sessions': [output(row, now) for row in recent], 'notification_claimed': claimed}


async def mutation(session: AsyncSession, owner_id: str, base: dict | None = None, *, claimed: bool = False) -> dict:
    result = base if base is not None else await tracker.snapshot(session, owner_id)
    return {**result, 'focus': await state(session, owner_id, claimed=claimed)}


async def update_settings(session: AsyncSession, owner_id: str, body: FocusSettingsPatch) -> dict:
    prefs = await preferences(session, owner_id)
    values = body.model_dump(exclude_unset=True)
    if any(value is None for value in values.values()):
        raise HTTPException(422, '计时设置不能留空')
    for key, value in values.items():
        setattr(prefs, key, value)
    prefs.revision += 1
    await session.flush()
    return await mutation(session, owner_id)


async def start(session: AsyncSession, owner_id: str, body: FocusStart) -> dict:
    prefs = await preferences(session, owner_id)
    fingerprint = hashlib.sha256(body.model_dump_json(exclude={'request_id'}).encode()).hexdigest()
    existing = await session.scalar(select(FocusSession).where(FocusSession.owner_id == owner_id, FocusSession.request_id == body.request_id))
    if existing:
        if existing.start_fingerprint != fingerprint:
            raise HTTPException(409, '本次启动标识已用于另一个计时器')
        return await mutation(session, owner_id)
    active = await current(session, owner_id)
    now = utcnow()
    synchronize(active, prefs, now)
    if active:
        if active.phase != 'focus' and active.status in ('completed', 'ended'):
            active.active_slot = None
            active.settled_at = now
            await session.flush()
        else:
            raise HTTPException(409, '已有计时器，请先结束或确认当前这一轮')
    task = await tracker.get_task(session, owner_id, body.task_id) if body.task_id else None
    if task:
        tracker.require_active(task)
    if task and task.is_done:
        raise HTTPException(409, '请选择进行中的任务')
    phase_minutes = {'focus': prefs.focus_minutes, 'short_break': prefs.short_break_minutes, 'long_break': prefs.long_break_minutes}
    cycle_round = prefs.rounds_completed % prefs.long_break_interval + 1
    break_seconds = (prefs.long_break_minutes if cycle_round == prefs.long_break_interval else prefs.short_break_minutes) * 60
    row = FocusSession(owner_id=owner_id, request_id=body.request_id, start_fingerprint=fingerprint, active_slot=1,
        task_id=task.id if task else None, task_name=task.name if task else '自由专注',
        task_unit=('节' if task.course_items is not None else task.unit) if task else '分钟',
        is_course=bool(task and task.course_items is not None), phase=body.phase, status='running',
        duration_seconds=phase_minutes[body.phase] * 60, break_seconds=break_seconds,
        cycle_round=cycle_round, cycle_length=prefs.long_break_interval, started_at=now,
        intervals=[FocusInterval(started_at=now)])
    session.add(row)
    prefs.revision += 1
    await session.flush()
    return await mutation(session, owner_id)


async def control(session: AsyncSession, owner_id: str, session_id: UUID, action: str) -> dict:
    prefs = await preferences(session, owner_id)
    row = await owned_session(session, owner_id, session_id)
    now = utcnow()
    synchronize(row, prefs, now)
    if row.settled_at is not None:
        return await mutation(session, owner_id)
    if action == 'pause' and row.status == 'running':
        for interval in row.intervals:
            if interval.ended_at is None:
                interval.ended_at = now
        row.status = 'paused'
        prefs.revision += 1
    elif action == 'resume' and row.status == 'paused':
        if row.active_slot != 1:
            raise HTTPException(409, '这轮计时已结束')
        row.intervals.append(FocusInterval(started_at=now))
        row.status = 'running'
        prefs.revision += 1
    elif action == 'end' and row.status in ('running', 'paused'):
        for interval in row.intervals:
            if interval.ended_at is None:
                interval.ended_at = now
        row.status = 'ended'
        row.ended_at = now
        prefs.revision += 1
    if action == 'end' and row.phase != 'focus':
        row.active_slot = None
        row.settled_at = now
    await session.flush()
    return await mutation(session, owner_id)


def settlement_fingerprint(body: FocusSettle) -> str:
    return hashlib.sha256(json.dumps(body.model_dump(), sort_keys=True, ensure_ascii=False).encode()).hexdigest()


async def settle(session: AsyncSession, owner_id: str, session_id: UUID, body: FocusSettle) -> dict:
    prefs = await preferences(session, owner_id)
    row = await owned_session(session, owner_id, session_id)
    now = utcnow()
    synchronize(row, prefs, now)
    fingerprint = settlement_fingerprint(body)
    if row.settled_at:
        if row.settlement_fingerprint and row.settlement_fingerprint != fingerprint:
            raise HTTPException(409, '本次成果已经确认，请刷新查看')
        result = await mutation(session, owner_id)
        if row.progress_record_id:
            record = await session.get(ProgressRecord, row.progress_record_id)
            if record:
                result['record'] = ProgressRecordOut.model_validate(record)
        return result
    if row.phase != 'focus' or row.status not in ('completed', 'ended'):
        raise HTTPException(409, '专注结束后才能确认成果')
    seconds = int(elapsed(row, now))
    base = None
    if body.record_progress:
        if seconds < 1 or row.task_id is None:
            raise HTTPException(422, '没有可记录的关联任务或有效时长')
        task = await tracker.get_task(session, owner_id, row.task_id)
        if ('节' if task.course_items is not None else task.unit) != row.task_unit:
            raise HTTPException(409, '任务单位已修改，请仅保留专注记录，再从任务中记录成果')
        if row.is_course:
            if not body.course_indices or any(index >= len(task.course_items or []) or task.course_items[index]['name'].endswith('/') for index in body.course_indices):
                raise HTTPException(422, '请选择实际完成的课程条目')
            base = await tracker.set_course(session, owner_id, task.id, CourseUpdate(indices=body.course_indices, done=True))
        else:
            amount = body.amount
            factor = {'秒': 1, '分钟': 60, '小时': 3600}.get(row.task_unit)
            if factor:
                allowed = seconds // factor
                amount = amount if amount is not None else allowed
                if amount > allowed:
                    raise HTTPException(422, '完成量不能超过实际专注时长')
            if not amount:
                raise HTTPException(422, '请输入实际完成量，至少一个单位')
            base = await tracker.create_record(session, owner_id, task.id, ProgressRecordCreate(
                amount=amount, note=body.note or f'番茄钟：有效专注 {seconds // 60} 分钟', request_id=row.id))
            row.progress_record_id = base['record'].id
    row.settled_at = now
    row.settlement_fingerprint = fingerprint
    row.active_slot = None
    prefs.revision += 1
    await session.flush()
    if row.status == 'completed' and prefs.auto_start_break and await current(session, owner_id) is None:
        phase = 'long_break' if row.cycle_round == row.cycle_length else 'short_break'
        rest = FocusSession(owner_id=owner_id, request_id=uuid4(), active_slot=1, task_id=row.task_id if row.task and row.task.deleted_at is None else None,
            task_name=row.task_name, task_unit=row.task_unit, is_course=row.is_course,
            phase=phase, status='running', duration_seconds=row.break_seconds, break_seconds=row.break_seconds,
            cycle_round=row.cycle_round, cycle_length=row.cycle_length, started_at=now, parent_id=row.id,
            intervals=[FocusInterval(started_at=now)])
        session.add(rest)
        await session.flush()
    return await mutation(session, owner_id, base)


async def claim_notification(session: AsyncSession, owner_id: str, session_id: UUID) -> dict:
    prefs = await preferences(session, owner_id)
    row = await owned_session(session, owner_id, session_id)
    synchronize(row, prefs, utcnow())
    claimed = row.status == 'completed' and row.settled_at is None and row.notified_at is None
    if claimed:
        row.notified_at = utcnow()
        prefs.revision += 1
    await session.flush()
    return await mutation(session, owner_id, claimed=claimed)


async def migrate_owner(session: AsyncSession, source: str, target: str) -> None:
    prefs = await session.get(FocusPreferences, source)
    if prefs is None:
        return
    target_prefs = await session.get(FocusPreferences, target)
    source_active = await current(session, source)
    target_active = await current(session, target)
    now = utcnow()
    synchronize(source_active, prefs, now)
    if source_active and target_active:
        for interval in source_active.intervals:
            if interval.ended_at is None:
                interval.ended_at = now
        if source_active.status in ('running', 'paused'):
            source_active.status, source_active.ended_at = 'ended', now
        source_active.active_slot, source_active.settled_at = None, now
        source_active.settlement_fingerprint = settlement_fingerprint(FocusSettle())
        await session.flush()
    requests = set((await session.scalars(select(FocusSession.request_id).where(FocusSession.owner_id == target))).all())
    rows = (await session.scalars(select(FocusSession).where(FocusSession.owner_id == source))).all()
    for row in rows:
        if row.request_id in requests:
            row.request_id = uuid4()
        row.owner_id = target
    if target_prefs:
        target_prefs.rounds_completed += prefs.rounds_completed
        target_prefs.revision += 1
        await session.delete(prefs)
    else:
        prefs.owner_id = target
        prefs.revision += 1
    await session.flush()


async def export_sessions(session: AsyncSession, owner_id: str) -> dict:
    data = await state(session, owner_id)
    rows = (await session.scalars(select(FocusSession).where(FocusSession.owner_id == owner_id).order_by(FocusSession.started_at))).all()
    return {'settings': data['settings'], 'sessions': [{**output(row, utcnow()),
        'intervals': [{'started_at': aware(item.started_at), 'ended_at': aware(item.ended_at) if item.ended_at else None} for item in row.intervals]} for row in rows]}
