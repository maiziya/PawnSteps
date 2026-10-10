from datetime import date, datetime, timezone
from typing import Annotated, Literal
from uuid import UUID

from app.focus_schemas import FocusState

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class CourseItem(BaseModel):
    name: str = Field(min_length=1, max_length=500)
    done: bool = False
    done_date: date | None = None

    @field_validator('name')
    @classmethod
    def clean_name(cls, value: str) -> str:
        if not value.strip():
            raise ValueError('Course item name cannot be blank')
        return value.strip()


class ScheduleConfig(BaseModel):
    model_config = ConfigDict(extra='forbid')
    mode: Literal['daily', 'weekdays', 'weekly'] = 'daily'
    weekdays: list[Annotated[int, Field(ge=0, le=6, strict=True)]] = Field(default_factory=list, max_length=7)
    weekly_target: int | None = Field(default=None, ge=1, le=7, strict=True)

    @model_validator(mode='after')
    def validate_schedule(self) -> 'ScheduleConfig':
        if self.mode == 'weekdays':
            if not self.weekdays or len(set(self.weekdays)) != len(self.weekdays):
                raise ValueError('Choose at least one unique weekday')
            self.weekdays = sorted(self.weekdays)
        elif self.weekdays:
            raise ValueError('Weekdays are only used with the weekdays schedule')
        if self.mode == 'weekly' and self.weekly_target is None:
            raise ValueError('A weekly schedule needs a target from 1 to 7')
        if self.mode != 'weekly' and self.weekly_target is not None:
            raise ValueError('Weekly target is only used with the weekly schedule')
        return self


class TaskCreate(BaseModel):
    deadline: date | None = None
    schedule: ScheduleConfig = Field(default_factory=ScheduleConfig)
    name: str = Field(min_length=1, max_length=100)
    description: str = Field(default='', max_length=200)
    unit: str = Field(default='步', min_length=1, max_length=12)
    target: int = Field(default=1, ge=1, le=100)
    priority: Literal['high', 'medium', 'low'] = 'medium'
    reward_id: UUID | None = None
    daily_goal: int | None = Field(default=None, ge=1, le=10000)
    daily_minimum: int = Field(default=0, ge=0, le=10000)
    daily_quota: int = Field(default=0, ge=0, le=10000)
    daily_plan: list[int] | None = Field(default=None, min_length=1, max_length=730)
    plan_start_date: date | None = None
    course_items: list[CourseItem] | None = Field(default=None, min_length=1, max_length=10000)

    @field_validator('name', 'unit')
    @classmethod
    def clean_name(cls, value: str) -> str:
        if not value.strip():
            raise ValueError('Task name cannot be blank')
        return value.strip()

    @model_validator(mode='after')
    def check_type(self) -> 'TaskCreate':
        if self.schedule.mode != 'daily' and (self.daily_plan is not None or not (self.daily_quota or self.daily_minimum)):
            raise ValueError('Flexible schedules require a daily minimum and cannot override a day-by-day plan')
        effective_target = sum(not item.name.endswith('/') for item in self.course_items) if self.course_items is not None else self.target
        if self.daily_goal is not None:
            if self.daily_plan is not None:
                raise ValueError('Plan tasks derive daily goals from their schedule')
            if self.daily_goal < (self.daily_quota or self.daily_minimum):
                raise ValueError('Daily goal cannot be lower than the daily minimum')
            if not self.daily_quota and self.daily_goal > effective_target:
                raise ValueError('Daily goal cannot exceed the total target')
        if self.daily_minimum > effective_target:
            raise ValueError('Daily minimum cannot exceed the total target')
        if self.daily_minimum and (self.daily_quota or self.daily_plan is not None):
            raise ValueError('Daily minimum is configured separately on ordinary and course tasks')
        if self.daily_plan is not None:
            if any(value < -1 or value > 10000 for value in self.daily_plan):
                raise ValueError('Plan quotas must be between -1 and 10000')
            if sum(max(0, value) for value in self.daily_plan) > 1000000:
                raise ValueError('Plan total exceeds 1000000')
        if self.course_items is not None and (self.daily_plan is not None or self.daily_quota):
            raise ValueError('A course cannot also be a daily or plan task')
        if self.course_items is not None and not any(not item.name.endswith('/') for item in self.course_items):
            raise ValueError('A course needs at least one actual item')
        return self


class TaskPatch(BaseModel):
    deadline: date | None = None
    schedule: ScheduleConfig | None = None
    name: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=200)
    unit: str | None = Field(default=None, min_length=1, max_length=12)
    target: int | None = Field(default=None, ge=1, le=100)
    priority: Literal['high', 'medium', 'low'] | None = None
    reward_id: UUID | None = None
    daily_goal: int | None = Field(default=None, ge=1, le=10000)
    daily_minimum: int | None = Field(default=None, ge=0, le=10000)
    daily_quota: int | None = Field(default=None, ge=1, le=10000)

    @field_validator('name', 'unit')
    @classmethod
    def clean_name(cls, value: str | None) -> str | None:
        if value is not None and not value.strip():
            raise ValueError('Task name cannot be blank')
        return value.strip() if value else value


class ProgressRecordCreate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    amount: int = Field(ge=1, le=1000000, strict=True)
    note: str = Field(default='', max_length=200)
    request_id: UUID | None = None


class ProgressDecrement(BaseModel):
    model_config = ConfigDict(extra='forbid')
    request_id: UUID


class ProgressRecordPatch(BaseModel):
    model_config = ConfigDict(extra='forbid')
    amount: int | None = Field(default=None, ge=1, le=1000000, strict=True)
    note: str | None = Field(default=None, max_length=200)

    @model_validator(mode='after')
    def require_changes(self) -> 'ProgressRecordPatch':
        if not self.model_fields_set:
            raise ValueError('At least one record field is required')
        if any(getattr(self, key) is None for key in self.model_fields_set):
            raise ValueError('Record fields cannot be null')
        return self


class ProgressRecordOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    task_id: UUID
    amount: int
    note: str
    date: date | None
    source: Literal['manual', 'legacy']
    request_id: UUID | None
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None

    @field_validator('created_at', 'updated_at', 'deleted_at')
    @classmethod
    def utc_timestamp(cls, value: datetime | None) -> datetime | None:
        # SQLite drops timezone metadata; persisted timestamps are always UTC.
        if value is not None:
            return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
        return value


class ProgressRecordList(BaseModel):
    records: list[ProgressRecordOut]
    total: int
    offset: int
    limit: int


class CourseUpdate(BaseModel):
    indices: list[int] = Field(min_length=1, max_length=10000)
    done: bool


class Reorder(BaseModel):
    ids: list[UUID] = Field(max_length=10000)

    @field_validator('ids')
    @classmethod
    def unique_ids(cls, value: list[UUID]) -> list[UUID]:
        if len(set(value)) != len(value):
            raise ValueError('IDs must be unique')
        return value


class UndoRequest(BaseModel):
    token: str = Field(min_length=20, max_length=128)


class RewardCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    image_url: str | None = Field(default=None, max_length=500)

    @field_validator('name')
    @classmethod
    def clean_name(cls, value: str) -> str:
        if not value.strip():
            raise ValueError('Reward name cannot be blank')
        return value.strip()

    @field_validator('image_url')
    @classmethod
    def valid_image_url(cls, value: str | None) -> str | None:
        if value and not (value.startswith('/uploads/') or value.startswith('https://') or value.startswith('http://')):
            raise ValueError('Image must be an upload path or HTTP URL')
        return value


class RewardPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    image_url: str | None = Field(default=None, max_length=500)
    is_unlocked: bool | None = None

    @field_validator('name')
    @classmethod
    def clean_name(cls, value: str | None) -> str | None:
        if value is not None and not value.strip():
            raise ValueError('Reward name cannot be blank')
        return value.strip() if value else value

    @field_validator('image_url')
    @classmethod
    def valid_image_url(cls, value: str | None) -> str | None:
        return RewardCreate.valid_image_url(value)


class TaskOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    name: str
    description: str
    deadline: date | None = None
    unit: str
    target: int
    progress: int
    today_amount: int
    record_count: int
    plan_expired: bool
    schedule: ScheduleConfig
    pending_schedule: ScheduleConfig | None = None
    pending_schedule_date: date | None = None
    is_scheduled_today: bool
    weekly_completed: int
    weekly_target: int | None
    is_done: bool
    done_at: datetime | None
    priority: str
    position: float
    reward_id: UUID | None
    daily_goal: int | None
    daily_minimum: int
    daily_quota: int
    daily_progress: int
    daily_done: bool
    daily_date: date | None
    daily_plan: list[int] | None
    plan_start_date: date | None
    course_items: list[CourseItem] | None
    owner_id: str
    created_at: datetime
    updated_at: datetime
    archived_at: datetime | None = None

    @field_validator('archived_at')
    @classmethod
    def archive_timestamp(cls, value: datetime | None) -> datetime | None:
        return value.replace(tzinfo=timezone.utc) if value is not None and value.tzinfo is None else value

    @field_validator('created_at', 'updated_at')
    @classmethod
    def utc_timestamp(cls, value: datetime) -> datetime:
        # SQLite drops timezone metadata; persisted timestamps are always UTC.
        return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


class RewardOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    name: str
    image_url: str | None
    is_unlocked: bool
    position: float
    streak_target: int | None
    owner_id: str


class Stats(BaseModel):
    total: int
    completed: int
    in_progress: int
    xp: int
    streak: int
    today_completed: int
    today_total: int


class DayPlanUpdate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    date: date
    task_ids: list[UUID] = Field(max_length=3)

    @field_validator('task_ids')
    @classmethod
    def unique_tasks(cls, value: list[UUID]) -> list[UUID]:
        if len(set(value)) != len(value):
            raise ValueError('Task IDs must be unique')
        return value


class DayPlanOut(BaseModel):
    date: date
    task_ids: list[UUID]


class MutationResponse(BaseModel):
    today: date
    timezone: str
    tasks: list[TaskOut]
    archived_tasks: list[TaskOut] = Field(default_factory=list)
    rewards: list[RewardOut]
    stats: Stats
    today_plan: DayPlanOut
    unlocked_reward: RewardOut | None = None
    undo_token: str | None = None
    record: ProgressRecordOut | None = None
    focus: FocusState | None = None


class HistoryEntry(BaseModel):
    task_id: UUID
    task_name: str
    date: date
    completed: bool
    amount: int = 0
    unit: str = "步"
    task_kind: Literal["normal", "daily", "plan", "course"] = "daily"
    quota: int | None = None


class HistoryResponse(BaseModel):
    rest_dates: list[date] = Field(default_factory=list)
    history: list[HistoryEntry]
    streak: int
