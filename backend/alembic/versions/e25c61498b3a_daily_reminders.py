"""Coordinate daily browser reminders without changing existing task data."""
from alembic import op
import sqlalchemy as sa

revision = 'e25c61498b3a'
down_revision = 'd14a92f836c7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('reminder_deliveries',
        sa.Column('owner_id', sa.String(100), nullable=False),
        sa.Column('device_id', sa.Uuid(), nullable=False),
        sa.Column('date', sa.Date(), nullable=False),
        sa.Column('token', sa.Uuid(), nullable=False),
        sa.Column('delivered', sa.Boolean(), nullable=False),
        sa.Column('lease_until', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['owner_id'], ['owners.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('owner_id', 'device_id', 'date'))


def downgrade() -> None:
    op.drop_table('reminder_deliveries')
