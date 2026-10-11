from datetime import date, datetime
from uuid import UUID
from pydantic import BaseModel, ConfigDict


class ReminderClaim(BaseModel):
    model_config = ConfigDict(extra='forbid')
    device_id: UUID


class ReminderReceipt(ReminderClaim):
    date: date
    token: UUID


class ReminderState(BaseModel):
    time: str = '10:00'
    timezone: str
    server_now: datetime
    date: date
    due: bool
    claimed: bool = False
    token: UUID | None = None
    title: str = 'PawnSteps · 今天也向前一步'
    body: str = ''
    task_count: int = 0
    url: str = '/#today'
