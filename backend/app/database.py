from collections.abc import AsyncIterator

from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import settings


class Base(DeclarativeBase):
    pass


engine = create_async_engine(settings.database_url, pool_pre_ping=True)
if engine.dialect.name == 'sqlite':
    @event.listens_for(engine.sync_engine, 'connect')
    def enable_sqlite_foreign_keys(connection, _):
        cursor = connection.cursor()
        try:
            cursor.execute('PRAGMA foreign_keys=ON')
        finally:
            cursor.close()


SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def get_session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
