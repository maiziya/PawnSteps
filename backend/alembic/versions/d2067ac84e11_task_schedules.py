"""Date flexible task schedules so edits preserve historical obligations.

Revision ID: d2067ac84e11
Revises: c8451d92a307
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'd2067ac84e11'
down_revision = 'c8451d92a307'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('task_schedules',
        sa.Column('task_id', sa.Uuid(), nullable=False),
        sa.Column('starts_on', sa.Date(), nullable=False),
        sa.Column('enabled', sa.Boolean(), nullable=False),
        sa.Column('mode', sa.String(16), nullable=False),
        sa.Column('weekdays', sa.JSON().with_variant(postgresql.JSONB(), 'postgresql'), nullable=False),
        sa.Column('weekly_target', sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(['task_id'], ['tasks.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('task_id', 'starts_on'),
        sa.CheckConstraint("mode IN ('daily', 'weekdays', 'weekly')", name='ck_schedule_mode'),
        sa.CheckConstraint('weekly_target IS NULL OR (weekly_target >= 1 AND weekly_target <= 7)', name='ck_schedule_weekly_target'))


def downgrade() -> None:
    op.drop_table('task_schedules')
