import uuid
from datetime import date, datetime, timezone

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
    target: Mapped[int] = mapped_column(Integer, default=1)
    progress: Mapped[int] = mapped_column(Integer, default=0)
    is_done: Mapped[bool] = mapped_column(Boolean, default=False)
    done_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    priority: Mapped[str] = mapped_column(String(10), default='medium')
    position: Mapped[float] = mapped_column(Float, default=0)
    reward_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey('rewards.id', ondelete='SET NULL'))
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
    history: Mapped[list['DailyHistory']] = relationship(back_populates='task', cascade='all, delete-orphan', lazy='selectin')


class DailyHistory(Base):
    __tablename__ = 'daily_history'
    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey('tasks.id', ondelete='CASCADE'), primary_key=True)
    date: Mapped[date] = mapped_column(Date, primary_key=True)
    completed: Mapped[bool] = mapped_column(Boolean, default=False)
    progress: Mapped[int] = mapped_column(Integer, default=0)
    task: Mapped[Task] = relationship(back_populates='history')


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
