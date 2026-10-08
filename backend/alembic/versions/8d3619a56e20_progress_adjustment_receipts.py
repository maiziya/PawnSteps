"""Persist decrement receipts so request retries cannot subtract twice.

Revision ID: 8d3619a56e20
Revises: cf42d17b8e91
"""
from alembic import op
import sqlalchemy as sa


revision = '8d3619a56e20'
down_revision = 'cf42d17b8e91'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('progress_adjustments',
        sa.Column('task_id', sa.Uuid(), nullable=False),
        sa.Column('request_id', sa.Uuid(), nullable=False),
        sa.Column('record_id', sa.Uuid(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['task_id'], ['tasks.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['record_id'], ['progress_records.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('task_id', 'request_id'))
    op.create_index('ix_progress_adjustments_record_id', 'progress_adjustments', ['record_id'])


def downgrade() -> None:
    op.drop_index('ix_progress_adjustments_record_id', table_name='progress_adjustments')
    op.drop_table('progress_adjustments')
