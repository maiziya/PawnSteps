from datetime import datetime, timezone
from typing import Literal
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class TemplateCreate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    name: str = Field(min_length=1, max_length=60)
    source_task_id: UUID

    @field_validator('name')
    @classmethod
    def clean_name(cls, value: str) -> str:
        if not value.strip():
            raise ValueError('模板名称不能为空')
        return value.strip()


class TemplatePatch(BaseModel):
    model_config = ConfigDict(extra='forbid')
    name: str | None = Field(default=None, min_length=1, max_length=60)
    source_task_id: UUID | None = None

    @field_validator('name')
    @classmethod
    def clean_name(cls, value: str | None) -> str | None:
        if value is not None and not value.strip():
            raise ValueError('模板名称不能为空')
        return value.strip() if value else value

    @model_validator(mode='after')
    def changes_required(self) -> 'TemplatePatch':
        if not self.model_fields_set or any(getattr(self, field) is None for field in self.model_fields_set):
            raise ValueError('请提供有效的模板修改内容')
        return self


class TemplateSummary(BaseModel):
    id: str
    name: str
    kind: Literal['normal', 'daily', 'plan', 'course']
    target: int
    unit: str
    is_builtin: bool = False
    created_at: datetime | None = None
    updated_at: datetime | None = None

    @field_validator('created_at', 'updated_at')
    @classmethod
    def utc_timestamp(cls, value: datetime | None) -> datetime | None:
        return value.replace(tzinfo=timezone.utc) if value and value.tzinfo is None else value
