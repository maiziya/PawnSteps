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
        client.post(f"/api/tasks/{task['id']}/records", headers=guest_headers, json={"amount": 1})
        for _ in range(8)
    ])
    states = [assert_mutation(response, status=201) for response in responses]
    assert all(state["tasks"][0]["progress"] == 1 for state in states)
    final = assert_mutation(await client.get("/api/state", headers=guest_headers))
    assert final["tasks"][0]["progress"] == 1
    assert final["stats"]["streak"] == 1
    assert final["tasks"][0]["today_amount"] == 8
    assert final["tasks"][0]["record_count"] == 8


async def test_simultaneous_record_retries_apply_once(client, guest_headers, postgres_only):
    from uuid import uuid4

    task = await create_task(client, guest_headers, target=10)
    request_id = str(uuid4())
    responses = await asyncio.gather(*[
        client.post(f"/api/tasks/{task['id']}/records", headers=guest_headers,
                    json={"amount": 2, "note": "Retry-safe", "request_id": request_id})
        for _ in range(8)
    ])
    states = [assert_mutation(response, status=201) for response in responses]
    assert len({state["record"]["id"] for state in states}) == 1
    final = assert_mutation(await client.get("/api/state", headers=guest_headers))
    assert final["tasks"][0]["progress"] == 2
    assert final["tasks"][0]["record_count"] == 1
