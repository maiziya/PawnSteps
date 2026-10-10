"""Add optional task categories without changing existing progress.

Revision ID: c728ef194b30
Revises: b435de89f621
"""
from alembic import op
import sqlalchemy as sa

revision = 'c728ef194b30'
down_revision = 'b435de89f621'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('task_categories',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('owner_id', sa.String(100), nullable=False),
        sa.Column('name', sa.String(20), nullable=False),
        sa.Column('color', sa.String(12), nullable=False),
        sa.Column('position', sa.Float(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['owner_id'], ['owners.id']),
        sa.UniqueConstraint('owner_id', 'name', name='uq_category_owner_name'),
        sa.CheckConstraint("color IN ('clay', 'sage', 'ochre', 'slate', 'rose', 'lavender')", name='ck_category_color'))
    op.create_index('ix_task_categories_owner_id', 'task_categories', ['owner_id'])
    with op.batch_alter_table('tasks') as batch:
        batch.add_column(sa.Column('category_id', sa.Uuid(), nullable=True))
        batch.create_foreign_key('fk_tasks_category_id', 'task_categories', ['category_id'], ['id'], ondelete='SET NULL')
        batch.create_index('ix_tasks_category_id', ['category_id'])


def downgrade() -> None:
    with op.batch_alter_table('tasks') as batch:
        batch.drop_index('ix_tasks_category_id')
        batch.drop_constraint('fk_tasks_category_id', type_='foreignkey')
        batch.drop_column('category_id')
    op.drop_index('ix_task_categories_owner_id', table_name='task_categories')
    op.drop_table('task_categories')
