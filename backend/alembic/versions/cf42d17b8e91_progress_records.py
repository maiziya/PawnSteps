"""Make progress records authoritative and preserve existing progress as legacy entries.

Revision ID: cf42d17b8e91
Revises: 69db7a4297fb
"""
from datetime import date, datetime, timezone
from datetime import date as DateValue
from uuid import UUID, uuid4

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column


revision = 'cf42d17b8e91'
down_revision = '69db7a4297fb'
branch_labels = None
depends_on = None


class MigrationBase(DeclarativeBase):
    pass


class LegacyTask(MigrationBase):
    """Revision-local mappings keep this backfill independent of future app models."""
    __tablename__ = 'tasks'
    id: Mapped[UUID] = mapped_column(sa.Uuid, primary_key=True)
    progress: Mapped[int] = mapped_column(sa.Integer)
    daily_quota: Mapped[int] = mapped_column(sa.Integer)
    daily_progress: Mapped[int] = mapped_column(sa.Integer)
    daily_done: Mapped[bool] = mapped_column(sa.Boolean)
    daily_date: Mapped[date | None] = mapped_column(sa.Date)
    daily_plan: Mapped[list[int] | None] = mapped_column(sa.JSON().with_variant(JSONB, 'postgresql'))
    plan_start_date: Mapped[date | None] = mapped_column(sa.Date)
    course_items: Mapped[list[dict] | None] = mapped_column(sa.JSON().with_variant(JSONB, 'postgresql'))


class LegacyHistory(MigrationBase):
    __tablename__ = 'daily_history'
    task_id: Mapped[UUID] = mapped_column(sa.Uuid, primary_key=True)
    date: Mapped[date] = mapped_column(sa.Date, primary_key=True)
    completed: Mapped[bool] = mapped_column(sa.Boolean)
    progress: Mapped[int] = mapped_column(sa.Integer)
    quota: Mapped[int] = mapped_column(sa.Integer)


class MigratedRecord(MigrationBase):
    __tablename__ = 'progress_records'
    id: Mapped[UUID] = mapped_column(sa.Uuid, primary_key=True)
    task_id: Mapped[UUID] = mapped_column(sa.Uuid)
    amount: Mapped[int] = mapped_column(sa.Integer)
    note: Mapped[str] = mapped_column(sa.String(200))
    date: Mapped[DateValue | None] = mapped_column(sa.Date, nullable=True)
    source: Mapped[str] = mapped_column(sa.String(10))
    request_id: Mapped[UUID | None] = mapped_column(sa.Uuid)
    request_fingerprint: Mapped[str | None] = mapped_column(sa.String(64))
    created_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True))
    deleted_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))


def _add_legacy(session: Session, task_id: UUID, amount: int, day: date | None, now: datetime,
                *, inferred: bool = False) -> None:
    if amount <= 0:
        return
    note = '迁移前累计进度，原始日期未知' if day is None else '迁移前的当日记录'
    if inferred:
        note = '根据迁移前达标记录及配额恢复'
    session.add(MigratedRecord(id=uuid4(), task_id=task_id, amount=amount, note=note,
        date=day, source='legacy', request_id=None, request_fingerprint=None,
        created_at=now, updated_at=now, deleted_at=None))


def _backfill() -> None:
    now = datetime.now(timezone.utc)
    with Session(bind=op.get_bind()) as session:
        for task in session.scalars(sa.select(LegacyTask)).all():
            if task.course_items is not None:
                continue
            if task.daily_plan is None and task.daily_quota == 0:
                # Old ordinary progress carries no work date; never attribute it to today.
                _add_legacy(session, task.id, task.progress, None, now)
                continue
            rows = list(session.scalars(sa.select(LegacyHistory).where(LegacyHistory.task_id == task.id)).all())
            if task.daily_date is not None and (task.daily_progress > 0 or task.daily_done):
                cached = next((row for row in rows if row.date == task.daily_date), None)
                if cached is None:
                    cached = LegacyHistory(task_id=task.id, date=task.daily_date,
                        completed=task.daily_done, progress=task.daily_progress, quota=0)
                    session.add(cached)
                    rows.append(cached)
                elif task.daily_progress > cached.progress:
                    cached.progress = task.daily_progress
                    cached.completed = cached.completed or task.daily_done
            for row in rows:
                amount = max(0, row.progress)
                if task.daily_plan is not None:
                    offset = (row.date - task.plan_start_date).days if task.plan_start_date else -1
                    quota = max(0, task.daily_plan[offset]) if 0 <= offset < len(task.daily_plan) else 0
                    row.quota = quota
                    # Scheduled rests remain automatic history, never numeric work.
                    if quota == 0:
                        continue
                elif row.completed:
                    # A completed historical row may predate a quota edit. Its old
                    # capped progress is evidence of the quota that it satisfied.
                    row.quota = amount if amount > 0 else task.daily_quota
                else:
                    # Preserve historical misses even if the quota was later lowered.
                    row.quota = max(task.daily_quota, amount + 1)
                inferred = row.completed and amount == 0
                if inferred:
                    amount = row.quota
                    row.progress = amount
                _add_legacy(session, task.id, amount, row.date, now, inferred=inferred)
        session.flush()
        session.commit()


def upgrade() -> None:
    op.add_column('tasks', sa.Column('unit', sa.String(12), nullable=False, server_default='步'))
    op.add_column('daily_history', sa.Column('quota', sa.Integer(), nullable=False, server_default='0'))
    op.create_table('progress_records',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('task_id', sa.Uuid(), nullable=False),
        sa.Column('amount', sa.Integer(), nullable=False),
        sa.Column('note', sa.String(200), nullable=False),
        sa.Column('date', sa.Date(), nullable=True),
        sa.Column('source', sa.String(10), nullable=False),
        sa.Column('request_id', sa.Uuid(), nullable=True),
        sa.Column('request_fingerprint', sa.String(64), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint('amount > 0 AND amount <= 1000000', name='ck_record_amount'),
        sa.CheckConstraint("source IN ('manual', 'legacy')", name='ck_record_source'),
        sa.ForeignKeyConstraint(['task_id'], ['tasks.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('task_id', 'request_id', name='uq_record_task_request'))
    op.create_index('ix_record_task_date', 'progress_records', ['task_id', 'date', 'created_at'])
    _backfill()


def downgrade() -> None:
    op.drop_index('ix_record_task_date', table_name='progress_records')
    op.drop_table('progress_records')
    op.drop_column('daily_history', 'quota')
    op.drop_column('tasks', 'unit')
