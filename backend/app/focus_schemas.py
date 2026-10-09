"""Validated timer contracts; durations and elapsed time are server controlled."""
from datetime import datetime, timezone
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

Phase = Literal['focus', 'short_break', 'long_break']


class FocusSettingsPatch(BaseModel):
    model_config = ConfigDict(extra='forbid')
    focus_minutes: int | None = Field(None, ge=1, le=180, strict=True)
    short_break_minutes: int | None = Field(None, ge=1, le=60, strict=True)
    long_break_minutes: int | None = Field(None, ge=1, le=120, strict=True)
    long_break_interval: int | None = Field(None, ge=1, le=12, strict=True)
    auto_start_break: bool | None = None


class FocusSettingsOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    focus_minutes: int
    short_break_minutes: int
    long_break_minutes: int
    long_break_interval: int
    auto_start_break: bool
    rounds_completed: int


class FocusStart(BaseModel):
    model_config = ConfigDict(extra='forbid')
    request_id: UUID
    task_id: UUID | None = None
    phase: Phase = 'focus'


class FocusSettle(BaseModel):
    model_config = ConfigDict(extra='forbid')
    record_progress: bool = False
    amount: int | None = Field(default=None, ge=1, le=1000000, strict=True)
    course_indices: list[int] = Field(default_factory=list, max_length=10000)
    note: str = Field(default='', max_length=200)

    @field_validator('course_indices')
    @classmethod
    def canonical_indices(cls, value: list[int]) -> list[int]:
        if any(index < 0 for index in value):
            raise ValueError('Course indices cannot be negative')
        return sorted(set(value))


class FocusSessionOut(BaseModel):
    id: UUID
    task_id: UUID | None
    task_name: str
    task_unit: str
    is_course: bool
    can_record: bool
    phase: Phase
    status: Literal['running', 'paused', 'completed', 'ended']
    duration_seconds: int
    elapsed_seconds: int
    remaining_seconds: int
    deadline_at: datetime | None
    started_at: datetime
    ended_at: datetime | None
    settled_at: datetime | None
    cycle_round: int
    cycle_length: int
    progress_record_id: UUID | None

    @field_validator('deadline_at', 'started_at', 'ended_at', 'settled_at')
    @classmethod
    def as_utc(cls, value: datetime | None) -> datetime | None:
        return value.replace(tzinfo=timezone.utc) if value is not None and value.tzinfo is None else value


class FocusSummary(BaseModel):
    today_seconds: int
    today_pomodoros: int
    total_pomodoros: int


class FocusState(BaseModel):
    owner_id: str
    revision: int
    generation: UUID
    server_now: datetime
    settings: FocusSettingsOut
    active_session: FocusSessionOut | None
    summary: FocusSummary
    recent_sessions: list[FocusSessionOut]
    notification_claimed: bool = False
