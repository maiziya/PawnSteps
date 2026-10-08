from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class CourseItem(BaseModel):
    name: str = Field(min_length=1, max_length=500)
    done: bool = False

    @field_validator('name')
    @classmethod
    def clean_name(cls, value: str) -> str:
        if not value.strip():
            raise ValueError('Course item name cannot be blank')
        return value.strip()


class TaskCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str = Field(default='', max_length=200)
    target: int = Field(default=1, ge=1, le=100)
    priority: Literal['high', 'medium', 'low'] = 'medium'
    reward_id: UUID | None = None
    daily_quota: int = Field(default=0, ge=0, le=10000)
    daily_plan: list[int] | None = Field(default=None, min_length=1, max_length=730)
    plan_start_date: date | None = None
    course_items: list[CourseItem] | None = Field(default=None, min_length=1, max_length=10000)

    @field_validator('name')
    @classmethod
    def clean_name(cls, value: str) -> str:
        if not value.strip():
            raise ValueError('Task name cannot be blank')
        return value.strip()

    @model_validator(mode='after')
    def check_type(self) -> 'TaskCreate':
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
    name: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=200)
    target: int | None = Field(default=None, ge=1, le=100)
    priority: Literal['high', 'medium', 'low'] | None = None
    reward_id: UUID | None = None
    daily_quota: int | None = Field(default=None, ge=1, le=10000)

    @field_validator('name')
    @classmethod
    def clean_name(cls, value: str | None) -> str | None:
        if value is not None and not value.strip():
            raise ValueError('Task name cannot be blank')
        return value.strip() if value else value


class ProgressUpdate(BaseModel):
    progress: int = Field(ge=0, le=1000000)


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
    target: int
    progress: int
    is_done: bool
    done_at: datetime | None
    priority: str
    position: float
    reward_id: UUID | None
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


class MutationResponse(BaseModel):
    today: date
    timezone: str
    tasks: list[TaskOut]
    rewards: list[RewardOut]
    stats: Stats
    unlocked_reward: RewardOut | None = None
    undo_token: str | None = None


class HistoryEntry(BaseModel):
    task_id: UUID
    task_name: str
    date: date
    completed: bool


class HistoryResponse(BaseModel):
    history: list[HistoryEntry]
    streak: int
