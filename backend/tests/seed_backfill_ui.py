"""Give an isolated local E2E task a past start date without altering the server clock."""
import asyncio
import sys
from datetime import timedelta
from uuid import UUID

from sqlalchemy import select

from app.config import settings
from app.database import SessionLocal
from app.models import Task
from app.services import tracker


async def main() -> None:
    assert settings.environment != 'production' and settings.database_url.startswith('sqlite')
    guest, task_id = UUID(sys.argv[1]), UUID(sys.argv[2])
    owner = f'guest:{guest}'
    async with SessionLocal() as session:
        async with tracker.owner_transaction(session, owner):
            task = await session.scalar(select(Task).where(Task.id == task_id, Task.owner_id == owner))
            assert task is not None and task.name.startswith('补记测试')
            start = tracker.today() - timedelta(days=3)
            task.created_at -= timedelta(days=3)
            task.schedules[0].starts_on = start
            task.thresholds[0].starts_on = start
            await session.flush()
        await session.commit()


if __name__ == '__main__':
    asyncio.run(main())
