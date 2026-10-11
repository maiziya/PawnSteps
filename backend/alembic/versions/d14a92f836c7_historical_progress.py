"""Track backfilled records and dated minimum requirements.

Revision ID: d14a92f836c7
Revises: c728ef194b30
"""
from alembic import op
import sqlalchemy as sa

revision = 'd14a92f836c7'
down_revision = 'c728ef194b30'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('progress_records', sa.Column('is_backfill', sa.Boolean(), server_default=sa.false(), nullable=False))
    op.create_table('task_thresholds',
        sa.Column('task_id', sa.Uuid(), nullable=False),
        sa.Column('starts_on', sa.Date(), nullable=False),
        sa.Column('quota', sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint('task_id', 'starts_on'),
        sa.ForeignKeyConstraint(['task_id'], ['tasks.id'], ondelete='CASCADE'),
        sa.CheckConstraint('quota >= 0', name='ck_threshold_quota'))


def downgrade() -> None:
    op.drop_table('task_thresholds')
    op.drop_column('progress_records', 'is_backfill')
