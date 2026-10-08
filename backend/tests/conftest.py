"""Isolated HTTP integration fixtures backed by a real asynchronous database."""

import os
from collections.abc import AsyncIterator
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("JWT_SECRET", "pawnsteps-integration-secret-key-for-tests-only-64-characters-long")


@pytest_asyncio.fixture
async def session_factory():
    from app.database import Base
    import app.models  # noqa: F401

    database_url = os.environ.get("TEST_DATABASE_URL", "sqlite+aiosqlite:///:memory:")
    options = {"poolclass": StaticPool} if database_url.startswith("sqlite") else {}
    engine = create_async_engine(database_url, **options)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    try:
        yield factory
    finally:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.drop_all)
        await engine.dispose()


@pytest_asyncio.fixture
async def client(session_factory) -> AsyncIterator[AsyncClient]:
    from app.database import get_session
    from app.main import app

    async def override_session() -> AsyncIterator[AsyncSession]:
        async with session_factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    app.dependency_overrides[get_session] = override_session
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://localhost") as http:
        yield http
    app.dependency_overrides.clear()


@pytest.fixture
def guest_headers() -> dict[str, str]:
    return {"X-Guest-Id": str(uuid4())}


@pytest.fixture
def other_guest_headers() -> dict[str, str]:
    return {"X-Guest-Id": str(uuid4())}


def assert_mutation(response, status: int = 200) -> dict:
    assert response.status_code == status, response.text
    result = response.json()
    assert {"tasks", "rewards", "stats", "unlocked_reward"} <= result.keys()
    assert {"total", "completed", "in_progress", "xp", "streak"} <= result["stats"].keys()
    return result


async def create_task(client, headers, name: str = "Practice", **fields) -> dict:
    response = await client.post(
        "/api/tasks", headers=headers, json={"name": name, "target": 3, **fields}
    )
    assert response.status_code in (200, 201), response.text
    state = assert_mutation(response, response.status_code)
    return next(task for task in state["tasks"] if task["name"] == name)


async def create_reward(client, headers, name: str = "A quiet afternoon", **fields) -> dict:
    response = await client.post("/api/rewards", headers=headers, json={"name": name, **fields})
    assert response.status_code in (200, 201), response.text
    state = assert_mutation(response, response.status_code)
    return next(reward for reward in state["rewards"] if reward["name"] == name)


async def register_user(client, username: str = "testreader", headers=None, **fields) -> dict:
    response = await client.post(
        "/api/auth/register",
        headers=headers,
        json={
            "username": username,
            "password": "correct-horse-73!",
            **fields,
        },
    )
    assert response.status_code in (200, 201), response.text
    payload = assert_mutation(response, response.status_code)
    assert payload["access_token"]
    return payload
