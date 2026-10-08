"""Initial PawnSteps schema

Revision ID: 69db7a4297fb
Revises:
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '69db7a4297fb'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('auth_rates',
    sa.Column('key', sa.String(length=255), nullable=False),
    sa.Column('count', sa.Integer(), nullable=False),
    sa.Column('window_start', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('key')
    )
    op.create_table('email_codes',
    sa.Column('email', sa.String(length=254), nullable=False),
    sa.Column('code', sa.String(length=128), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('sent_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('attempts', sa.Integer(), nullable=False),
    sa.PrimaryKeyConstraint('email')
    )
    op.create_table('owners',
    sa.Column('id', sa.String(length=100), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('users',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('username', sa.String(length=100), nullable=True),
    sa.Column('email', sa.String(length=254), nullable=True),
    sa.Column('password_hash', sa.String(length=255), nullable=True),
    sa.Column('avatar_url', sa.String(length=500), nullable=True),
    sa.Column('wechat_openid', sa.String(length=128), nullable=True),
    sa.Column('is_premium', sa.Boolean(), nullable=False),
    sa.Column('is_admin', sa.Boolean(), nullable=False),
    sa.Column('token_version', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('email'),
    sa.UniqueConstraint('username'),
    sa.UniqueConstraint('wechat_openid')
    )
    op.create_table('auth_states',
    sa.Column('id', sa.String(length=128), nullable=False),
    sa.Column('purpose', sa.String(length=20), nullable=False),
    sa.Column('guest_owner', sa.String(length=100), nullable=True),
    sa.Column('browser_hash', sa.String(length=128), nullable=True),
    sa.Column('user_id', sa.Uuid(), nullable=True),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('rewards',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('name', sa.String(length=100), nullable=False),
    sa.Column('image_url', sa.String(length=500), nullable=True),
    sa.Column('is_unlocked', sa.Boolean(), nullable=False),
    sa.Column('position', sa.Float(), nullable=False),
    sa.Column('streak_target', sa.Integer(), nullable=True),
    sa.Column('streak_claimed', sa.Boolean(), nullable=False),
    sa.Column('owner_id', sa.String(length=100), nullable=False),
    sa.ForeignKeyConstraint(['owner_id'], ['owners.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('owner_id', 'streak_target', name='uq_reward_owner_streak')
    )
    op.create_index(op.f('ix_rewards_owner_id'), 'rewards', ['owner_id'], unique=False)
    op.create_table('tasks',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('name', sa.String(length=100), nullable=False),
    sa.Column('description', sa.String(length=200), nullable=False),
    sa.Column('target', sa.Integer(), nullable=False),
    sa.Column('progress', sa.Integer(), nullable=False),
    sa.Column('is_done', sa.Boolean(), nullable=False),
    sa.Column('done_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('priority', sa.String(length=10), nullable=False),
    sa.Column('position', sa.Float(), nullable=False),
    sa.Column('reward_id', sa.Uuid(), nullable=True),
    sa.Column('daily_quota', sa.Integer(), nullable=False),
    sa.Column('daily_progress', sa.Integer(), nullable=False),
    sa.Column('daily_done', sa.Boolean(), nullable=False),
    sa.Column('daily_date', sa.Date(), nullable=True),
    sa.Column('daily_plan', sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql'), nullable=True),
    sa.Column('plan_start_date', sa.Date(), nullable=True),
    sa.Column('course_items', sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql'), nullable=True),
    sa.Column('owner_id', sa.String(length=100), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('undo_token', sa.String(length=128), nullable=True),
    sa.Column('undo_expires_at', sa.DateTime(timezone=True), nullable=True),
    sa.CheckConstraint("priority IN ('high', 'medium', 'low')", name='ck_task_priority'),
    sa.CheckConstraint('target >= 0 AND progress >= 0 AND progress <= target', name='ck_task_progress'),
    sa.ForeignKeyConstraint(['owner_id'], ['owners.id'], ),
    sa.ForeignKeyConstraint(['reward_id'], ['rewards.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('owner_id', 'name', name='uq_task_owner_name'),
    sa.UniqueConstraint('undo_token')
    )
    op.create_index('ix_task_owner_position', 'tasks', ['owner_id', 'position'], unique=False)
    op.create_index(op.f('ix_tasks_owner_id'), 'tasks', ['owner_id'], unique=False)
    op.create_table('daily_history',
    sa.Column('task_id', sa.Uuid(), nullable=False),
    sa.Column('date', sa.Date(), nullable=False),
    sa.Column('completed', sa.Boolean(), nullable=False),
    sa.Column('progress', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['task_id'], ['tasks.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('task_id', 'date')
    )


def downgrade() -> None:
    op.drop_table('daily_history')
    op.drop_index(op.f('ix_tasks_owner_id'), table_name='tasks')
    op.drop_index('ix_task_owner_position', table_name='tasks')
    op.drop_table('tasks')
    op.drop_index(op.f('ix_rewards_owner_id'), table_name='rewards')
    op.drop_table('rewards')
    op.drop_table('auth_states')
    op.drop_table('users')
    op.drop_table('owners')
    op.drop_table('email_codes')
    op.drop_table('auth_rates')
