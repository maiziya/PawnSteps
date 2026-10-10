"""Deadlines are owner-scoped metadata and never fabricate task completion."""

from datetime import date

import pytest

from conftest import add_record, assert_mutation, create_task, register_user


@pytest.mark.parametrize('fields', [
    {}, {'daily_quota': 1},
    {'daily_plan': [1, 0, 1], 'plan_start_date': '2026-10-05'},
    {'course_items': [{'name': 'Lesson', 'done': False}]},
])
async def test_deadline_roundtrip_edit_and_clear_for_each_task_kind(client, guest_headers, fields):
    task = await create_task(client, guest_headers, deadline='2026-11-01', **fields)
    assert task['deadline'] == '2026-11-01'
    state = assert_mutation(await client.get('/api/state', headers=guest_headers))
    assert state['tasks'][0]['deadline'] == '2026-11-01'
    changed = assert_mutation(await client.patch(f"/api/tasks/{task['id']}", headers=guest_headers,
        json={'deadline': '2026-12-01'}))
    assert changed['tasks'][0]['deadline'] == '2026-12-01'
    renamed = assert_mutation(await client.patch(f"/api/tasks/{task['id']}", headers=guest_headers,
        json={'name': 'Renamed task'}))
    assert renamed['tasks'][0]['deadline'] == '2026-12-01'
    cleared = assert_mutation(await client.patch(f"/api/tasks/{task['id']}", headers=guest_headers,
        json={'deadline': None}))
    assert cleared['tasks'][0]['deadline'] is None


async def test_past_deadline_does_not_finish_or_block_task(client, guest_headers, frozen_day):
    frozen_day['date'] = date(2026, 10, 10)
    task = await create_task(client, guest_headers, target=10, deadline='2026-10-09')
    assert not task['is_done'] and task['progress'] == 0
    progressed = await add_record(client, guest_headers, task['id'], 2)
    assert progressed['tasks'][0]['progress'] == 2
    assert not progressed['tasks'][0]['is_done']
    assert progressed['tasks'][0]['deadline'] == '2026-10-09'


async def test_deadline_is_optional_validated_and_owner_isolated(client, guest_headers, other_guest_headers):
    task = await create_task(client, guest_headers)
    assert task['deadline'] is None
    for value in ['2026-02-30', 'tomorrow']:
        response = await client.patch(f"/api/tasks/{task['id']}", headers=guest_headers, json={'deadline': value})
        assert response.status_code == 422
    foreign = await client.patch(f"/api/tasks/{task['id']}", headers=other_guest_headers,
        json={'deadline': '2026-10-11'})
    assert foreign.status_code == 404
    assert assert_mutation(await client.get('/api/state', headers=guest_headers))['tasks'][0]['deadline'] is None


async def test_deadline_survives_guest_migration_and_export(client, guest_headers):
    task = await create_task(client, guest_headers, deadline='2026-11-01')
    registered = await register_user(client, headers=guest_headers)
    assert registered['tasks'][0]['deadline'] == '2026-11-01'
    headers = {'Authorization': f"Bearer {registered['access_token']}"}
    exported = await client.get('/api/profile/export', headers=headers)
    assert exported.status_code == 200
    assert next(row for row in exported.json()['tasks'] if row['id'] == task['id'])['deadline'] == '2026-11-01'
