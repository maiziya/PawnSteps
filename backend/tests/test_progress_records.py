"""Progress is derived from owned, dated records rather than arbitrary totals."""

from datetime import timedelta
from uuid import UUID, uuid4

import pytest

from conftest import add_record, assert_mutation, create_task


async def test_legacy_baseline_without_date_counts_toward_total_and_can_be_corrected(client, guest_headers, session_factory):
    from app.models import ProgressRecord

    task = await create_task(client, guest_headers, target=10)
    async with session_factory() as session:
        legacy = ProgressRecord(task_id=UUID(task["id"]), amount=4, note="Migrated progress", date=None, source="legacy")
        session.add(legacy)
        await session.commit()
        record_id = str(legacy.id)
    state = assert_mutation(await client.get("/api/state", headers=guest_headers))
    assert state["tasks"][0]["progress"] == 4
    assert state["tasks"][0]["today_amount"] == 0
    assert state["tasks"][0]["record_count"] == 1
    listed = (await client.get(f"/api/tasks/{task['id']}/records", headers=guest_headers)).json()
    assert listed["records"][0]["date"] is None
    assert listed["records"][0]["source"] == "legacy"
    corrected = assert_mutation(await client.patch(
        f"/api/tasks/{task['id']}/records/{record_id}", headers=guest_headers, json={"amount": 2},
    ))
    assert corrected["tasks"][0]["progress"] == 2
    assert corrected["record"]["date"] is None
    assert corrected["tasks"][0]["today_amount"] == 0
    revoked = assert_mutation(await client.delete(f"/api/tasks/{task['id']}/records/{record_id}", headers=guest_headers))
    assert revoked["tasks"][0]["progress"] == 0
    assert revoked["tasks"][0]["record_count"] == 0


async def test_multiple_records_preserve_actual_amount_and_edit_revoke_recalculate(client, guest_headers, frozen_day):
    task = await create_task(client, guest_headers, target=5, unit="pages")
    first = await add_record(client, guest_headers, task["id"], 2, "Morning reading")
    second = await add_record(client, guest_headers, task["id"], 6, "Finished chapter")
    result = second["tasks"][0]
    assert result["unit"] == "pages"
    assert result["progress"] == 5
    assert result["today_amount"] == 8
    assert result["record_count"] == 2
    assert result["is_done"] is True
    assert second["stats"]["xp"] == 100
    assert second["record"]["amount"] == 6
    assert second["record"]["date"] == frozen_day["date"].isoformat()
    blocked = await client.post(f"/api/tasks/{task['id']}/records", headers=guest_headers, json={"amount": 1})
    assert blocked.status_code == 409

    path = f"/api/tasks/{task['id']}/records/{second['record']['id']}"
    edited = assert_mutation(await client.patch(path, headers=guest_headers, json={"amount": 1, "note": "Corrected"}))
    assert edited["tasks"][0]["progress"] == 3
    assert edited["tasks"][0]["is_done"] is False
    assert edited["stats"]["xp"] == 0
    assert edited["record"]["note"] == "Corrected"
    deleted = assert_mutation(await client.delete(path, headers=guest_headers))
    assert deleted["record"]["deleted_at"]
    assert deleted["tasks"][0]["progress"] == 2
    assert deleted["tasks"][0]["record_count"] == 1
    repeated = assert_mutation(await client.delete(path, headers=guest_headers))
    assert repeated["tasks"][0]["progress"] == 2
    listing = await client.get(f"/api/tasks/{task['id']}/records", headers=guest_headers)
    assert listing.status_code == 200
    assert [row["id"] for row in listing.json()["records"]] == [first["record"]["id"]]


async def test_historical_edit_and_revoke_recompute_completion_calendar_and_streak(client, guest_headers, frozen_day):
    task = await create_task(client, guest_headers, daily_quota=2, target=3)
    days = []
    for index in range(3):
        state = await add_record(client, guest_headers, task["id"], 2, f"Day {index + 1}")
        days.append(state["record"])
        if index < 2:
            frozen_day["date"] += timedelta(days=1)
    assert state["tasks"][0]["is_done"] is True
    assert state["stats"]["streak"] == 3
    assert state["stats"]["xp"] == 100
    middle = f"/api/tasks/{task['id']}/records/{days[1]['id']}"
    edited = assert_mutation(await client.patch(middle, headers=guest_headers, json={"amount": 1}))
    assert edited["tasks"][0]["progress"] == 2
    assert edited["tasks"][0]["daily_done"] is True
    assert edited["tasks"][0]["today_amount"] == 2
    assert edited["stats"]["streak"] == 1
    assert edited["stats"]["xp"] == 0
    restored = assert_mutation(await client.patch(middle, headers=guest_headers, json={"amount": 2}))
    assert restored["stats"]["streak"] == 3
    assert restored["stats"]["xp"] == 100
    revoked = assert_mutation(await client.delete(
        f"/api/tasks/{task['id']}/records/{days[0]['id']}", headers=guest_headers,
    ))
    assert revoked["tasks"][0]["progress"] == 2
    assert revoked["stats"]["streak"] == 2
    assert revoked["stats"]["xp"] == 0
    history = await client.get("/api/history", headers=guest_headers, params={"month": days[0]["date"][:7]})
    assert history.status_code == 200, history.text
    completed_dates = {row["date"] for row in history.json()["history"] if row["completed"]}
    assert completed_dates == {days[1]["date"], days[2]["date"]}


async def test_quota_changes_recalculate_today_but_freeze_previous_days(client, guest_headers, frozen_day):
    task = await create_task(client, guest_headers, daily_quota=2, target=5)
    yesterday = await add_record(client, guest_headers, task["id"], 2)
    frozen_day["date"] += timedelta(days=1)
    await add_record(client, guest_headers, task["id"], 2)
    changed = assert_mutation(await client.patch(f"/api/tasks/{task['id']}", headers=guest_headers, json={"daily_quota": 5}))
    assert changed["tasks"][0]["daily_done"] is False
    assert changed["tasks"][0]["progress"] == 1
    assert changed["tasks"][0]["daily_progress"] == 2
    await add_record(client, guest_headers, task["id"], 3)
    edited = assert_mutation(await client.patch(
        f"/api/tasks/{task['id']}/records/{yesterday['record']['id']}", headers=guest_headers, json={"amount": 3},
    ))
    assert edited["tasks"][0]["progress"] == 2
    assert edited["stats"]["streak"] == 2
    frozen_day["date"] += timedelta(days=1)
    reset = assert_mutation(await client.get("/api/state", headers=guest_headers))
    assert reset["tasks"][0]["today_amount"] == 0
    assert reset["tasks"][0]["daily_progress"] == 0
    assert reset["tasks"][0]["progress"] == 2


async def test_completed_daily_accepts_more_on_same_day_but_not_after_finish_date(client, guest_headers, frozen_day):
    task = await create_task(client, guest_headers, daily_quota=2, target=1)
    await add_record(client, guest_headers, task["id"], 2)
    extra = await add_record(client, guest_headers, task["id"], 3)
    assert extra["tasks"][0]["progress"] == 1
    assert extra["tasks"][0]["today_amount"] == 5
    assert extra["tasks"][0]["record_count"] == 2
    frozen_day["date"] += timedelta(days=1)
    response = await client.post(f"/api/tasks/{task['id']}/records", headers=guest_headers, json={"amount": 1})
    assert response.status_code == 409


async def test_plan_caps_contribution_not_records_and_rest_days_reject_entries(client, guest_headers, frozen_day):
    task = await create_task(client, guest_headers, daily_plan=[3, 0, -1, 2], plan_start_date=frozen_day["date"].isoformat())
    start = frozen_day["date"]
    first = await add_record(client, guest_headers, task["id"], 8)
    assert first["tasks"][0]["progress"] == 3
    assert first["tasks"][0]["today_amount"] == 8
    for offset in [1, 2]:
        frozen_day["date"] = start + timedelta(days=offset)
        rest = assert_mutation(await client.get("/api/state", headers=guest_headers))
        assert rest["tasks"][0]["daily_done"] is True
        assert rest["tasks"][0]["today_amount"] == 0
        response = await client.post(f"/api/tasks/{task['id']}/records", headers=guest_headers, json={"amount": 1})
        assert response.status_code == 409
    frozen_day["date"] = start + timedelta(days=4)
    ended = assert_mutation(await client.get("/api/state", headers=guest_headers))
    assert ended["tasks"][0]["is_done"] is True
    assert ended["tasks"][0]["plan_expired"] is True
    assert ended["tasks"][0]["progress"] == 3
    corrected = assert_mutation(await client.patch(
        f"/api/tasks/{task['id']}/records/{first['record']['id']}", headers=guest_headers, json={"amount": 1},
    ))
    assert corrected["tasks"][0]["progress"] == 1
    assert corrected["tasks"][0]["is_done"] is True


async def test_record_idempotency_survives_edits_and_revocation(client, guest_headers):
    task = await create_task(client, guest_headers, target=10)
    request_id = str(uuid4())
    first = await add_record(client, guest_headers, task["id"], 3, "Original", request_id=request_id)
    path = f"/api/tasks/{task['id']}/records/{first['record']['id']}"
    await client.patch(path, headers=guest_headers, json={"amount": 1, "note": "Edited"})
    repeated = await add_record(client, guest_headers, task["id"], 3, "Original", request_id=request_id)
    assert repeated["record"]["id"] == first["record"]["id"]
    assert repeated["record"]["amount"] == 1
    assert repeated["tasks"][0]["progress"] == 1
    for body in [{"amount": 4, "note": "Original"}, {"amount": 3, "note": "Changed"}]:
        conflict = await client.post(f"/api/tasks/{task['id']}/records", headers=guest_headers, json={**body, "request_id": request_id})
        assert conflict.status_code == 409
    await client.delete(path, headers=guest_headers)
    tombstone = await add_record(client, guest_headers, task["id"], 3, "Original", request_id=request_id)
    assert tombstone["record"]["deleted_at"]
    assert tombstone["tasks"][0]["progress"] == 0
    assert tombstone["tasks"][0]["record_count"] == 0


async def test_records_are_isolated_by_owner_and_task(client, guest_headers, other_guest_headers):
    task = await create_task(client, guest_headers)
    second = await create_task(client, guest_headers, name="Different task")
    record = (await add_record(client, guest_headers, task["id"], 1))["record"]
    base = f"/api/tasks/{task['id']}/records"
    for method, path, body in [("GET", base, None), ("POST", base, {"amount": 1}), ("PATCH", f"{base}/{record['id']}", {"amount": 2}), ("DELETE", f"{base}/{record['id']}", None)]:
        response = await client.request(method, path, headers=other_guest_headers, json=body)
        assert response.status_code == 404
    wrong_task = await client.patch(f"/api/tasks/{second['id']}/records/{record['id']}", headers=guest_headers, json={"amount": 2})
    assert wrong_task.status_code == 404
    state = assert_mutation(await client.get("/api/state", headers=guest_headers))
    assert next(item for item in state["tasks"] if item["id"] == task["id"])["progress"] == 1


async def test_record_pagination_is_stable_and_skips_tombstones(client, guest_headers):
    task = await create_task(client, guest_headers, target=100)
    records = [(await add_record(client, guest_headers, task["id"], 1, f"Entry {index}"))["record"] for index in range(7)]
    await client.delete(f"/api/tasks/{task['id']}/records/{records[3]['id']}", headers=guest_headers)
    first = (await client.get(f"/api/tasks/{task['id']}/records?offset=0&limit=3", headers=guest_headers)).json()
    second = (await client.get(f"/api/tasks/{task['id']}/records?offset=3&limit=3", headers=guest_headers)).json()
    assert first["total"] == second["total"] == 6
    assert first["offset"] == 0 and second["offset"] == 3
    assert first["limit"] == second["limit"] == 3
    assert [row["id"] for row in first["records"] + second["records"]] == [row["id"] for row in reversed(records) if row["id"] != records[3]["id"]]
    for query in ["offset=-1", "limit=0", "limit=101"]:
        response = await client.get(f"/api/tasks/{task['id']}/records?{query}", headers=guest_headers)
        assert response.status_code == 422


async def test_record_validation_and_courses_cannot_accept_numeric_entries(client, guest_headers, frozen_day):
    task = await create_task(client, guest_headers)
    for body in [{"amount": 0}, {"amount": -1}, {"amount": 1.5}, {"amount": True}, {"amount": 1_000_001}, {"amount": 1, "note": "x" * 201}, {"amount": 1, "request_id": "not-a-uuid"}, {"amount": 1, "date": "2000-01-01"}, {"amount": 1, "source": "legacy"}]:
        response = await client.post(f"/api/tasks/{task['id']}/records", headers=guest_headers, json=body)
        assert response.status_code == 422
    record = (await add_record(client, guest_headers, task["id"], 1))["record"]
    for body in [{}, {"amount": None}, {"note": None}, {"amount": 0}]:
        response = await client.patch(f"/api/tasks/{task['id']}/records/{record['id']}", headers=guest_headers, json=body)
        assert response.status_code == 422
    course = await create_task(client, guest_headers, name="Course", course_items=[{"name": "Lesson", "done": False}])
    response = await client.post(f"/api/tasks/{course['id']}/records", headers=guest_headers, json={"amount": 1})
    assert response.status_code == 422
    assert record["date"] == frozen_day["date"].isoformat()


async def test_legacy_progress_routes_are_gone_and_do_not_change_records(client, guest_headers):
    task = await create_task(client, guest_headers, daily_quota=2)
    await add_record(client, guest_headers, task["id"], 1)
    for suffix, body in [("progress", {"progress": 3}), ("daily", {"progress": 2}), ("daily/undo", None)]:
        response = await client.post(f"/api/tasks/{task['id']}/{suffix}", headers=guest_headers, json=body)
        assert response.status_code == 410
    state = assert_mutation(await client.get("/api/state", headers=guest_headers))
    assert state["tasks"][0]["today_amount"] == 1
    assert state["tasks"][0]["record_count"] == 1
    assert state["tasks"][0]["progress"] == 0
