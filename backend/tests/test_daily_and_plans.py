"""Calendar boundaries, history idempotency and plan quotas are product invariants."""

from datetime import date, timedelta

import pytest
from sqlalchemy import select

from conftest import assert_mutation, create_task


@pytest.fixture
def frozen_day(monkeypatch):
    from app.services import tracker

    clock = {"date": date(2026, 10, 8)}
    monkeypatch.setattr(tracker, "today", lambda: clock["date"])
    return clock


async def history_for(session_factory, task_id):
    from uuid import UUID
    from app.models import DailyHistory

    async with session_factory() as session:
        return list(await session.scalars(select(DailyHistory).where(DailyHistory.task_id == UUID(task_id))))


async def test_daily_quota_completion_is_idempotent_and_reversible(
    client, guest_headers, session_factory, frozen_day
):
    task = await create_task(client, guest_headers, daily_quota=5, target=2)
    path = f"/api/tasks/{task['id']}/daily"
    partial = assert_mutation(await client.post(path, headers=guest_headers, json={"progress": 4}))
    assert partial["tasks"][0]["daily_progress"] == 4
    assert partial["tasks"][0]["daily_done"] is False
    assert partial["tasks"][0]["progress"] == 0

    first = assert_mutation(await client.post(path, headers=guest_headers, json={"progress": 5}))
    assert first["tasks"][0]["daily_done"] is True
    assert first["tasks"][0]["progress"] == 1
    assert first["stats"]["streak"] == 1
    repeated = assert_mutation(await client.post(path, headers=guest_headers, json={"progress": 5}))
    assert repeated["tasks"][0]["progress"] == 1
    records = await history_for(session_factory, task["id"])
    assert len(records) == 1
    assert records[0].date == frozen_day["date"]
    assert records[0].completed is True

    undone = assert_mutation(await client.post(f"{path}/undo", headers=guest_headers))
    assert undone["tasks"][0]["daily_done"] is False
    assert undone["tasks"][0]["progress"] == 0
    assert undone["stats"]["streak"] == 0
    records = await history_for(session_factory, task["id"])
    assert not any(record.completed for record in records)


async def test_crossday_reset_preserves_total_and_history(
    client, guest_headers, session_factory, frozen_day
):
    task = await create_task(client, guest_headers, daily_quota=2, target=3)
    path = f"/api/tasks/{task['id']}/daily"
    assert_mutation(await client.post(path, headers=guest_headers, json={"progress": 2}))
    yesterday = frozen_day["date"]
    frozen_day["date"] += timedelta(days=1)
    reset = assert_mutation(await client.get("/api/tasks", headers=guest_headers))
    assert reset["tasks"][0]["daily_progress"] == 0
    assert reset["tasks"][0]["daily_done"] is False
    assert reset["tasks"][0]["daily_date"] == frozen_day["date"].isoformat()
    assert reset["tasks"][0]["progress"] == 1
    # The specified streak starts at today, so it is zero until today's check-in.
    assert reset["stats"]["streak"] == 0
    completed = assert_mutation(await client.post(path, headers=guest_headers, json={"progress": 2}))
    assert completed["tasks"][0]["progress"] == 2
    assert completed["stats"]["streak"] == 2
    records = await history_for(session_factory, task["id"])
    assert {record.date for record in records if record.completed} == {yesterday, frozen_day["date"]}


async def test_undo_daily_completion_reopens_finished_task(client, guest_headers, frozen_day):
    task = await create_task(client, guest_headers, daily_quota=1, target=1)
    path = f"/api/tasks/{task['id']}/daily"
    complete = assert_mutation(await client.post(path, headers=guest_headers, json={"progress": 1}))
    assert complete["tasks"][0]["is_done"] is True
    assert complete["stats"]["xp"] == 100
    undo = assert_mutation(await client.post(f"{path}/undo", headers=guest_headers))
    assert undo["tasks"][0]["is_done"] is False
    assert undo["tasks"][0]["progress"] == 0
    assert undo["stats"]["xp"] == 0


async def test_plan_tracks_units_rest_days_and_automatic_end(
    client, guest_headers, session_factory, frozen_day
):
    start = frozen_day["date"]
    task = await create_task(
        client, guest_headers, name="Seven day practice", daily_plan=[10, 10, 0, 10, -1, 10, 5],
        plan_start_date=start.isoformat(),
    )
    assert task["target"] == 45
    assert task["daily_quota"] == 10
    state = assert_mutation(await client.post(
        f"/api/tasks/{task['id']}/daily", headers=guest_headers, json={"progress": 4}
    ))
    assert state["tasks"][0]["progress"] == 4
    assert state["tasks"][0]["daily_done"] is False

    frozen_day["date"] = start + timedelta(days=2)
    rest = assert_mutation(await client.get("/api/state", headers=guest_headers))
    assert rest["tasks"][0]["daily_quota"] == 0
    assert rest["tasks"][0]["daily_done"] is True
    assert rest["tasks"][0]["progress"] == 4
    assert rest["tasks"][0]["is_done"] is False
    assert_mutation(await client.get("/api/state", headers=guest_headers))
    records = await history_for(session_factory, task["id"])
    rests = [record for record in records if record.date == frozen_day["date"]]
    assert len(rests) == 1
    assert rests[0].completed is True

    frozen_day["date"] = start + timedelta(days=4)
    negative_rest = assert_mutation(await client.get("/api/state", headers=guest_headers))
    assert negative_rest["tasks"][0]["daily_done"] is True
    assert negative_rest["tasks"][0]["daily_quota"] == 0

    frozen_day["date"] = start + timedelta(days=7)
    finished = assert_mutation(await client.get("/api/state", headers=guest_headers))
    assert finished["tasks"][0]["is_done"] is True
    assert finished["tasks"][0]["progress"] == 45
    assert finished["stats"]["xp"] == 100


async def test_future_plan_cannot_be_advanced(client, guest_headers, frozen_day):
    task = await create_task(
        client, guest_headers, daily_plan=[2, 1],
        plan_start_date=(frozen_day["date"] + timedelta(days=1)).isoformat(),
    )
    response = await client.post(
        f"/api/tasks/{task['id']}/daily", headers=guest_headers, json={"progress": 2}
    )
    assert response.status_code in (400, 409, 422)
    state = assert_mutation(await client.get("/api/state", headers=guest_headers))
    assert state["tasks"][0]["progress"] == 0


async def test_milestones_are_idempotent_undeletable_and_unlock_at_streak(
    client, guest_headers, frozen_day
):
    first = assert_mutation(await client.get("/api/rewards", headers=guest_headers))
    initial_ids = {reward["id"] for reward in first["rewards"]}
    assert sorted(reward["streak_target"] for reward in first["rewards"]) == [3, 7, 14, 30, 60, 100]
    again = assert_mutation(await client.get("/api/rewards", headers=guest_headers))
    assert {reward["id"] for reward in again["rewards"]} == initial_ids
    milestone = next(reward for reward in first["rewards"] if reward["streak_target"] == 3)
    deletion = await client.delete(f"/api/rewards/{milestone['id']}", headers=guest_headers)
    assert deletion.status_code in (400, 403, 409, 422)

    task = await create_task(client, guest_headers, daily_quota=1, target=10)
    for index in range(3):
        state = assert_mutation(await client.post(
            f"/api/tasks/{task['id']}/daily", headers=guest_headers, json={"progress": 1}
        ))
        if index < 2:
            frozen_day["date"] += timedelta(days=1)
    assert state["stats"]["streak"] == 3
    assert next(reward for reward in state["rewards"] if reward["id"] == milestone["id"])["is_unlocked"]
    assert state["unlocked_reward"]["id"] == milestone["id"]
    locked = assert_mutation(await client.patch(
        f"/api/rewards/{milestone['id']}", headers=guest_headers, json={"is_unlocked": False}
    ))
    assert next(reward for reward in locked["rewards"] if reward["id"] == milestone["id"])["is_unlocked"] is False
    refreshed = assert_mutation(await client.get("/api/state", headers=guest_headers))
    assert next(reward for reward in refreshed["rewards"] if reward["id"] == milestone["id"])["is_unlocked"] is False


async def test_deletion_undo_expires_after_five_seconds(client, guest_headers, monkeypatch):
    from app.services import tracker

    task = await create_task(client, guest_headers)
    deleted = assert_mutation(await client.delete(f"/api/tasks/{task['id']}", headers=guest_headers))
    later = tracker.utcnow() + timedelta(seconds=6)
    monkeypatch.setattr(tracker, "utcnow", lambda: later)
    response = await client.post(
        "/api/tasks/undo", headers=guest_headers, json={"token": deleted["undo_token"]}
    )
    assert response.status_code in (404, 410)
    state = assert_mutation(await client.get("/api/state", headers=guest_headers))
    assert state["tasks"] == []
