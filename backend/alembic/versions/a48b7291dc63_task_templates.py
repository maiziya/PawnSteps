"""Add reusable task configuration without modifying existing task data."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'a48b7291dc63'
down_revision = 'f37a8461bc92'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('task_templates',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('owner_id', sa.String(100), nullable=False),
        sa.Column('name', sa.String(60), nullable=False),
        sa.Column('kind', sa.String(12), nullable=False),
        sa.Column('target', sa.Integer(), nullable=False),
        sa.Column('unit', sa.String(12), nullable=False),
        sa.Column('configuration', sa.JSON().with_variant(postgresql.JSONB(), 'postgresql'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['owner_id'], ['owners.id'], ondelete='CASCADE'),
        sa.UniqueConstraint('owner_id', 'name', name='uq_template_owner_name'),
        sa.CheckConstraint("kind IN ('normal', 'daily', 'plan', 'course')", name='ck_template_kind'),
        sa.CheckConstraint('target >= 0', name='ck_template_target'))
    op.create_index('ix_task_templates_owner_id', 'task_templates', ['owner_id'])


def downgrade() -> None:
    op.drop_index('ix_task_templates_owner_id', table_name='task_templates')
    op.drop_table('task_templates')
