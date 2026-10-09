"""Timer time, ownership, pauses, settlement and midnight are business invariants."""
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest

from conftest import assert_mutation, create_task, register_user


@pytest.fixture
def clock(monkeypatch):
    from app.services import focus, tracker
    from zoneinfo import ZoneInfo
    value = {'now': datetime(2026, 10, 8, 1, 0, tzinfo=timezone.utc)}
    monkeypatch.setattr(focus, 'utcnow', lambda: value['now'])
    monkeypatch.setattr(tracker, 'utcnow', lambda: value['now'])
    monkeypatch.setattr(tracker, 'today', lambda: value['now'].astimezone(ZoneInfo('Asia/Shanghai')).date())
    return value


async def settings(client, headers, **fields):
    response = await client.patch('/api/focus/settings', headers=headers, json=fields)
    return assert_mutation(response)['focus']


async def start(client, headers, task=None, phase='focus', request_id=None):
    response = await client.post('/api/focus/start', headers=headers, json={
        'request_id': str(request_id or uuid4()), 'task_id': task['id'] if task else None, 'phase': phase,
    })
    return assert_mutation(response, 201)['focus']['active_session']


async def state(client, headers):
    response = await client.get('/api/focus', headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


async def control(client, headers, row, action):
    return assert_mutation(await client.post(f"/api/focus/{row['id']}/{action}", headers=headers))['focus']


async def settle(client, headers, row, **fields):
    return assert_mutation(await client.post(f"/api/focus/{row['id']}/settle", headers=headers, json=fields))


async def test_pause_resume_excludes_paused_time_and_recovers_from_server(client, guest_headers, clock):
    await settings(client, guest_headers, focus_minutes=1)
    row = await start(client, guest_headers)
    clock['now'] += timedelta(seconds=20)
    paused = await control(client, guest_headers, row, 'pause')
    assert paused['active_session']['elapsed_seconds'] == 20
    assert paused['active_session']['deadline_at'] is None
    clock['now'] += timedelta(minutes=10)
    assert (await state(client, guest_headers))['active_session']['remaining_seconds'] == 40
    await control(client, guest_headers, row, 'resume')
    await control(client, guest_headers, row, 'resume')
    clock['now'] += timedelta(seconds=41)
    completed = await state(client, guest_headers)
    assert completed['active_session']['status'] == 'completed'
    assert completed['summary']['today_seconds'] == 60
    assert completed['summary']['today_pomodoros'] == 1
    assert (await state(client, guest_headers))['summary']['total_pomodoros'] == 1


async def test_start_is_idempotent_and_only_one_timer_is_active(client, guest_headers, other_guest_headers, clock):
    request_id = uuid4()
    first = await start(client, guest_headers, request_id=request_id)
    repeated = await start(client, guest_headers, request_id=request_id)
    assert first['id'] == repeated['id']
    response = await client.post('/api/focus/start', headers=guest_headers, json={'request_id': str(uuid4())})
    assert response.status_code == 409
    assert (await state(client, other_guest_headers))['active_session'] is None
    for action in ['pause', 'resume', 'end', 'notify']:
        response = await client.post(f"/api/focus/{first['id']}/{action}", headers=other_guest_headers)
        assert response.status_code == 404
    response = await client.post('/api/focus/start', headers=other_guest_headers, json={'request_id': str(uuid4()), 'duration_seconds': 1})
    assert response.status_code == 422


async def test_minutes_require_confirmation_and_cannot_exceed_measured_time(client, guest_headers, clock):
    await settings(client, guest_headers, focus_minutes=1)
    task = await create_task(client, guest_headers, target=10, unit='分钟', daily_minimum=1)
    row = await start(client, guest_headers, task)
    clock['now'] += timedelta(seconds=61)
    await state(client, guest_headers)
    assert (await client.get('/api/state', headers=guest_headers)).json()['tasks'][0]['progress'] == 0
    response = await client.post(f"/api/focus/{row['id']}/settle", headers=guest_headers, json={'record_progress': True, 'amount': 2})
    assert response.status_code == 422
    result = await settle(client, guest_headers, row, record_progress=True, amount=1)
    assert result['tasks'][0]['progress'] == 1 and result['stats']['streak'] == 1
    assert result['focus']['active_session']['phase'] == 'short_break'
    record_id = result['record']['id']
    repeated = await settle(client, guest_headers, row, record_progress=True, amount=1)
    assert repeated['tasks'][0]['record_count'] == 1
    assert repeated['record']['id'] == record_id
    assert repeated['focus']['recent_sessions'][0]['progress_record_id'] == record_id
    response = await client.post(f"/api/focus/{row['id']}/settle", headers=guest_headers, json={'record_progress': False})
    assert response.status_code == 409


async def test_early_end_keeps_actual_time_without_a_pomodoro_or_auto_break(client, guest_headers, clock):
    await settings(client, guest_headers, focus_minutes=1)
    row = await start(client, guest_headers)
    clock['now'] += timedelta(seconds=35)
    ended = await control(client, guest_headers, row, 'end')
    assert ended['active_session']['status'] == 'ended'
    result = await settle(client, guest_headers, row)
    assert result['focus']['active_session'] is None
    assert result['focus']['summary']['today_seconds'] == 35
    assert result['focus']['summary']['total_pomodoros'] == 0


async def test_long_break_cycle_and_settings_do_not_change_a_running_duration(client, guest_headers, clock):
    await settings(client, guest_headers, focus_minutes=1, short_break_minutes=1, long_break_minutes=2, long_break_interval=2)
    first = await start(client, guest_headers)
    clock['now'] += timedelta(minutes=1)
    rest = (await settle(client, guest_headers, first))['focus']['active_session']
    assert rest['phase'] == 'short_break'
    await control(client, guest_headers, rest, 'end')
    second = await start(client, guest_headers)
    updated = await settings(client, guest_headers, focus_minutes=3, long_break_interval=4)
    assert updated['active_session']['duration_seconds'] == 60
    clock['now'] += timedelta(minutes=1)
    rest = (await settle(client, guest_headers, second))['focus']['active_session']
    assert rest['phase'] == 'long_break' and rest['duration_seconds'] == 120
    clock['now'] += timedelta(minutes=2)
    assert (await state(client, guest_headers))['summary']['today_seconds'] == 120
    assert (await state(client, guest_headers))['summary']['total_pomodoros'] == 2


async def test_course_confirmation_is_idempotent_after_later_unchecking(client, guest_headers, clock):
    task = await create_task(client, guest_headers, course_items=[{'name': 'A'}, {'name': 'B'}], daily_minimum=1, daily_goal=2)
    row = await start(client, guest_headers, task)
    clock['now'] += timedelta(seconds=30)
    await control(client, guest_headers, row, 'end')
    result = await settle(client, guest_headers, row, record_progress=True, course_indices=[0])
    assert result['tasks'][0]['progress'] == 1 and result['stats']['streak'] == 1
    assert result['focus']['summary']['today_pomodoros'] == 0
    await client.post(f"/api/tasks/{task['id']}/course", headers=guest_headers, json={'indices': [0], 'done': False})
    repeated = await settle(client, guest_headers, row, record_progress=True, course_indices=[0])
    assert repeated['tasks'][0]['progress'] == 0


async def test_midnight_time_is_split_and_late_return_does_not_create_more_rounds(client, guest_headers, clock):
    clock['now'] = datetime(2026, 10, 8, 15, 59, 30, tzinfo=timezone.utc)
    await settings(client, guest_headers, focus_minutes=1)
    await start(client, guest_headers)
    clock['now'] += timedelta(seconds=61)
    result = await state(client, guest_headers)
    assert result['summary']['today_seconds'] == 30 and result['summary']['today_pomodoros'] == 1
    clock['now'] += timedelta(days=2)
    result = await state(client, guest_headers)
    assert result['summary']['today_seconds'] == 0 and result['summary']['total_pomodoros'] == 1
    assert result['active_session']['elapsed_seconds'] == 60


async def test_notification_is_claimed_once_and_deleted_task_can_be_saved_without_progress(client, guest_headers, clock):
    task = await create_task(client, guest_headers, target=10, unit='分钟')
    await settings(client, guest_headers, focus_minutes=1)
    row = await start(client, guest_headers, task)
    await client.delete(f"/api/tasks/{task['id']}", headers=guest_headers)
    clock['now'] += timedelta(seconds=61)
    result = await state(client, guest_headers)
    assert not result['active_session']['can_record'] and result['active_session']['task_id'] is None
    one = assert_mutation(await client.post(f"/api/focus/{row['id']}/notify", headers=guest_headers))
    two = assert_mutation(await client.post(f"/api/focus/{row['id']}/notify", headers=guest_headers))
    assert one['focus']['notification_claimed'] and not two['focus']['notification_claimed']
    result = await settle(client, guest_headers, row)
    assert result['focus']['active_session']['task_id'] is None


async def test_changed_task_unit_blocks_misclassified_progress(client, guest_headers, clock):
    task = await create_task(client, guest_headers, target=100, unit='分钟')
    row = await start(client, guest_headers, task)
    clock['now'] += timedelta(minutes=25)
    await client.patch(f"/api/tasks/{task['id']}", headers=guest_headers, json={'unit': '页'})
    response = await client.post(f"/api/focus/{row['id']}/settle", headers=guest_headers, json={'record_progress': True, 'amount': 25})
    assert response.status_code == 409
    result = await settle(client, guest_headers, row)
    assert result['tasks'][0]['progress'] == 0


async def test_registration_migrates_timer_and_resets_old_guest_state_generation(client, guest_headers, clock):
    row = await start(client, guest_headers)
    old = await state(client, guest_headers)
    user = await register_user(client, username='focusreader', headers=guest_headers)
    headers = {'Authorization': f"Bearer {user['access_token']}"}
    migrated = await state(client, headers)
    assert migrated['active_session']['id'] == row['id']
    assert migrated['generation'] == old['generation']
    empty = await state(client, guest_headers)
    assert empty['active_session'] is None and empty['generation'] != old['generation']


async def test_plan_availability_preserves_unit_guard_and_rests(client, guest_headers, clock):
    task = await create_task(client, guest_headers, unit='分钟', daily_plan=[10, 0], plan_start_date='2026-10-08')
    row = await start(client, guest_headers, task)
    await client.patch(f"/api/tasks/{task['id']}", headers=guest_headers, json={'unit': '页'})
    assert not (await state(client, guest_headers))['active_session']['can_record']
    clock['now'] += timedelta(days=1)
    assert not (await state(client, guest_headers))['active_session']['can_record']
    await settle(client, guest_headers, row)


async def test_focus_export_is_owner_scoped(client, guest_headers, other_guest_headers, clock):
    first = await register_user(client, username='focusexporter', headers=guest_headers)
    headers = {'Authorization': f"Bearer {first['access_token']}"}
    await start(client, headers)
    await start(client, other_guest_headers)
    clock['now'] += timedelta(seconds=30)
    response = await client.get('/api/profile/export', headers=headers)
    assert response.status_code == 200, response.text
    data = response.json()['focus_data']
    assert len(data['sessions']) == 1
    assert len(data['sessions'][0]['intervals']) == 1


async def test_parallel_timer_starts_leave_one_active(client, guest_headers):
    import asyncio
    import os
    if not os.environ.get('TEST_DATABASE_URL', '').startswith('postgresql'):
        pytest.skip('Concurrent timer transactions require disposable PostgreSQL')
    responses = await asyncio.gather(*[client.post('/api/focus/start', headers=guest_headers, json={'request_id': str(uuid4())}) for _ in range(4)])
    assert sorted(response.status_code for response in responses) == [201, 409, 409, 409]
    assert (await state(client, guest_headers))['active_session'] is not None


async def test_parallel_settlement_records_once(client, guest_headers, clock):
    import asyncio
    import os
    if not os.environ.get('TEST_DATABASE_URL', '').startswith('postgresql'):
        pytest.skip('Concurrent timer transactions require disposable PostgreSQL')
    task = await create_task(client, guest_headers, target=10)
    row = await start(client, guest_headers, task)
    clock['now'] += timedelta(seconds=30)
    await control(client, guest_headers, row, 'end')
    results = await asyncio.gather(*[client.post(f"/api/focus/{row['id']}/settle", headers=guest_headers, json={'record_progress': True, 'amount': 2}) for _ in range(4)])
    assert all(response.status_code == 200 for response in results)
    assert (await client.get('/api/state', headers=guest_headers)).json()['tasks'][0]['record_count'] == 1
