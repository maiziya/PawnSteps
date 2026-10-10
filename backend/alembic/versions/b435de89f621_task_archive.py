"""Retain archived tasks and date their paused obligations.

Revision ID: b435de89f621
Revises: a913cd56b208
"""

from alembic import op
import sqlalchemy as sa

revision = 'b435de89f621'
down_revision = 'a913cd56b208'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('tasks', sa.Column('archived_at', sa.DateTime(timezone=True), nullable=True))
    op.create_table('task_archive_periods',
        sa.Column('task_id', sa.Uuid(), nullable=False),
        sa.Column('starts_on', sa.Date(), nullable=False),
        sa.Column('ends_on', sa.Date(), nullable=True),
        sa.ForeignKeyConstraint(['task_id'], ['tasks.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('task_id', 'starts_on'),
        sa.CheckConstraint('ends_on IS NULL OR ends_on >= starts_on', name='ck_archive_period_dates'))


def downgrade() -> None:
    op.drop_table('task_archive_periods')
    op.drop_column('tasks', 'archived_at')
