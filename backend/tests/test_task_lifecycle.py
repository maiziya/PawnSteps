"""Behavioral contracts for task progression, ownership, sorting and recovery."""

from uuid import uuid4

import pytest

from conftest import add_record, assert_mutation, create_reward, create_task


@pytest.mark.parametrize("target", [0, 101, -5])
async def test_normal_task_rejects_out_of_range_target(client, guest_headers, target):
    response = await client.post(
        "/api/tasks", headers=guest_headers, json={"name": "Invalid", "target": target}
    )
    assert response.status_code == 422


async def test_completion_updates_stats_and_unlocks_linked_reward(client, guest_headers):
    reward = await create_reward(client, guest_headers)
    task = await create_task(client, guest_headers, reward_id=reward["id"])
    request_id = str(uuid4())
    response = await client.post(
        f"/api/tasks/{task['id']}/records", headers=guest_headers,
        json={"amount": 3, "request_id": request_id}
    )
    state = assert_mutation(response, status=201)
    completed = next(item for item in state["tasks"] if item["id"] == task["id"])
    assert completed["progress"] == 3
    assert completed["is_done"] is True
    assert completed["done_at"]
    assert state["stats"]["completed"] == 1
    assert state["stats"]["in_progress"] == 0
    assert state["stats"]["xp"] == 100
    assert state["unlocked_reward"]["id"] == reward["id"]
    assert next(item for item in state["rewards"] if item["id"] == reward["id"])["is_unlocked"]

    record_id = state["record"]["id"]
    repeated = assert_mutation(await client.post(
        f"/api/tasks/{task['id']}/records", headers=guest_headers,
        json={"amount": 3, "request_id": request_id}
    ), status=201)
    assert repeated["stats"]["xp"] == 100
    assert repeated["unlocked_reward"] is None

    locked = assert_mutation(await client.patch(
        f"/api/rewards/{reward['id']}", headers=guest_headers, json={"is_unlocked": False}
    ))
    assert next(item for item in locked["rewards"] if item["id"] == reward["id"])["is_unlocked"] is False
    refreshed = assert_mutation(await client.get("/api/state", headers=guest_headers))
    assert next(item for item in refreshed["rewards"] if item["id"] == reward["id"])["is_unlocked"] is False

    reopened = assert_mutation(await client.patch(
        f"/api/tasks/{task['id']}/records/{record_id}", headers=guest_headers, json={"amount": 2}
    ))
    assert reopened["tasks"][0]["is_done"] is False
    assert reopened["tasks"][0]["done_at"] is None
    assert reopened["stats"]["xp"] == 0
    recompleted = assert_mutation(await client.patch(
        f"/api/tasks/{task['id']}/records/{record_id}", headers=guest_headers, json={"amount": 3}
    ))
    assert recompleted["unlocked_reward"]["id"] == reward["id"]


async def test_task_names_are_unique_within_owner(client, guest_headers, other_guest_headers):
    await create_task(client, guest_headers, name="Read")
    duplicate = await client.post(
        "/api/tasks", headers=guest_headers, json={"name": "Read", "target": 5}
    )
    assert duplicate.status_code == 409
    independent = await create_task(client, other_guest_headers, name="Read")
    assert independent["name"] == "Read"


async def test_foreign_tasks_and_rewards_are_not_readable_or_mutable(
    client, guest_headers, other_guest_headers
):
    task = await create_task(client, guest_headers)
    reward = await create_reward(client, guest_headers)
    foreign_state = assert_mutation(await client.get("/api/state", headers=other_guest_headers))
    assert not foreign_state["tasks"]
    assert all(item["id"] != reward["id"] for item in foreign_state["rewards"])

    for method, route, body in [
        ("PATCH", f"/api/tasks/{task['id']}", {"name": "Hijacked"}),
        ("POST", f"/api/tasks/{task['id']}/records", {"amount": 3}),
        ("DELETE", f"/api/tasks/{task['id']}", None),
        ("PATCH", f"/api/rewards/{reward['id']}", {"is_unlocked": True}),
        ("DELETE", f"/api/rewards/{reward['id']}", None),
    ]:
        response = await client.request(method, route, headers=other_guest_headers, json=body)
        assert response.status_code == 404, response.text

    linking = await client.post(
        "/api/tasks",
        headers=other_guest_headers,
        json={"name": "Cannot link", "target": 1, "reward_id": reward["id"]},
    )
    assert linking.status_code in (400, 404, 422)
    original = assert_mutation(await client.get("/api/state", headers=guest_headers))
    assert original["tasks"][0]["name"] == "Practice"
    assert original["tasks"][0]["progress"] == 0


async def test_reorder_keeps_completed_tasks_below_active_tasks(client, guest_headers):
    first = await create_task(client, guest_headers, name="First")
    second = await create_task(client, guest_headers, name="Second")
    completed = await create_task(client, guest_headers, name="Finished")
    assert_mutation(await client.post(
        f"/api/tasks/{completed['id']}/records", headers=guest_headers, json={"amount": 3}
    ), status=201)
    state = assert_mutation(await client.post(
        "/api/tasks/reorder", headers=guest_headers, json={"ids": [second["id"], first["id"]]}
    ))
    assert [task["id"] for task in state["tasks"]] == [second["id"], first["id"], completed["id"]]


async def test_deletion_is_reversible_only_by_the_same_owner(
    client, guest_headers, other_guest_headers
):
    task = await create_task(client, guest_headers)
    record = (await add_record(client, guest_headers, task["id"], 1, "Keep this record"))["record"]
    deleted = assert_mutation(await client.delete(f"/api/tasks/{task['id']}", headers=guest_headers))
    assert deleted["tasks"] == []
    token = deleted["undo_token"]
    assert token

    forbidden = await client.post("/api/tasks/undo", headers=other_guest_headers, json={"token": token})
    assert forbidden.status_code in (404, 410)
    restored = assert_mutation(await client.post(
        "/api/tasks/undo", headers=guest_headers, json={"token": token}
    ))
    assert restored["tasks"][0]["id"] == task["id"]
    assert restored["tasks"][0]["progress"] == 1
    assert restored["tasks"][0]["record_count"] == 1
    records = await client.get(f"/api/tasks/{task['id']}/records", headers=guest_headers)
    assert records.json()["records"][0]["id"] == record["id"]
    used = await client.post("/api/tasks/undo", headers=guest_headers, json={"token": token})
    assert used.status_code in (404, 410)


async def test_course_folders_do_not_count_as_lessons(client, guest_headers):
    task = await create_task(
        client,
        guest_headers,
        name="Drawing course",
        course_items=[
            {"name": "Introduction/", "done": False},
            {"name": "Lines", "done": False},
            {"name": "Shading", "done": False},
        ],
    )
    assert task["target"] == 2
    assert task["progress"] == 0
    state = assert_mutation(await client.post(
        f"/api/tasks/{task['id']}/course",
        headers=guest_headers,
        json={"indices": [1, 2], "done": True},
    ))
    completed = state["tasks"][0]
    assert completed["progress"] == 2
    assert completed["is_done"] is True
    assert state["stats"]["xp"] == 100
    undone = assert_mutation(await client.post(
        f"/api/tasks/{task['id']}/course",
        headers=guest_headers,
        json={"indices": [1, 2], "done": False},
    ))
    assert undone["tasks"][0]["progress"] == 0
    assert undone["tasks"][0]["is_done"] is False


async def test_course_batch_rejects_invalid_indices_atomically(client, guest_headers):
    task = await create_task(
        client, guest_headers, course_items=[{"name": "Lesson", "done": False}]
    )
    response = await client.post(
        f"/api/tasks/{task['id']}/course", headers=guest_headers, json={"indices": [0, 50], "done": True}
    )
    assert response.status_code in (400, 422)
    state = assert_mutation(await client.get("/api/state", headers=guest_headers))
    assert state["tasks"][0]["progress"] == 0
