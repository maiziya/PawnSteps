"""Read-only weekly reports derived from dated work and measured focus intervals."""
from datetime import date
from uuid import UUID

from pydantic import BaseModel, Field


class ReviewTask(BaseModel):
    task_id: UUID
    name: str
    unit: str
    amount: int
    achieved_days: int


class ReviewDay(BaseModel):
    date: date
    task_count: int
    achieved_count: int
    focus_seconds: int
    is_rest: bool
    is_future: bool
    tasks: list[ReviewTask]


class ReviewSummary(BaseModel):
    active_tasks: int
    active_days: int
    achieved_days: int
    completed_tasks: int
    focus_seconds: int
    pomodoros: int
    quantities: dict[str, int]


class ReviewPeriod(BaseModel):
    start: date
    end: date
    summary: ReviewSummary
    days: list[ReviewDay]
    tasks: list[ReviewTask]


class WeeklyReview(BaseModel):
    today: date
    timezone: str
    week_start: date
    week_end: date
    through_date: date
    is_current_week: bool
    elapsed_days: int = Field(ge=1, le=7)
    current: ReviewPeriod
    previous: ReviewPeriod
