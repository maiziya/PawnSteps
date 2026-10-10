"""The date exposed to clients must use the same clock as daily quota resets."""
from datetime import datetime, timezone

from conftest import assert_mutation


async def test_mutation_date_matches_configured_timezone_across_midnight(client, guest_headers, monkeypatch):
    from app.services import tracker

    instant = {"utc": datetime(2026, 10, 8, 2, 30, tzinfo=timezone.utc)}

    class FixedClock(datetime):
        @classmethod
        def now(cls, tz=None):
            return instant["utc"].astimezone(tz) if tz else instant["utc"].replace(tzinfo=None)

    monkeypatch.setattr(tracker, "datetime", FixedClock)
    monkeypatch.setattr(tracker.settings, "timezone", "America/Los_Angeles")
    created = assert_mutation(await client.post("/api/tasks", headers=guest_headers, json={
        "name": "Local midnight practice", "target": 3, "daily_quota": 1,
    }), status=201)
    task = created["tasks"][0]
    assert created["today"] == task["daily_date"] == "2026-10-07"
    assert created["timezone"] == "America/Los_Angeles"
    completed = assert_mutation(await client.post(
        f"/api/tasks/{task['id']}/records", headers=guest_headers, json={"amount": 1},
    ), status=201)
    assert completed["today"] == "2026-10-07"
    assert completed["tasks"][0]["daily_done"] is True

    instant["utc"] = datetime(2026, 10, 8, 8, 0, tzinfo=timezone.utc)
    refreshed = assert_mutation(await client.get("/api/state", headers=guest_headers))
    assert refreshed["today"] == refreshed["tasks"][0]["daily_date"] == "2026-10-08"
    assert refreshed["timezone"] == "America/Los_Angeles"
    assert refreshed["tasks"][0]["daily_done"] is False
    assert refreshed["tasks"][0]["daily_progress"] == 0
    assert refreshed["tasks"][0]["progress"] == 1


async def test_task_creation_timestamp_keeps_utc_offset_after_reload(client, guest_headers):
    created = assert_mutation(await client.post('/api/tasks', headers=guest_headers,
        json={'name': 'Creation date', 'target': 10}), status=201)['tasks'][0]
    refreshed = assert_mutation(await client.get('/api/state', headers=guest_headers))['tasks'][0]
    assert created['created_at'] == refreshed['created_at']
    for field in ['created_at', 'updated_at']:
        instant = datetime.fromisoformat(refreshed[field])
        assert instant.tzinfo is not None
        assert instant.utcoffset() == timezone.utc.utcoffset(instant)
