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


async def test_simultaneous_day_plan_replacements_are_atomic_without_local_lock(
    client, guest_headers, frozen_day, session_factory, postgres_only, monkeypatch
):
    from sqlalchemy import select

    from app.models import DayPlanItem
    from app.services import tracker

    tasks = [await create_task(client, guest_headers, name=f"Choice {index}") for index in range(4)]
    proposals = [
        [tasks[0]["id"], tasks[1]["id"], tasks[2]["id"]],
        [tasks[3]["id"], tasks[2]["id"], tasks[0]["id"]],
        [tasks[1]["id"], tasks[3]["id"], tasks[2]["id"]],
    ]

    class IndependentWorkerLocks:
        def setdefault(self, owner_id, lock):
            return lock

    # Emulate workers with separate Python locks so owner row locking is exercised.
    monkeypatch.setattr(tracker, "_locks", IndependentWorkerLocks())
    responses = await asyncio.gather(*[
        client.put("/api/day-plan", headers=guest_headers,
                   json={"date": frozen_day["date"].isoformat(), "task_ids": ids})
        for ids in proposals
    ])
    for response, ids in zip(responses, proposals):
        assert assert_mutation(response)["today_plan"]["task_ids"] == ids
    final = assert_mutation(await client.get("/api/day-plan", headers=guest_headers))
    assert final["today_plan"]["task_ids"] in proposals
    async with session_factory() as session:
        rows = (await session.scalars(select(DayPlanItem).where(
            DayPlanItem.owner_id == f"guest:{guest_headers['X-Guest-Id']}",
            DayPlanItem.date == frozen_day["date"]).order_by(DayPlanItem.position))).all()
        assert [row.position for row in rows] == [0, 1, 2]
        assert [str(row.task_id) for row in rows] == final["today_plan"]["task_ids"]


async def test_simultaneous_frequency_edits_keep_one_pending_rule_without_local_lock(
    client, guest_headers, frozen_day, session_factory, postgres_only, monkeypatch
):
    from datetime import timedelta
    from sqlalchemy import select

    from app.models import TaskSchedule
    from app.services import tracker

    task = await create_task(client, guest_headers, target=100, daily_minimum=1)

    class IndependentWorkerLocks:
        def setdefault(self, owner_id, lock):
            return lock

    monkeypatch.setattr(tracker, '_locks', IndependentWorkerLocks())
    proposals = [{'mode': 'weekdays', 'weekdays': [day]} for day in range(7)]
    responses = await asyncio.gather(*[
        client.patch(f"/api/tasks/{task['id']}", headers=guest_headers, json={'schedule': schedule})
        for schedule in proposals
    ])
    for response, schedule in zip(responses, proposals):
        projected = assert_mutation(response)['tasks'][0]
        assert projected['schedule']['mode'] == 'daily'
        assert projected['pending_schedule']['weekdays'] == schedule['weekdays']
    final = assert_mutation(await client.get('/api/state', headers=guest_headers))['tasks'][0]
    assert final['pending_schedule']['weekdays'] in [schedule['weekdays'] for schedule in proposals]
    async with session_factory() as session:
        from uuid import UUID

        pending = (await session.scalars(select(TaskSchedule).where(
            TaskSchedule.task_id == UUID(task['id']),
            TaskSchedule.starts_on == frozen_day['date'] + timedelta(days=1)))).all()
        assert len(pending) == 1
        assert pending[0].weekdays == final['pending_schedule']['weekdays']
