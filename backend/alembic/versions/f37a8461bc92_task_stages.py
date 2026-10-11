"""Add optional task stages without changing recorded progress."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'f37a8461bc92'
down_revision = 'e25c61498b3a'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('tasks', sa.Column('stages', sa.JSON().with_variant(postgresql.JSONB(), 'postgresql'),
                                    nullable=False, server_default='[]'))


def downgrade() -> None:
    with op.batch_alter_table('tasks') as batch:
        batch.drop_column('stages')
