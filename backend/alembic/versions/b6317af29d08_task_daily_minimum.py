"""Give ordinary goals a daily check-in threshold without changing total progress.

Revision ID: b6317af29d08
Revises: 8d3619a56e20
"""
from alembic import op
import sqlalchemy as sa

revision = 'b6317af29d08'
down_revision = '8d3619a56e20'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('tasks', sa.Column('daily_minimum', sa.Integer(), nullable=False, server_default='0'))


def downgrade() -> None:
    op.drop_column('tasks', 'daily_minimum')
