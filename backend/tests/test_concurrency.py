"""Database-backed concurrency regressions run against disposable PostgreSQL."""

import asyncio

import pytest

from conftest import assert_mutation, create_task


@pytest.fixture
def postgres_only(session_factory):
    if session_factory.kw["bind"].dialect.name != "postgresql":
        pytest.skip("Concurrent transaction tests require TEST_DATABASE_URL with a disposable PostgreSQL database")


async def test_first_reward_fetch_creates_each_milestone_once(client, guest_headers, postgres_only):
    responses = await asyncio.gather(*[
        client.get("/api/rewards", headers=guest_headers) for _ in range(8)
    ])
    states = [assert_mutation(response) for response in responses]
    expected = {reward["id"] for reward in states[0]["rewards"]}
    assert len(expected) == 6
    assert all({reward["id"] for reward in state["rewards"]} == expected for state in states)


async def test_simultaneous_daily_completion_adds_only_one_day(client, guest_headers, postgres_only):
    task = await create_task(client, guest_headers, daily_quota=1, target=5)
    responses = await asyncio.gather(*[
        client.post(f"/api/tasks/{task['id']}/daily", headers=guest_headers, json={"progress": 1})
        for _ in range(8)
    ])
    states = [assert_mutation(response) for response in responses]
    assert all(state["tasks"][0]["progress"] == 1 for state in states)
    final = assert_mutation(await client.get("/api/state", headers=guest_headers))
    assert final["tasks"][0]["progress"] == 1
    assert final["stats"]["streak"] == 1
