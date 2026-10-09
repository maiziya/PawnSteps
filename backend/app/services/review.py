"""Weekly projections preserve units, work dates, rest days and measured timer time."""
from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import FocusInterval, FocusPreferences, FocusSession, ProgressRecord, Task
from app.services import focus, schedules, tracker


def business_date(value: datetime) -> date:
    return tracker.aware(value).astimezone(ZoneInfo(settings.timezone)).date()


def boundary(day: date) -> datetime:
    return datetime.combine(day, time.min, ZoneInfo(settings.timezone)).astimezone(timezone.utc)


async def weekly(session: AsyncSession, owner_id: str, week_of: date | None) -> dict:
    today = tracker.today()
    selected = week_of or today
    monday = selected - timedelta(days=selected.weekday())
    current_monday = today - timedelta(days=today.weekday())
    if monday > current_monday or monday < date(2000, 1, 3):
        raise HTTPException(422, '请选择 2000 年以来且不晚于本周的日期')
    sunday = monday + timedelta(days=6)
    through = min(sunday, today)
    elapsed_days = (through - monday).days + 1
    previous_start = monday - timedelta(days=7)
    previous_end = previous_start + timedelta(days=elapsed_days - 1)
    now = tracker.utcnow()

    # Rebuild the same projections as the calendar before reading their history.
    await tracker.snapshot(session, owner_id)
    tasks = list((await session.scalars(select(Task).where(Task.owner_id == owner_id, Task.deleted_at.is_(None)))).all())
    by_id = {task.id: task for task in tasks}
    amounts: dict[tuple, int] = defaultdict(int)
    if tasks:
        rows = (await session.execute(select(ProgressRecord.task_id, ProgressRecord.date, func.sum(ProgressRecord.amount))
            .join(Task).where(Task.owner_id == owner_id, Task.deleted_at.is_(None),
                ProgressRecord.deleted_at.is_(None), ProgressRecord.date >= previous_start, ProgressRecord.date <= through)
            .group_by(ProgressRecord.task_id, ProgressRecord.date))).all()
        for task_id, day, amount in rows:
            if by_id[task_id].course_items is None:
                amounts[(task_id, day)] = amount
    for task in tasks:
        for item in task.course_items or []:
            if item.get('done') and not item['name'].endswith('/') and item.get('done_date'):
                day = date.fromisoformat(item['done_date'])
                if previous_start <= day <= through:
                    amounts[(task.id, day)] += 1
    achieved = {(task.id, row.date) for task in tasks for row in task.history
                if row.completed and row.quota > 0 and amounts.get((task.id, row.date), 0) > 0}

    # Clamp a late running round at its deadline before measuring intervals.
    prefs = await session.get(FocusPreferences, owner_id)
    if prefs is not None:
        focus.synchronize(await focus.current(session, owner_id), prefs, now)
        await session.flush()
    intervals = (await session.execute(select(FocusInterval.started_at, FocusInterval.ended_at)
        .join(FocusSession).where(FocusSession.owner_id == owner_id, FocusSession.phase == 'focus',
            FocusInterval.started_at < boundary(through + timedelta(days=1)),
            (FocusInterval.ended_at.is_(None) | (FocusInterval.ended_at > boundary(previous_start)))))).all()
    focused: dict[date, float] = defaultdict(float)
    for first, last in intervals:
        start = max(tracker.aware(first), boundary(previous_start))
        end = min(tracker.aware(last) if last else now, now, boundary(through + timedelta(days=1)))
        while start < end:
            day = business_date(start)
            next_midnight = boundary(day + timedelta(days=1))
            until = min(end, next_midnight)
            focused[day] += (until - start).total_seconds()
            start = until
    rounds = (await session.scalars(select(FocusSession.ended_at).where(FocusSession.owner_id == owner_id,
        FocusSession.phase == 'focus', FocusSession.status == 'completed',
        FocusSession.ended_at >= boundary(previous_start), FocusSession.ended_at < boundary(through + timedelta(days=1))))).all()
    round_days = [business_date(ended) for ended in rounds if tracker.aware(ended) <= now]

    def period(start: date, end: date, *, display_end: date | None = None) -> dict:
        unit_totals: dict[str, int] = defaultdict(int)
        task_totals: dict = defaultdict(int)
        task_achievements: dict = defaultdict(int)
        days = []
        active_days = 0
        achieved_days = 0
        for offset in range(((display_end or end) - start).days + 1):
            day = start + timedelta(days=offset)
            future = day > end
            work = []
            day_achieved = 0
            if not future:
                for task in tasks:
                    amount = amounts.get((task.id, day), 0)
                    if amount <= 0:
                        continue
                    unit = '节' if task.course_items is not None else task.unit
                    met = int((task.id, day) in achieved)
                    work.append({'task_id': task.id, 'name': task.name, 'unit': unit, 'amount': amount, 'achieved_days': met})
                    task_totals[task.id] += amount
                    task_achievements[task.id] += met
                    unit_totals[unit] += amount
                    day_achieved += met
                active_days += bool(work or focused.get(day, 0) >= 1)
                achieved_days += day_achieved > 0
            days.append({'date': day, 'task_count': len(work), 'achieved_count': day_achieved,
                'focus_seconds': int(focused.get(day, 0)) if not future else 0,
                'is_rest': not future and schedules.rest_day(tasks, day), 'is_future': future,
                'tasks': sorted(work, key=lambda item: (-item['achieved_days'], item['name']))})
        work = [{'task_id': key, 'name': by_id[key].name, 'unit': '节' if by_id[key].course_items is not None else by_id[key].unit,
                 'amount': amount, 'achieved_days': task_achievements[key]} for key, amount in task_totals.items()]
        completed = sum(task.is_done and task.target > 0 and task.progress >= task.target and task.done_at is not None and start <= business_date(task.done_at) <= end for task in tasks)
        return {'start': start, 'end': end, 'summary': {'active_tasks': len(task_totals), 'active_days': active_days,
            'achieved_days': achieved_days, 'completed_tasks': completed,
            'focus_seconds': int(sum(seconds for day, seconds in focused.items() if start <= day <= end)),
            'pomodoros': sum(start <= day <= end for day in round_days), 'quantities': dict(sorted(unit_totals.items()))},
            'days': days, 'tasks': sorted(work, key=lambda item: (-item['achieved_days'], item['name'], str(item['task_id'])))}

    return {'today': today, 'timezone': settings.timezone, 'week_start': monday, 'week_end': sunday,
        'through_date': through, 'is_current_week': monday == current_monday, 'elapsed_days': elapsed_days,
        'current': period(monday, through, display_end=sunday), 'previous': period(previous_start, previous_end)}
