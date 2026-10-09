"""Today's ordered selections are dated, tenant-owned, and independent of progress."""

from datetime import date, datetime, timedelta, timezone
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from conftest import add_record, assert_mutation, create_task, register_user


def bearer(payload):
    return {"Authorization": f"Bearer {payload['access_token']}"}


def assert_plan(state, day, task_ids):
    assert state["today"] == day.isoformat()
    assert state["today_plan"] == {"date": day.isoformat(), "task_ids": task_ids}


async def read_plan(client, headers):
    return assert_mutation(await client.get("/api/day-plan", headers=headers))


async def save_plan(client, headers, day, task_ids):
    return assert_mutation(await client.put(
        "/api/day-plan", headers=headers,
        json={"date": day.isoformat(), "task_ids": task_ids},
    ))


async def export_plans(client, headers):
    response = await client.get("/api/profile/export", headers=headers)
    assert response.status_code == 200, response.text
    groups = response.json()["day_plans"]
    assert isinstance(groups, list)
    assert len({group["date"] for group in groups}) == len(groups)
    return {group["date"]: group["task_ids"] for group in groups}


async def test_day_plan_requires_an_owner(client):
    assert (await client.get("/api/day-plan")).status_code == 401
    response = await client.put("/api/day-plan", json={"date": "2026-10-08", "task_ids": []})
    assert response.status_code == 401


async def test_runtime_sqlite_engine_enables_foreign_key_enforcement():
    from app.database import engine

    if engine.dialect.name != 'sqlite':
        pytest.skip('SQLite foreign key configuration applies only to SQLite')
    try:
        async with engine.connect() as connection:
            result = await connection.exec_driver_sql('PRAGMA foreign_keys')
            assert result.scalar_one() == 1
    finally:
        await engine.dispose()


async def test_day_plan_reads_full_state_and_preserves_order_until_cleared(
    client, guest_headers, frozen_day
):
    day = frozen_day["date"]
    assert_plan(await read_plan(client, guest_headers), day, [])
    tasks = [await create_task(client, guest_headers, name=name) for name in ("One", "Two", "Three")]
    chosen = [tasks[2]["id"], tasks[0]["id"], tasks[1]["id"]]
    saved = await save_plan(client, guest_headers, day, chosen)
    assert_plan(saved, day, chosen)
    assert {task["id"] for task in saved["tasks"]} == {task["id"] for task in tasks}
    assert_plan(await read_plan(client, guest_headers), day, chosen)
    for endpoint in ("/api/state", "/api/tasks"):
        assert_plan(assert_mutation(await client.get(endpoint, headers=guest_headers)), day, chosen)

    reordered = [chosen[1], chosen[2], chosen[0]]
    assert_plan(await save_plan(client, guest_headers, day, reordered), day, reordered)
    assert_plan(await save_plan(client, guest_headers, day, []), day, [])
    assert_plan(await read_plan(client, guest_headers), day, [])


@pytest.mark.parametrize("invalid", [
    "missing_date", "missing_task_ids", "invalid_date", "invalid_id",
    "duplicate_ids", "too_many_ids", "unexpected_field",
])
async def test_day_plan_payload_validation_does_not_change_existing_selection(
    client, guest_headers, frozen_day, invalid
):
    day = frozen_day["date"]
    task = await create_task(client, guest_headers)
    selected = [task["id"]]
    await save_plan(client, guest_headers, day, selected)
    payload = {"date": day.isoformat(), "task_ids": []}
    if invalid == "missing_date":
        del payload["date"]
    elif invalid == "missing_task_ids":
        del payload["task_ids"]
    elif invalid == "invalid_date":
        payload["date"] = "not-a-date"
    elif invalid == "invalid_id":
        payload["task_ids"] = ["not-a-uuid"]
    elif invalid == "duplicate_ids":
        payload["task_ids"] = [task["id"], task["id"]]
    elif invalid == "too_many_ids":
        payload["task_ids"] = [str(uuid4()) for _ in range(4)]
    else:
        payload["owner_id"] = "guest:someone-else"
    response = await client.put("/api/day-plan", headers=guest_headers, json=payload)
    assert response.status_code == 422, response.text
    assert_plan(await read_plan(client, guest_headers), day, selected)


@pytest.mark.parametrize("offset", [-1, 1])
async def test_day_plan_rejects_a_stale_or_future_business_date(
    client, guest_headers, frozen_day, offset
):
    day = frozen_day["date"]
    task = await create_task(client, guest_headers)
    await save_plan(client, guest_headers, day, [task["id"]])
    response = await client.put("/api/day-plan", headers=guest_headers, json={
        "date": (day + timedelta(days=offset)).isoformat(), "task_ids": [],
    })
    assert response.status_code == 409, response.text
    assert_plan(await read_plan(client, guest_headers), day, [task["id"]])


@pytest.mark.parametrize("unavailable", ["foreign", "missing", "deleted"])
async def test_day_plan_rejects_unavailable_tasks_atomically(
    client, guest_headers, other_guest_headers, frozen_day, unavailable
):
    day = frozen_day["date"]
    own = await create_task(client, guest_headers, name="Keep selected")
    await save_plan(client, guest_headers, day, [own["id"]])
    if unavailable == "missing":
        unavailable_id = str(uuid4())
    else:
        headers = other_guest_headers if unavailable == "foreign" else guest_headers
        task = await create_task(client, headers, name="Unavailable")
        unavailable_id = task["id"]
        if unavailable == "deleted":
            assert_mutation(await client.delete(f"/api/tasks/{unavailable_id}", headers=guest_headers))
    response = await client.put("/api/day-plan", headers=guest_headers, json={
        "date": day.isoformat(), "task_ids": [unavailable_id, own["id"]],
    })
    assert response.status_code == 404, response.text
    assert_plan(await read_plan(client, guest_headers), day, [own["id"]])
    assert_plan(await read_plan(client, other_guest_headers), day, [])


async def test_selected_completed_task_is_retained_and_reorderable_but_cannot_be_readded(
    client, guest_headers, frozen_day
):
    day = frozen_day["date"]
    finishing = await create_task(client, guest_headers, name="Finish today", target=1)
    active = await create_task(client, guest_headers, name="Still active")
    selected = [finishing["id"], active["id"]]
    await save_plan(client, guest_headers, day, selected)
    completed = await add_record(client, guest_headers, finishing["id"], 1)
    assert next(task for task in completed["tasks"] if task["id"] == finishing["id"])["is_done"]
    assert_plan(completed, day, selected)
    assert_plan(await read_plan(client, guest_headers), day, selected)
    reordered = list(reversed(selected))
    assert_plan(await save_plan(client, guest_headers, day, reordered), day, reordered)

    await save_plan(client, guest_headers, day, [active["id"]])
    response = await client.put("/api/day-plan", headers=guest_headers, json={
        "date": day.isoformat(), "task_ids": selected,
    })
    assert response.status_code == 409, response.text
    assert_plan(await read_plan(client, guest_headers), day, [active["id"]])


@pytest.mark.parametrize("phase", ["future", "rest", "expired"])
async def test_new_explicit_plan_selection_requires_an_active_work_day(
    client, guest_headers, frozen_day, phase
):
    day = frozen_day["date"]
    active = await create_task(client, guest_headers, name="Keep selected")
    await save_plan(client, guest_headers, day, [active["id"]])
    start = day + timedelta(days={"future": 1, "rest": -1, "expired": -3}[phase])
    planned = await create_task(client, guest_headers, name="Fixed plan", daily_plan=[1, 0, 1],
                                plan_start_date=start.isoformat())
    response = await client.put("/api/day-plan", headers=guest_headers, json={
        "date": day.isoformat(), "task_ids": [active["id"], planned["id"]],
    })
    assert response.status_code == 409, response.text
    assert_plan(await read_plan(client, guest_headers), day, [active["id"]])


@pytest.mark.parametrize("mode", ["weekdays", "weekly"])
async def test_flexible_unscheduled_task_can_be_selected_for_extra_work(
    client, guest_headers, frozen_day, mode
):
    frozen_day["date"] = date(2026, 10, 5)
    schedule = {"mode": "weekdays", "weekdays": [1]} if mode == "weekdays" else {
        "mode": "weekly", "weekly_target": 1,
    }
    task = await create_task(client, guest_headers, target=10, daily_minimum=1, schedule=schedule)
    if mode == "weekly":
        await add_record(client, guest_headers, task["id"], 1)
        frozen_day["date"] += timedelta(days=1)
    state = await read_plan(client, guest_headers)
    assert state["tasks"][0]["is_scheduled_today"] is False
    assert_plan(await save_plan(client, guest_headers, frozen_day["date"], [task["id"]]),
                frozen_day["date"], [task["id"]])


async def test_crossday_starts_empty_and_export_preserves_each_days_order_and_owner(
    client, frozen_day
):
    account = await register_user(client, username="planexporter")
    headers = bearer(account)
    first = await create_task(client, headers, name="First")
    second = await create_task(client, headers, name="Second")
    yesterday = frozen_day["date"]
    await save_plan(client, headers, yesterday, [second["id"], first["id"]])
    frozen_day["date"] += timedelta(days=1)
    today = frozen_day["date"]
    assert_plan(await read_plan(client, headers), today, [])
    await save_plan(client, headers, today, [first["id"]])

    other = await register_user(client, username="privateplanner")
    private = await create_task(client, bearer(other), name="Private selection")
    await save_plan(client, bearer(other), today, [private["id"]])
    assert await export_plans(client, headers) == {
        yesterday.isoformat(): [second["id"], first["id"]],
        today.isoformat(): [first["id"]],
    }
    frozen_day["date"] = yesterday
    assert_plan(await read_plan(client, headers), yesterday, [second["id"], first["id"]])


async def test_day_plan_uses_the_configured_business_timezone(
    client, guest_headers, monkeypatch
):
    from app.services import tracker

    instant = {"utc": datetime(2026, 10, 8, 2, 30, tzinfo=timezone.utc)}

    class FixedClock(datetime):
        @classmethod
        def now(cls, tz=None):
            return instant["utc"].astimezone(tz) if tz else instant["utc"].replace(tzinfo=None)

    monkeypatch.setattr(tracker, "datetime", FixedClock)
    monkeypatch.setattr(tracker.settings, "timezone", "America/Los_Angeles")
    task = await create_task(client, guest_headers)
    day = date(2026, 10, 7)
    assert_plan(await read_plan(client, guest_headers), day, [])
    assert_plan(await save_plan(client, guest_headers, day, [task["id"]]), day, [task["id"]])
    instant["utc"] = datetime(2026, 10, 8, 8, 0, tzinfo=timezone.utc)
    next_day = date(2026, 10, 8)
    assert_plan(await read_plan(client, guest_headers), next_day, [])
    stale = await client.put("/api/day-plan", headers=guest_headers, json={
        "date": day.isoformat(), "task_ids": [],
    })
    assert stale.status_code == 409, stale.text


async def test_soft_delete_hides_selection_and_undo_restores_its_original_position(
    client, guest_headers, frozen_day
):
    day = frozen_day["date"]
    tasks = [await create_task(client, guest_headers, name=name) for name in ("One", "Two", "Three")]
    selected = [tasks[2]["id"], tasks[0]["id"], tasks[1]["id"]]
    await save_plan(client, guest_headers, day, selected)
    deleted = assert_mutation(await client.delete(f"/api/tasks/{tasks[0]['id']}", headers=guest_headers))
    remaining = [selected[0], selected[2]]
    assert_plan(deleted, day, remaining)
    assert_plan(await read_plan(client, guest_headers), day, remaining)
    restored = assert_mutation(await client.post("/api/tasks/undo", headers=guest_headers,
                                                json={"token": deleted["undo_token"]}))
    assert_plan(restored, day, selected)
    assert_plan(await read_plan(client, guest_headers), day, selected)


async def test_expired_deletion_removes_task_from_current_and_historical_plans(
    client, frozen_day, monkeypatch, session_factory
):
    from app.models import DayPlanItem
    from app.services import tracker

    account = await register_user(client, username="deletedplanner")
    headers = bearer(account)
    removed = await create_task(client, headers, name="Remove permanently")
    retained = await create_task(client, headers, name="Keep")
    yesterday = frozen_day["date"]
    await save_plan(client, headers, yesterday, [removed["id"]])
    frozen_day["date"] += timedelta(days=1)
    today = frozen_day["date"]
    await save_plan(client, headers, today, [removed["id"], retained["id"]])
    deleted = assert_mutation(await client.delete(f"/api/tasks/{removed['id']}", headers=headers))
    later = tracker.utcnow() + timedelta(seconds=6)
    monkeypatch.setattr(tracker, "utcnow", lambda: later)
    assert_plan(await read_plan(client, headers), today, [retained["id"]])
    plans = await export_plans(client, headers)
    assert plans.get(yesterday.isoformat(), []) == []
    assert plans[today.isoformat()] == [retained["id"]]
    assert all(removed["id"] not in task_ids for task_ids in plans.values())
    async with session_factory() as session:
        assert await session.scalar(select(DayPlanItem).where(
            DayPlanItem.task_id == UUID(removed["id"]),
        )) is None
    expired = await client.post("/api/tasks/undo", headers=headers, json={"token": deleted["undo_token"]})
    assert expired.status_code in (404, 410), expired.text


async def test_registration_migrates_guest_plan_history_and_clears_guest_ownership(
    client, guest_headers, frozen_day
):
    first = await create_task(client, guest_headers, name="First guest task")
    second = await create_task(client, guest_headers, name="Second guest task")
    yesterday = frozen_day["date"]
    await save_plan(client, guest_headers, yesterday, [second["id"], first["id"]])
    frozen_day["date"] += timedelta(days=1)
    today = frozen_day["date"]
    await save_plan(client, guest_headers, today, [first["id"]])
    account = await register_user(client, username="migratedplanner", headers=guest_headers)
    assert_plan(account, today, [first["id"]])
    assert {task["id"] for task in account["tasks"]} == {first["id"], second["id"]}
    assert await export_plans(client, bearer(account)) == {
        yesterday.isoformat(): [second["id"], first["id"]], today.isoformat(): [first["id"]],
    }
    assert_plan(await read_plan(client, guest_headers), today, [])
    frozen_day["date"] = yesterday
    assert_plan(await read_plan(client, guest_headers), yesterday, [])
    assert_plan(await read_plan(client, bearer(account)), yesterday, [second["id"], first["id"]])


@pytest.mark.parametrize("constraint", ["position_range", "unique_task", "unique_position"])
async def test_day_plan_database_constraints_preserve_the_saved_selection(
    client, guest_headers, frozen_day, session_factory, constraint
):
    from app.models import DayPlanItem

    day = frozen_day["date"]
    selected = await create_task(client, guest_headers, name="Selected")
    other = await create_task(client, guest_headers, name="Other")
    await save_plan(client, guest_headers, day, [selected["id"]])
    position = {"position_range": 3, "unique_task": 1, "unique_position": 0}[constraint]
    task_id = selected["id"] if constraint == "unique_task" else other["id"]
    async with session_factory() as session:
        with pytest.raises(IntegrityError):
            async with session.begin_nested():
                session.add(DayPlanItem(owner_id=selected["owner_id"], date=day,
                                        position=position, task_id=UUID(task_id)))
                await session.flush()
        rows = list(await session.scalars(select(DayPlanItem).where(
            DayPlanItem.owner_id == selected["owner_id"], DayPlanItem.date == day,
        )))
        assert [(row.position, str(row.task_id)) for row in rows] == [(0, selected["id"])]
    assert_plan(await read_plan(client, guest_headers), day, [selected["id"]])


async def test_login_merges_each_days_target_order_then_guest_order_up_to_three(
    client, guest_headers, frozen_day
):
    account = await register_user(client, username="mergedplanner")
    headers = bearer(account)
    target = [await create_task(client, headers, name=name) for name in ("Account one", "Account two")]
    guest = [await create_task(client, guest_headers, name=name) for name in ("Guest one", "Guest two", "Guest three")]
    yesterday = frozen_day["date"]
    await save_plan(client, headers, yesterday, [target[1]["id"], target[0]["id"]])
    await save_plan(client, guest_headers, yesterday, [guest[1]["id"], guest[2]["id"], guest[0]["id"]])
    frozen_day["date"] += timedelta(days=1)
    today = frozen_day["date"]
    await save_plan(client, headers, today, [target[0]["id"]])
    await save_plan(client, guest_headers, today, [guest[2]["id"], guest[0]["id"], guest[1]["id"]])

    login = assert_mutation(await client.post("/api/auth/login", headers=guest_headers, json={
        "identifier": "mergedplanner", "password": "correct-horse-73!",
    }))
    expected_today = [target[0]["id"], guest[2]["id"], guest[0]["id"]]
    assert_plan(login, today, expected_today)
    assert {task["id"] for task in login["tasks"]} == {task["id"] for task in [*target, *guest]}
    assert await export_plans(client, bearer(login)) == {
        yesterday.isoformat(): [target[1]["id"], target[0]["id"], guest[1]["id"]],
        today.isoformat(): expected_today,
    }
    assert_plan(await read_plan(client, guest_headers), today, [])
    frozen_day["date"] = yesterday
    assert_plan(await read_plan(client, guest_headers), yesterday, [])


async def test_login_merge_compacts_a_target_plan_after_permanent_task_deletion(
    client, guest_headers, frozen_day, monkeypatch
):
    from app.services import tracker

    day = frozen_day["date"]
    account = await register_user(client, username="gapplanner")
    headers = bearer(account)
    target = [await create_task(client, headers, name=name) for name in ("First", "Remove middle", "Last")]
    guest = [await create_task(client, guest_headers, name=name) for name in ("Guest one", "Guest two")]
    await save_plan(client, headers, day, [task["id"] for task in target])
    await save_plan(client, guest_headers, day, [guest[1]["id"], guest[0]["id"]])
    assert_mutation(await client.delete(f"/api/tasks/{target[1]['id']}", headers=headers))
    later = tracker.utcnow() + timedelta(seconds=6)
    monkeypatch.setattr(tracker, "utcnow", lambda: later)
    remaining = [target[0]["id"], target[2]["id"]]
    assert_plan(await read_plan(client, headers), day, remaining)

    login = assert_mutation(await client.post("/api/auth/login", headers=guest_headers, json={
        "identifier": "gapplanner", "password": "correct-horse-73!",
    }))
    expected = [*remaining, guest[1]["id"]]
    assert_plan(login, day, expected)
    assert await export_plans(client, bearer(login)) == {day.isoformat(): expected}
    assert_plan(await read_plan(client, guest_headers), day, [])
