"""Store each owner's ordered task choices by business date.

Revision ID: f629ac73d508
Revises: e5176ab29f40
"""

from alembic import op
import sqlalchemy as sa

revision = 'f629ac73d508'
down_revision = 'e5176ab29f40'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('day_plan_items',
        sa.Column('owner_id', sa.String(100), nullable=False),
        sa.Column('date', sa.Date(), nullable=False),
        sa.Column('position', sa.Integer(), nullable=False),
        sa.Column('task_id', sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(['owner_id'], ['owners.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['task_id'], ['tasks.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('owner_id', 'date', 'position'),
        sa.UniqueConstraint('owner_id', 'date', 'task_id', name='uq_day_plan_owner_date_task'),
        sa.CheckConstraint('position >= 0 AND position <= 2', name='ck_day_plan_position'))
    op.create_index('ix_day_plan_items_task_id', 'day_plan_items', ['task_id'])


def downgrade() -> None:
    op.drop_index('ix_day_plan_items_task_id', table_name='day_plan_items')
    op.drop_table('day_plan_items')
