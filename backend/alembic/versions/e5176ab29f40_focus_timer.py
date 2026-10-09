"""Persist owner-scoped timers, pauses and idempotent task settlements.

Revision ID: e5176ab29f40
Revises: d2067ac84e11
"""
from alembic import op
import sqlalchemy as sa

revision = 'e5176ab29f40'
down_revision = 'd2067ac84e11'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('focus_preferences',
        sa.Column('generation', sa.Uuid(), nullable=False),
        sa.Column('owner_id', sa.String(100), nullable=False),
        sa.Column('focus_minutes', sa.Integer(), nullable=False),
        sa.Column('short_break_minutes', sa.Integer(), nullable=False),
        sa.Column('long_break_minutes', sa.Integer(), nullable=False),
        sa.Column('long_break_interval', sa.Integer(), nullable=False),
        sa.Column('auto_start_break', sa.Boolean(), nullable=False),
        sa.Column('rounds_completed', sa.Integer(), nullable=False),
        sa.Column('revision', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['owner_id'], ['owners.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('owner_id'))
    op.create_table('focus_sessions',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('owner_id', sa.String(100), nullable=False),
        sa.Column('request_id', sa.Uuid(), nullable=False),
        sa.Column('active_slot', sa.Integer(), nullable=True),
        sa.Column('task_id', sa.Uuid(), nullable=True),
        sa.Column('task_name', sa.String(100), nullable=False),
        sa.Column('task_unit', sa.String(12), nullable=False),
        sa.Column('is_course', sa.Boolean(), nullable=False),
        sa.Column('phase', sa.String(20), nullable=False),
        sa.Column('status', sa.String(20), nullable=False),
        sa.Column('duration_seconds', sa.Integer(), nullable=False),
        sa.Column('break_seconds', sa.Integer(), nullable=False),
        sa.Column('cycle_round', sa.Integer(), nullable=False),
        sa.Column('cycle_length', sa.Integer(), nullable=False),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('ended_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('settled_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('notified_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('start_fingerprint', sa.String(64), nullable=True),
        sa.Column('settlement_fingerprint', sa.String(64), nullable=True),
        sa.Column('progress_record_id', sa.Uuid(), nullable=True),
        sa.Column('parent_id', sa.Uuid(), nullable=True),
        sa.ForeignKeyConstraint(['owner_id'], ['owners.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['task_id'], ['tasks.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['progress_record_id'], ['progress_records.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['parent_id'], ['focus_sessions.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('owner_id', 'active_slot', name='uq_focus_owner_active'),
        sa.UniqueConstraint('owner_id', 'request_id', name='uq_focus_owner_request'),
        sa.CheckConstraint("phase IN ('focus', 'short_break', 'long_break')", name='ck_focus_phase'),
        sa.CheckConstraint("status IN ('running', 'paused', 'completed', 'ended')", name='ck_focus_status'),
        sa.CheckConstraint('duration_seconds >= 60 AND duration_seconds <= 10800', name='ck_focus_duration'),
        sa.CheckConstraint('active_slot IS NULL OR active_slot = 1', name='ck_focus_active_slot'))
    op.create_index('ix_focus_owner_started', 'focus_sessions', ['owner_id', 'started_at'])
    op.create_table('focus_intervals',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('session_id', sa.Uuid(), nullable=False),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('ended_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['session_id'], ['focus_sessions.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'))
    op.create_index('ix_focus_interval_session', 'focus_intervals', ['session_id'])


def downgrade() -> None:
    op.drop_index('ix_focus_interval_session', table_name='focus_intervals')
    op.drop_table('focus_intervals')
    op.drop_index('ix_focus_owner_started', table_name='focus_sessions')
    op.drop_table('focus_sessions')
    op.drop_table('focus_preferences')
