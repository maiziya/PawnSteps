"""Add optional task deadlines without changing progress or schedule obligations.

Revision ID: a913cd56b208
Revises: f629ac73d508
"""

from alembic import op
import sqlalchemy as sa

revision = 'a913cd56b208'
down_revision = 'f629ac73d508'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('tasks', sa.Column('deadline', sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column('tasks', 'deadline')
