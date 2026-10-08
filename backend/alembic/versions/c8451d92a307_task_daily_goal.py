"""Separate the desired daily quantity from the check-in minimum.

Revision ID: c8451d92a307
Revises: b6317af29d08
"""
from alembic import op
import sqlalchemy as sa

revision = 'c8451d92a307'
down_revision = 'b6317af29d08'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('tasks', sa.Column('daily_goal', sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column('tasks', 'daily_goal')
