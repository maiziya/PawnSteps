import uuid
from datetime import date, datetime, timezone
from datetime import date as DateValue

from sqlalchemy import JSON, Boolean, CheckConstraint, Date, DateTime, Float, ForeignKey, Index, Integer, String, UniqueConstraint, Uuid
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Owner(Base):
    __tablename__ = 'owners'
    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class User(Base):
    __tablename__ = 'users'
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    username: Mapped[str | None] = mapped_column(String(100), unique=True)
    email: Mapped[str | None] = mapped_column(String(254), unique=True)
    password_hash: Mapped[str | None] = mapped_column(String(255))
    avatar_url: Mapped[str | None] = mapped_column(String(500))
    wechat_openid: Mapped[str | None] = mapped_column(String(128), unique=True)
    is_premium: Mapped[bool] = mapped_column(Boolean, default=False)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    token_version: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Reward(Base):
    __tablename__ = 'rewards'
    __table_args__ = (UniqueConstraint('owner_id', 'streak_target', name='uq_reward_owner_streak'),)
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(100))
    image_url: Mapped[str | None] = mapped_column(String(500))
    is_unlocked: Mapped[bool] = mapped_column(Boolean, default=False)
    position: Mapped[float] = mapped_column(Float, default=0)
    streak_target: Mapped[int | None] = mapped_column(Integer)
    streak_claimed: Mapped[bool] = mapped_column(Boolean, default=False)
    owner_id: Mapped[str] = mapped_column(ForeignKey('owners.id'), index=True)


class Task(Base):
    __tablename__ = 'tasks'
    __table_args__ = (
        UniqueConstraint('owner_id', 'name', name='uq_task_owner_name'),
        CheckConstraint('target >= 0 AND progress >= 0 AND progress <= target', name='ck_task_progress'),
        CheckConstraint("priority IN ('high', 'medium', 'low')", name='ck_task_priority'),
        Index('ix_task_owner_position', 'owner_id', 'position'),
    )
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str] = mapped_column(String(200), default='')
    unit: Mapped[str] = mapped_column(String(12), default='步', server_default='步')
    target: Mapped[int] = mapped_column(Integer, default=1)
    progress: Mapped[int] = mapped_column(Integer, default=0)
    is_done: Mapped[bool] = mapped_column(Boolean, default=False)
    done_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    priority: Mapped[str] = mapped_column(String(10), default='medium')
    position: Mapped[float] = mapped_column(Float, default=0)
    reward_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey('rewards.id', ondelete='SET NULL'))
    daily_goal: Mapped[int | None] = mapped_column(Integer, nullable=True)
    daily_minimum: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    daily_quota: Mapped[int] = mapped_column(Integer, default=0)
    daily_progress: Mapped[int] = mapped_column(Integer, default=0)
    daily_done: Mapped[bool] = mapped_column(Boolean, default=False)
    daily_date: Mapped[date | None] = mapped_column(Date)
    daily_plan: Mapped[list[int] | None] = mapped_column(JSON().with_variant(JSONB, 'postgresql'))
    plan_start_date: Mapped[date | None] = mapped_column(Date)
    course_items: Mapped[list[dict] | None] = mapped_column(JSON().with_variant(JSONB, 'postgresql'))
    owner_id: Mapped[str] = mapped_column(ForeignKey('owners.id'), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    undo_token: Mapped[str | None] = mapped_column(String(128), unique=True)
    undo_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    schedules: Mapped[list['TaskSchedule']] = relationship(back_populates='task', cascade='all, delete-orphan', lazy='selectin')
    history: Mapped[list['DailyHistory']] = relationship(back_populates='task', cascade='all, delete-orphan', lazy='selectin')
    records: Mapped[list['ProgressRecord']] = relationship(back_populates='task', cascade='all, delete-orphan')


class TaskSchedule(Base):
    __tablename__ = 'task_schedules'
    __table_args__ = (
        CheckConstraint("mode IN ('daily', 'weekdays', 'weekly')", name='ck_schedule_mode'),
        CheckConstraint('weekly_target IS NULL OR (weekly_target >= 1 AND weekly_target <= 7)', name='ck_schedule_weekly_target'),
    )
    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey('tasks.id', ondelete='CASCADE'), primary_key=True)
    starts_on: Mapped[DateValue] = mapped_column(Date, primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    mode: Mapped[str] = mapped_column(String(16))
    weekdays: Mapped[list[int]] = mapped_column(JSON().with_variant(JSONB, 'postgresql'), default=list)
    weekly_target: Mapped[int | None] = mapped_column(Integer, nullable=True)
    task: Mapped['Task'] = relationship(back_populates='schedules')


class DayPlanItem(Base):
    __tablename__ = 'day_plan_items'
    __table_args__ = (
        UniqueConstraint('owner_id', 'date', 'task_id', name='uq_day_plan_owner_date_task'),
        CheckConstraint('position >= 0 AND position <= 2', name='ck_day_plan_position'),
    )
    owner_id: Mapped[str] = mapped_column(ForeignKey('owners.id', ondelete='CASCADE'), primary_key=True)
    date: Mapped[DateValue] = mapped_column(Date, primary_key=True)
    position: Mapped[int] = mapped_column(Integer, primary_key=True)
    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey('tasks.id', ondelete='CASCADE'), index=True)


class DailyHistory(Base):
    __tablename__ = 'daily_history'
    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey('tasks.id', ondelete='CASCADE'), primary_key=True)
    date: Mapped[date] = mapped_column(Date, primary_key=True)
    completed: Mapped[bool] = mapped_column(Boolean, default=False)
    progress: Mapped[int] = mapped_column(Integer, default=0)
    quota: Mapped[int] = mapped_column(Integer, default=0, server_default='0')
    task: Mapped[Task] = relationship(back_populates='history')


class ProgressRecord(Base):
    __tablename__ = 'progress_records'
    __table_args__ = (
        UniqueConstraint('task_id', 'request_id', name='uq_record_task_request'),
        CheckConstraint('amount > 0 AND amount <= 1000000', name='ck_record_amount'),
        CheckConstraint("source IN ('manual', 'legacy')", name='ck_record_source'),
        Index('ix_record_task_date', 'task_id', 'date', 'created_at'),
    )
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey('tasks.id', ondelete='CASCADE'))
    amount: Mapped[int] = mapped_column(Integer)
    note: Mapped[str] = mapped_column(String(200), default='')
    date: Mapped[DateValue | None] = mapped_column(Date, nullable=True)
    source: Mapped[str] = mapped_column(String(10), default='manual')
    request_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    request_fingerprint: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    task: Mapped[Task] = relationship(back_populates='records')
    adjustments: Mapped[list['ProgressAdjustment']] = relationship(back_populates='record', cascade='all, delete-orphan')


class ProgressAdjustment(Base):
    """A decrement receipt survives record edits and revocation for safe retries."""
    __tablename__ = 'progress_adjustments'
    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey('tasks.id', ondelete='CASCADE'), primary_key=True)
    request_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    record_id: Mapped[uuid.UUID] = mapped_column(ForeignKey('progress_records.id', ondelete='CASCADE'), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    record: Mapped[ProgressRecord] = relationship(back_populates='adjustments')


class FocusPreferences(Base):
    __tablename__ = 'focus_preferences'
    generation: Mapped[uuid.UUID] = mapped_column(Uuid, default=uuid.uuid4)
    owner_id: Mapped[str] = mapped_column(ForeignKey('owners.id', ondelete='CASCADE'), primary_key=True)
    focus_minutes: Mapped[int] = mapped_column(Integer, default=25)
    short_break_minutes: Mapped[int] = mapped_column(Integer, default=5)
    long_break_minutes: Mapped[int] = mapped_column(Integer, default=15)
    long_break_interval: Mapped[int] = mapped_column(Integer, default=4)
    auto_start_break: Mapped[bool] = mapped_column(Boolean, default=True)
    rounds_completed: Mapped[int] = mapped_column(Integer, default=0)
    revision: Mapped[int] = mapped_column(Integer, default=0)


class FocusSession(Base):
    __tablename__ = 'focus_sessions'
    __table_args__ = (
        UniqueConstraint('owner_id', 'active_slot', name='uq_focus_owner_active'),
        UniqueConstraint('owner_id', 'request_id', name='uq_focus_owner_request'),
        CheckConstraint("phase IN ('focus', 'short_break', 'long_break')", name='ck_focus_phase'),
        CheckConstraint("status IN ('running', 'paused', 'completed', 'ended')", name='ck_focus_status'),
        CheckConstraint('duration_seconds >= 60 AND duration_seconds <= 10800', name='ck_focus_duration'),
        CheckConstraint('active_slot IS NULL OR active_slot = 1', name='ck_focus_active_slot'),
        Index('ix_focus_owner_started', 'owner_id', 'started_at'),
    )
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[str] = mapped_column(ForeignKey('owners.id', ondelete='CASCADE'))
    request_id: Mapped[uuid.UUID] = mapped_column(Uuid)
    active_slot: Mapped[int | None] = mapped_column(Integer)
    task_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey('tasks.id', ondelete='SET NULL'))
    task_name: Mapped[str] = mapped_column(String(100), default='自由专注')
    task_unit: Mapped[str] = mapped_column(String(12), default='分钟')
    is_course: Mapped[bool] = mapped_column(Boolean, default=False)
    phase: Mapped[str] = mapped_column(String(20))
    status: Mapped[str] = mapped_column(String(20), default='running')
    duration_seconds: Mapped[int] = mapped_column(Integer)
    break_seconds: Mapped[int] = mapped_column(Integer, default=300)
    cycle_round: Mapped[int] = mapped_column(Integer, default=1)
    cycle_length: Mapped[int] = mapped_column(Integer, default=4)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    settled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    notified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    start_fingerprint: Mapped[str | None] = mapped_column(String(64))
    settlement_fingerprint: Mapped[str | None] = mapped_column(String(64))
    progress_record_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey('progress_records.id', ondelete='SET NULL'))
    parent_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey('focus_sessions.id', ondelete='SET NULL'))
    task: Mapped[Task | None] = relationship(lazy='selectin')
    intervals: Mapped[list['FocusInterval']] = relationship(back_populates='session', cascade='all, delete-orphan', lazy='selectin')


class FocusInterval(Base):
    __tablename__ = 'focus_intervals'
    __table_args__ = (Index('ix_focus_interval_session', 'session_id'),)
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(ForeignKey('focus_sessions.id', ondelete='CASCADE'))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    session: Mapped[FocusSession] = relationship(back_populates='intervals')


class EmailCode(Base):
    __tablename__ = 'email_codes'
    email: Mapped[str] = mapped_column(String(254), primary_key=True)
    code: Mapped[str] = mapped_column(String(128))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    attempts: Mapped[int] = mapped_column(Integer, default=0)


class AuthState(Base):
    __tablename__ = 'auth_states'
    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    purpose: Mapped[str] = mapped_column(String(20))
    guest_owner: Mapped[str | None] = mapped_column(String(100))
    browser_hash: Mapped[str | None] = mapped_column(String(128))
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AuthRate(Base):
    __tablename__ = 'auth_rates'
    key: Mapped[str] = mapped_column(String(255), primary_key=True)
    count: Mapped[int] = mapped_column(Integer, default=0)
    window_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
