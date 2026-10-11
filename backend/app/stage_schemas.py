from pydantic import BaseModel, ConfigDict, Field, field_validator


class TaskStage(BaseModel):
    model_config = ConfigDict(extra='forbid')
    value: int = Field(ge=1, le=1000000, strict=True)
    name: str = Field(default='', max_length=40)

    @field_validator('name')
    @classmethod
    def trim_name(cls, value: str) -> str:
        return value.strip()


class NextStage(TaskStage):
    remaining: int


class StageProgress(BaseModel):
    completed: int
    total: int
    next_stage: NextStage | None = None


def ordered_stages(value: list[TaskStage] | None) -> list[TaskStage] | None:
    if value is None:
        return None
    if len({stage.value for stage in value}) != len(value):
        raise ValueError('Stage values must be unique')
    return sorted(value, key=lambda stage: stage.value)
