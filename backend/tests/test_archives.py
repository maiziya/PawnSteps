"""Archiving preserves earned work while pausing future obligations."""

from datetime import date, timedelta
from uuid import uuid4

import pytest

from conftest import add_record, assert_mutation, create_reward, create_task, register_user


async def archive(client, headers, task_id, restore=False):
    action = 'restore' if restore else 'archive'
    return assert_mutation(await client.post(f'/api/tasks/{task_id}/{action}', headers=headers))


async def test_completed_archive_keeps_xp_reward_history_and_records(client, guest_headers):
    reward = await create_reward(client, guest_headers)
    task = await create_task(client, guest_headers, target=2, daily_minimum=1, reward_id=reward['id'], deadline='2026-12-01')
    completed = await add_record(client, guest_headers, task['id'], 2, 'Earned before archive')
    history_before = (await client.get('/api/history', headers=guest_headers)).json()
    saved = await archive(client, guest_headers, task['id'])
    assert saved['tasks'] == [] and len(saved['archived_tasks']) == 1
    assert saved['archived_tasks'][0]['progress'] == 2 and saved['archived_tasks'][0]['deadline'] == '2026-12-01'
    assert saved['stats']['xp'] == completed['stats']['xp'] == 100
    assert next(row for row in saved['rewards'] if row['id'] == reward['id'])['is_unlocked']
    assert (await client.get('/api/history', headers=guest_headers)).json() == history_before
    records = (await client.get(f"/api/tasks/{task['id']}/records", headers=guest_headers)).json()
    assert records['records'][0]['note'] == 'Earned before archive'
    restored = await archive(client, guest_headers, task['id'], restore=True)
    assert restored['archived_tasks'] == [] and restored['tasks'][0]['is_done']
    assert restored['tasks'][0]['created_at'] == task['created_at']
    assert restored['unlocked_reward'] is None


async def test_archive_is_idempotent_and_moves_out_of_today_plan(client, guest_headers):
    task = await create_task(client, guest_headers, target=20, daily_minimum=2)
    current = assert_mutation(await client.get('/api/state', headers=guest_headers))
    assert_mutation(await client.put('/api/day-plan', headers=guest_headers,
        json={'date': current['today'], 'task_ids': [task['id']]}))
    first = await archive(client, guest_headers, task['id'])
    again = await archive(client, guest_headers, task['id'])
    assert again['archived_tasks'][0]['archived_at'] == first['archived_tasks'][0]['archived_at']
    assert again['today_plan']['task_ids'] == [] and again['stats']['today_total'] == 0
    rejected = await client.put('/api/day-plan', headers=guest_headers,
        json={'date': current['today'], 'task_ids': [task['id']]})
    assert rejected.status_code == 404
    await archive(client, guest_headers, task['id'], restore=True)
    restored = await archive(client, guest_headers, task['id'], restore=True)
    assert restored['tasks'][0]['archived_at'] is None


async def test_archived_tasks_are_read_only_but_record_retries_stay_idempotent(client, guest_headers):
    task = await create_task(client, guest_headers, target=20)
    request_id = str(uuid4())
    original = await add_record(client, guest_headers, task['id'], 2, request_id=request_id)
    await archive(client, guest_headers, task['id'])
    for method, path, body in [
        ('PATCH', f"/api/tasks/{task['id']}", {'name': 'Changed'}),
        ('POST', f"/api/tasks/{task['id']}/records", {'amount': 1}),
        ('POST', f"/api/tasks/{task['id']}/decrement", {'request_id': str(uuid4())}),
        ('PATCH', f"/api/tasks/{task['id']}/records/{original['record']['id']}", {'amount': 1}),
        ('DELETE', f"/api/tasks/{task['id']}/records/{original['record']['id']}", None),
    ]:
        assert (await client.request(method, path, headers=guest_headers, json=body)).status_code == 409
    repeated = await add_record(client, guest_headers, task['id'], 2, request_id=request_id)
    assert repeated['record']['id'] == original['record']['id']
    assert repeated['archived_tasks'][0]['progress'] == 2


async def test_pause_periods_do_not_rewrite_earlier_misses_or_weekday_frequency(client, guest_headers, frozen_day):
    frozen_day['date'] = date(2026, 10, 5)
    task = await create_task(client, guest_headers, target=20, daily_quota=1,
        schedule={'mode': 'weekdays', 'weekdays': [0, 2, 4]})
    await add_record(client, guest_headers, task['id'], 1)
    frozen_day['date'] += timedelta(days=1)
    await archive(client, guest_headers, task['id'])
    frozen_day['date'] += timedelta(days=3)
    restored = await archive(client, guest_headers, task['id'], restore=True)
    assert restored['tasks'][0]['schedule']['weekdays'] == [0, 2, 4]
    assert restored['tasks'][0]['progress'] == 1
    achieved = await add_record(client, guest_headers, task['id'], 1)
    assert achieved['tasks'][0]['progress'] == 2
    assert len((await client.get('/api/history', headers=guest_headers)).json()['history']) == 2
    frozen_day['date'] += timedelta(days=3)
    await archive(client, guest_headers, task['id'])
    assert (await client.get('/api/state', headers=guest_headers)).json()['stats']['streak'] == 0


async def test_archived_plan_does_not_complete_or_generate_rest_checkins_until_restored(client, guest_headers, frozen_day):
    frozen_day['date'] = date(2026, 10, 5)
    task = await create_task(client, guest_headers, daily_plan=[1, 0, -1, 1], plan_start_date='2026-10-05')
    await add_record(client, guest_headers, task['id'], 1)
    await archive(client, guest_headers, task['id'])
    frozen_day['date'] += timedelta(days=5)
    state = assert_mutation(await client.get('/api/state', headers=guest_headers))
    assert not state['archived_tasks'][0]['is_done'] and state['stats']['xp'] == 0
    history = (await client.get('/api/history', headers=guest_headers)).json()['history']
    assert len(history) == 1 and history[0]['amount'] == 1
    restored = await archive(client, guest_headers, task['id'], restore=True)
    assert restored['tasks'][0]['is_done'] and restored['tasks'][0]['progress'] == 1
    assert len((await client.get('/api/history', headers=guest_headers)).json()['history']) == 1


async def test_same_day_archive_restore_does_not_disable_tomorrow(client, guest_headers, frozen_day):
    frozen_day['date'] = date(2026, 12, 31)
    task = await create_task(client, guest_headers, target=20, daily_minimum=1)
    for _ in range(2):
        await archive(client, guest_headers, task['id'])
        await archive(client, guest_headers, task['id'], restore=True)
    frozen_day['date'] += timedelta(days=1)
    state = assert_mutation(await client.get('/api/state', headers=guest_headers))
    assert state['tasks'][0]['is_scheduled_today'] and state['stats']['today_total'] == 1


async def test_archived_course_preserves_checklist_and_can_be_deleted_and_undone(client, guest_headers):
    task = await create_task(client, guest_headers, daily_minimum=1,
        course_items=[{'name': 'Chapter/', 'done': False}, {'name': 'First', 'done': False}, {'name': 'Second', 'done': False}])
    learned = assert_mutation(await client.post(f"/api/tasks/{task['id']}/course", headers=guest_headers,
        json={'indices': [1], 'done': True}))['tasks'][0]['course_items']
    await archive(client, guest_headers, task['id'])
    assert (await client.post(f"/api/tasks/{task['id']}/course", headers=guest_headers,
        json={'indices': [2], 'done': True})).status_code == 409
    deleted = assert_mutation(await client.delete(f"/api/tasks/{task['id']}", headers=guest_headers))
    assert deleted['archived_tasks'] == []
    undone = assert_mutation(await client.post('/api/tasks/undo', headers=guest_headers,
        json={'token': deleted['undo_token']}))
    assert undone['archived_tasks'][0]['course_items'] == learned
    assert undone['archived_tasks'][0]['progress'] == 1


async def test_guest_quota_names_and_owner_isolation_include_archives(client, guest_headers, other_guest_headers):
    task = await create_task(client, guest_headers)
    await archive(client, guest_headers, task['id'])
    assert (await client.post('/api/tasks', headers=guest_headers, json={'name': task['name']})).status_code == 409
    for action in ['archive', 'restore']:
        assert (await client.post(f"/api/tasks/{task['id']}/{action}", headers=other_guest_headers)).status_code == 404
    assert assert_mutation(await client.get('/api/state', headers=other_guest_headers))['archived_tasks'] == []
    for index in range(9):
        await create_task(client, guest_headers, name=f'Task {index}')
    assert (await client.post('/api/tasks', headers=guest_headers, json={'name': 'Over quota'})).status_code == 403


async def test_archives_survive_guest_migration_and_export(client, guest_headers):
    task = await create_task(client, guest_headers)
    await archive(client, guest_headers, task['id'])
    user = await register_user(client, headers=guest_headers)
    assert user['archived_tasks'][0]['id'] == task['id']
    exported = (await client.get('/api/profile/export', headers={'Authorization': f"Bearer {user['access_token']}"})).json()
    assert exported['archived_tasks'][0]['id'] == task['id']
    assert exported['archive_history'][0]['task_id'] == task['id']


async def test_active_focus_must_be_confirmed_before_archive(client, guest_headers):
    task = await create_task(client, guest_headers)
    started = assert_mutation(await client.post('/api/focus/start', headers=guest_headers,
        json={'task_id': task['id'], 'request_id': str(uuid4())}))
    assert (await client.post(f"/api/tasks/{task['id']}/archive", headers=guest_headers)).status_code == 409
    session_id = started['focus']['active_session']['id']
    assert_mutation(await client.post(f'/api/focus/{session_id}/end', headers=guest_headers))
    assert_mutation(await client.post(f'/api/focus/{session_id}/settle', headers=guest_headers, json={'record_progress': False}))
    await archive(client, guest_headers, task['id'])
    rejected = await client.post('/api/focus/start', headers=guest_headers,
        json={'task_id': task['id'], 'request_id': str(uuid4())})
    assert rejected.status_code == 409


async def test_archived_items_are_excluded_from_drag_order(client, guest_headers):
    one = await create_task(client, guest_headers, name='First')
    two = await create_task(client, guest_headers, name='Second')
    await archive(client, guest_headers, one['id'])
    reordered = assert_mutation(await client.post('/api/tasks/reorder', headers=guest_headers, json={'ids': [two['id']]}))
    assert len(reordered['archived_tasks']) == 1
    restored = await archive(client, guest_headers, one['id'], restore=True)
    assert {row['id'] for row in restored['tasks']} == {one['id'], two['id']}
