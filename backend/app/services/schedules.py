"""Calendar obligations, optional rest days and weekly check-in windows."""
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from app.config import settings
from app.models import Task, TaskSchedule
from app.schemas import ScheduleConfig


def _business_date(value: datetime) -> date:
    return (value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value).astimezone(ZoneInfo(settings.timezone)).date()


def configuration(task: Task, day: date) -> tuple[ScheduleConfig, date]:
    versions = [row for row in task.schedules if row.starts_on <= day]
    if versions:
        row = max(versions, key=lambda value: value.starts_on)
        return ScheduleConfig(mode=row.mode, weekdays=row.weekdays, weekly_target=row.weekly_target), row.starts_on
    start = min([_business_date(task.created_at), day, *[row.date for row in task.history]])
    return ScheduleConfig(), start


def set_schedule(task: Task, day: date, config: ScheduleConfig, enabled: bool) -> None:
    if not task.schedules:
        start = min([_business_date(task.created_at), day, *[row.date for row in task.history]])
        task.schedules.append(TaskSchedule(task_id=task.id, starts_on=start, enabled=eligible(task),
                                           mode='daily', weekdays=[], weekly_target=None))
    current, _ = configuration(task, day)
    if current == config and enabled_on(task, day) == enabled:
        return
    row = next((row for row in task.schedules if row.starts_on == day), None)
    if row is None:
        row = TaskSchedule(task_id=task.id, starts_on=day)
        task.schedules.append(row)
    row.mode, row.weekdays, row.weekly_target = config.mode, config.weekdays, config.weekly_target
    row.enabled = enabled


def enabled_on(task: Task, day: date) -> bool:
    versions = [row for row in task.schedules if row.starts_on <= day]
    return max(versions, key=lambda row: row.starts_on).enabled if versions else eligible(task)


def eligible(task: Task) -> bool:
    return bool(task.daily_quota or task.daily_minimum or task.daily_plan is not None)


def paused_on(task: Task, day: date) -> bool:
    return any(row.starts_on <= day and (row.ends_on is None or day < row.ends_on)
               for row in task.archive_periods)


def active_on(task: Task, day: date) -> bool:
    if paused_on(task, day):
        return False
    if not enabled_on(task, day):
        return False
    start = min([_business_date(task.created_at), *[row.starts_on for row in task.schedules], *[row.date for row in task.history]])
    if day < start:
        return False
    if task.daily_plan is not None:
        start = task.plan_start_date or start
        return start <= day < start + timedelta(days=len(task.daily_plan))
    if task.is_done:
        dated = [row.date for row in task.history if row.progress > 0]
        end = max(dated) if dated else _business_date(task.done_at or task.updated_at)
        if day > end:
            return False
    return True


def weekly_progress(task: Task, day: date) -> tuple[int, int | None]:
    config, effective = configuration(task, day)
    if config.mode != 'weekly':
        return 0, None
    # Changing the weekly target keeps days earned in the current weekly schedule.
    for row in sorted((row for row in task.schedules if row.starts_on <= day),
                      key=lambda row: row.starts_on, reverse=True):
        if row.mode != 'weekly' or not row.enabled:
            break
        effective = row.starts_on
    monday = day - timedelta(days=day.weekday())
    start = max(monday, effective)
    end = monday + timedelta(days=6)
    eligible_days = sum(not paused_on(task, start + timedelta(days=offset))
                        for offset in range((end - start).days + 1))
    target = min(config.weekly_target or 1, max(1, eligible_days))
    count = sum(row.completed and row.quota > 0 for row in task.history if start <= row.date <= day)
    return count, target


def due_on(task: Task, day: date) -> bool:
    if not active_on(task, day):
        return False
    if task.daily_plan is not None:
        index = (day - (task.plan_start_date or day)).days
        return task.daily_plan[index] > 0
    config, _ = configuration(task, day)
    if config.mode == 'weekdays':
        return day.weekday() in config.weekdays
    if config.mode == 'weekly':
        count, target = weekly_progress(task, day)
        return count < (target or 1)
    return True


def requires_checkin(task: Task, day: date) -> bool | None:
    if not active_on(task, day):
        return None
    config, _ = configuration(task, day)
    if config.mode == 'weekly':
        # Unchosen weekdays are flexible; a deficit becomes a miss at Sunday's deadline.
        return day.weekday() == 6 and due_on(task, day)
    return due_on(task, day)


def project(task: Task, day: date) -> None:
    config, _ = configuration(task, day)
    task.schedule = config
    task.is_scheduled_today = due_on(task, day) if enabled_on(task, day) else True
    task.weekly_completed, task.weekly_target = weekly_progress(task, day)
    pending = sorted((row for row in task.schedules if row.starts_on > day), key=lambda row: row.starts_on)
    task.pending_schedule = (ScheduleConfig(mode=pending[0].mode, weekdays=pending[0].weekdays,
                                           weekly_target=pending[0].weekly_target) if pending else None)
    task.pending_schedule_date = pending[0].starts_on if pending else None


def counts_today(task: Task, day: date) -> bool:
    """Keep optional work out of today's obligations, including after a weekly target is met."""
    if not active_on(task, day):
        return False
    config, _ = configuration(task, day)
    if config.mode == 'weekly':
        count, target = weekly_progress(task, day)
        achieved_today = any(row.date == day and row.completed and row.quota > 0 for row in task.history)
        return count - int(achieved_today) < (target or 1)
    return due_on(task, day)


def rest_day(tasks: list[Task], day: date) -> bool:
    active = [task for task in tasks if active_on(task, day)]
    return bool(active) and not any(due_on(task, day) for task in active)


def streak(tasks: list[Task], day: date) -> int:
    earned = {row.date for task in tasks for row in task.history
              if row.completed and row.quota > 0 and row.progress > 0 and row.date <= day}
    if not earned:
        return 0
    first = min(earned)
    count = 0
    while day >= first:
        if day in earned:
            count += 1
        else:
            obligations = [requires_checkin(task, day) for task in tasks]
            if any(value is True for value in obligations) or not any(value is False for value in obligations):
                break
        day -= timedelta(days=1)
    return count
