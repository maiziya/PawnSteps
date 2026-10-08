"""Authentication, tenant migration and administrator privilege boundaries."""

from uuid import UUID

import pytest
from sqlalchemy import select

from conftest import add_record, assert_mutation, create_reward, create_task, register_user


def bearer(payload: dict) -> dict[str, str]:
    return {"Authorization": f"Bearer {payload['access_token']}"}


async def test_requests_need_a_valid_owner_and_invalid_jwt_does_not_fall_back_to_guest(
    client, guest_headers
):
    assert (await client.get("/api/state")).status_code == 401
    assert (await client.get("/api/state", headers={"X-Guest-Id": "easy-to-guess"})).status_code == 400
    response = await client.get(
        "/api/state", headers={**guest_headers, "Authorization": "Bearer invalid.jwt.token"}
    )
    assert response.status_code == 401


async def test_register_migrates_guest_tasks_rewards_and_keeps_bcrypt_password(
    client, guest_headers, session_factory
):
    reward = await create_reward(client, guest_headers)
    task = await create_task(client, guest_headers, reward_id=reward["id"])
    record = (await add_record(client, guest_headers, task["id"], 1, "Guest practice"))["record"]
    payload = await register_user(client, headers=guest_headers)
    assert any(item["id"] == task["id"] for item in payload["tasks"])
    assert any(item["id"] == reward["id"] for item in payload["rewards"])
    assert all(item["owner_id"].startswith("user:") for item in payload["tasks"])
    assert payload["tasks"][0]["reward_id"] == reward["id"]
    assert "password_hash" not in payload["user"]
    empty_guest = assert_mutation(await client.get("/api/state", headers=guest_headers))
    assert empty_guest["tasks"] == []
    migrated_records = await client.get(f"/api/tasks/{task['id']}/records", headers=bearer(payload))
    assert migrated_records.status_code == 200
    assert migrated_records.json()["records"][0]["id"] == record["id"]
    assert migrated_records.json()["records"][0]["note"] == "Guest practice"
    assert (await client.get(f"/api/tasks/{task['id']}/records", headers=guest_headers)).status_code == 404

    from app.models import User
    async with session_factory() as session:
        user = await session.scalar(select(User).where(User.username == "testreader"))
        assert user.password_hash.startswith(("$2a$", "$2b$", "$2y$"))
        assert user.password_hash != "correct-horse-73!"


async def test_password_login_and_authenticated_data_isolation(client):
    first = await register_user(client, username="firstreader")
    second = await register_user(client, username="secondreader")
    await create_task(client, bearer(first), name="Private goal")
    second_state = assert_mutation(await client.get("/api/state", headers=bearer(second)))
    assert second_state["tasks"] == []
    login = await client.post(
        "/api/auth/login", json={"identifier": "firstreader", "password": "correct-horse-73!"}
    )
    logged_in = assert_mutation(login)
    assert logged_in["access_token"]
    assert logged_in["tasks"][0]["name"] == "Private goal"
    wrong = await client.post(
        "/api/auth/login", json={"identifier": "firstreader", "password": "definitely-wrong"}
    )
    assert wrong.status_code == 401


async def test_password_change_revokes_prior_tokens_and_accepts_new_password(client):
    user = await register_user(client)
    headers = bearer(user)
    wrong_current = await client.post(
        "/api/profile/password",
        headers=headers,
        json={"current_password": "wrong-password", "new_password": "new-correct-password-19!"},
    )
    assert wrong_current.status_code in (400, 401, 403)
    changed = await client.post(
        "/api/profile/password",
        headers=headers,
        json={"current_password": "correct-horse-73!", "new_password": "new-correct-password-19!"},
    )
    assert_mutation(changed)
    old_session = await client.get("/api/profile", headers=headers)
    assert old_session.status_code == 401
    old_password = await client.post(
        "/api/auth/login", json={"identifier": "testreader", "password": "correct-horse-73!"}
    )
    assert old_password.status_code == 401
    new_password = await client.post(
        "/api/auth/login", json={"identifier": "testreader", "password": "new-correct-password-19!"}
    )
    assert_mutation(new_password)


async def test_account_export_excludes_secrets_and_other_owners(client):
    first = await register_user(client, username="exportreader")
    second = await register_user(client, username="privatereader")
    own = await create_task(client, bearer(first), name="Export this")
    private = await create_task(client, bearer(second), name="Keep private")
    active = (await add_record(client, bearer(first), own["id"], 1, "Exported note"))["record"]
    revoked = (await add_record(client, bearer(first), own["id"], 1, "Revoked note"))["record"]
    await client.delete(f"/api/tasks/{own['id']}/records/{revoked['id']}", headers=bearer(first))
    await add_record(client, bearer(second), private["id"], 1, "Private note")
    response = await client.get("/api/profile/export", headers=bearer(first))
    assert response.status_code == 200
    data = response.json()
    assert "Export this" in response.text
    assert "Keep private" not in response.text
    assert "password_hash" not in response.text
    assert "correct-horse" not in response.text
    assert "tasks" in data
    assert data["format_version"] == 2
    assert {row["id"] for row in data["records"]} == {active["id"], revoked["id"]}
    assert next(row for row in data["records"] if row["id"] == revoked["id"])["deleted_at"]
    assert "Private note" not in response.text


async def test_guest_limits_apply_but_registration_removes_limits(client, guest_headers, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "guest_task_limit", 2)
    await create_task(client, guest_headers, name="One")
    await create_task(client, guest_headers, name="Two")
    blocked = await client.post(
        "/api/tasks", headers=guest_headers, json={"name": "Three", "target": 2}
    )
    assert blocked.status_code in (403, 409, 422)
    account = await register_user(client, headers=guest_headers)
    third = await create_task(client, bearer(account), name="Three")
    assert third["name"] == "Three"


async def test_guest_daily_limit_is_separate_from_total_task_limit(client, guest_headers, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "guest_daily_limit", 1)
    await create_task(client, guest_headers, name="First daily", daily_quota=1)
    blocked = await client.post(
        "/api/tasks", headers=guest_headers,
        json={"name": "Second daily", "target": 2, "daily_quota": 1},
    )
    assert blocked.status_code in (403, 409, 422)
    normal = await create_task(client, guest_headers, name="Normal still allowed")
    assert normal["name"] == "Normal still allowed"


async def test_administration_requires_separate_admin_login(client, session_factory):
    from app.models import User

    regular = await register_user(client, username="ordinaryreader")
    admin = await register_user(client, username="administrator")
    async with session_factory() as session:
        user = await session.scalar(select(User).where(User.username == "administrator"))
        user.is_admin = True
        await session.commit()

    assert (await client.get("/api/admin/users")).status_code == 401
    assert (await client.get("/api/admin/users", headers=bearer(regular))).status_code in (401, 403)
    assert (await client.get("/api/admin/users", headers=bearer(admin))).status_code in (401, 403)
    regular_admin = await client.post(
        "/api/admin/login", json={"identifier": "ordinaryreader", "password": "correct-horse-73!"}
    )
    assert regular_admin.status_code in (401, 403)
    logged_in = await client.post(
        "/api/admin/login", json={"identifier": "administrator", "password": "correct-horse-73!"}
    )
    assert_mutation(logged_in)
    admin_headers = bearer(logged_in.json())
    users = await client.get("/api/admin/users", headers=admin_headers)
    assert users.status_code == 200
    assert "ordinaryreader" in users.text
    assert "password_hash" not in users.text
    assert (await client.get("/api/state", headers=admin_headers)).status_code == 401
