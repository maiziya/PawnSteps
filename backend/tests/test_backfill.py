from datetime import timedelta
from uuid import uuid4

from conftest import add_record, assert_mutation, create_task


async def test_backfill_uses_selected_day_and_actual_creation_time_and_retries_once(client, guest_headers, frozen_day):
    task = await create_task(client, guest_headers, target=20, daily_minimum=2)
    previous = frozen_day['date'].isoformat()
    frozen_day['date'] += timedelta(days=1)
    request_id = str(uuid4())
    body = {'amount': 3, 'date': previous, 'request_id': request_id, 'note': 'Yesterday reading'}
    response = assert_mutation(await client.post(f"/api/tasks/{task['id']}/records", headers=guest_headers, json=body), 201)
    assert response['record']['date'] == previous
    assert response['record']['is_backfill'] is True
    assert response['record_day']['backfill_count'] == 1
    assert response['tasks'][0]['today_amount'] == 0
    assert response['tasks'][0]['progress'] == 3
    retry = assert_mutation(await client.post(f"/api/tasks/{task['id']}/records", headers=guest_headers, json=body), 201)
    assert retry['tasks'][0]['record_count'] == 1
    body['date'] = frozen_day['date'].isoformat()
    assert (await client.post(f"/api/tasks/{task['id']}/records", headers=guest_headers, json=body)).status_code == 409
    history = (await client.get('/api/history', headers=guest_headers)).json()['history']
    assert history[0]['date'] == previous
    assert history[0]['completed'] is True
    assert history[0]['has_backfill'] is True


async def test_historical_threshold_is_retained_for_previously_empty_days(client, guest_headers, frozen_day):
    task = await create_task(client, guest_headers, target=20, daily_minimum=2)
    previous = frozen_day['date'].isoformat()
    frozen_day['date'] += timedelta(days=1)
    assert_mutation(await client.patch(f"/api/tasks/{task['id']}", headers=guest_headers, json={'daily_minimum': 5, 'daily_goal': 5}))
    state = assert_mutation(await client.post(f"/api/tasks/{task['id']}/records", headers=guest_headers, json={'amount': 2, 'date': previous}), 201)
    assert state['tasks'][0]['today_amount'] == 0
    row = (await client.get('/api/history', headers=guest_headers)).json()['history'][0]
    assert row['quota'] == 2 and row['completed'] is True


async def test_backfill_restores_streak_and_edit_revoke_recompute_it(client, guest_headers, frozen_day):
    task = await create_task(client, guest_headers, target=10, daily_quota=2)
    await add_record(client, guest_headers, task['id'], 2)
    frozen_day['date'] += timedelta(days=1)
    missing = frozen_day['date'].isoformat()
    frozen_day['date'] += timedelta(days=1)
    await add_record(client, guest_headers, task['id'], 2)
    filled = assert_mutation(await client.post(f"/api/tasks/{task['id']}/records", headers=guest_headers, json={'amount': 2, 'date': missing}), 201)
    assert filled['stats']['streak'] == 3
    assert next(row for row in filled['rewards'] if row['streak_target'] == 3)['is_unlocked'] is True
    assert filled['tasks'][0]['today_amount'] == 2
    assert filled['tasks'][0]['progress'] == 3
    path = f"/api/tasks/{task['id']}/records/{filled['record']['id']}"
    edited = assert_mutation(await client.patch(path, headers=guest_headers, json={'amount': 1}))
    assert edited['stats']['streak'] == 1
    assert edited['record']['is_backfill'] is True
    assert edited['tasks'][0]['progress'] == 2
    revoked = assert_mutation(await client.delete(path, headers=guest_headers))
    assert revoked['record_day']['backfill_count'] == 0
    assert revoked['tasks'][0]['today_amount'] == 2


async def test_dates_validate_lifetime_future_permissions_and_archive_pause(client, guest_headers, other_guest_headers, frozen_day):
    task = await create_task(client, guest_headers, target=20)
    path = f"/api/tasks/{task['id']}/records"
    for day in (frozen_day['date'] - timedelta(days=1), frozen_day['date'] + timedelta(days=1)):
        assert (await client.post(path, headers=guest_headers, json={'amount': 1, 'date': day.isoformat()})).status_code == 422
    assert (await client.post(path, headers=other_guest_headers, json={'amount': 1, 'date': frozen_day['date'].isoformat()})).status_code == 404
    assert_mutation(await client.post(f"/api/tasks/{task['id']}/archive", headers=guest_headers))
    assert (await client.post(path, headers=guest_headers, json={'amount': 1, 'date': frozen_day['date'].isoformat()})).status_code == 409
    frozen_day['date'] += timedelta(days=1)
    paused = frozen_day['date'].isoformat()
    frozen_day['date'] += timedelta(days=1)
    assert_mutation(await client.post(f"/api/tasks/{task['id']}/restore", headers=guest_headers))
    assert (await client.post(path, headers=guest_headers, json={'amount': 1, 'date': paused})).status_code == 409


async def test_expired_plan_accepts_positive_historical_day_but_not_rest_or_outside(client, guest_headers, frozen_day):
    start = frozen_day['date']
    task = await create_task(client, guest_headers, daily_plan=[2, 0, 3], plan_start_date=start.isoformat())
    frozen_day['date'] += timedelta(days=4)
    path = f"/api/tasks/{task['id']}/records"
    state = assert_mutation(await client.post(path, headers=guest_headers, json={'amount': 2, 'date': start.isoformat()}), 201)
    assert state['tasks'][0]['progress'] == 2
    assert state['tasks'][0]['today_amount'] == 0
    for day in (start + timedelta(days=1), start + timedelta(days=3)):
        assert (await client.post(path, headers=guest_headers, json={'amount': 2, 'date': day.isoformat()})).status_code == 409


async def test_completed_task_accepts_historical_actual_work_without_duplicate_xp(client, guest_headers, frozen_day):
    task = await create_task(client, guest_headers, target=2)
    day = frozen_day['date'].isoformat()
    await add_record(client, guest_headers, task['id'], 2)
    frozen_day['date'] += timedelta(days=2)
    state = assert_mutation(await client.post(f"/api/tasks/{task['id']}/records", headers=guest_headers, json={'amount': 1, 'date': day}), 201)
    assert state['stats']['xp'] == 100
    assert state['tasks'][0]['today_amount'] == 0
    assert state['tasks'][0]['progress'] == 2
    after_finish = (frozen_day['date'] - timedelta(days=1)).isoformat()
    assert (await client.post(f"/api/tasks/{task['id']}/records", headers=guest_headers, json={'amount': 1, 'date': after_finish})).status_code == 409


async def test_course_backfill_dates_only_actual_lessons_and_clears_markers_on_undo(client, guest_headers, frozen_day):
    task = await create_task(client, guest_headers, course_items=[{'name': 'Chapter/'}, {'name': 'Lesson A'}, {'name': 'Lesson B'}], daily_minimum=1)
    day = frozen_day['date'].isoformat()
    frozen_day['date'] += timedelta(days=1)
    path = f"/api/tasks/{task['id']}/course"
    filled = assert_mutation(await client.post(path, headers=guest_headers, json={'indices': [0, 1], 'done': True, 'date': day}))
    row = filled['tasks'][0]
    assert row['today_amount'] == 0 and row['progress'] == 1
    assert row['course_items'][1]['is_backfill'] is True
    assert row['course_items'][1]['recorded_at']
    assert row['course_items'][1]['done_date'] == day
    assert row['course_items'][0]['done'] is False
    assert (await client.get('/api/history', headers=guest_headers)).json()['history'][0]['has_backfill'] is True
    undone = assert_mutation(await client.post(path, headers=guest_headers, json={'indices': [1], 'done': False}))
    assert undone['tasks'][0]['course_items'][1]['is_backfill'] is False
    assert undone['tasks'][0]['progress'] == 0


async def test_day_cursor_does_not_skip_dates_when_an_older_missing_day_is_filled(client, guest_headers, frozen_day):
    task = await create_task(client, guest_headers, target=100)
    missing = frozen_day['date'].isoformat()
    for _ in range(3):
        frozen_day['date'] += timedelta(days=1)
        await add_record(client, guest_headers, task['id'], 1)
    path = f"/api/tasks/{task['id']}/record-days"
    first = (await client.get(path, headers=guest_headers, params={'limit': 2})).json()
    assert first['has_more'] is True
    await client.post(f"/api/tasks/{task['id']}/records", headers=guest_headers, json={'amount': 1, 'date': missing})
    second = (await client.get(path, headers=guest_headers, params={'limit': 2, 'before': first['next_before']})).json()
    assert second['has_more'] is False
    assert len({day['date'] for day in first['days'] + second['days']}) == 4
    assert second['days'][-1]['date'] == missing


async def test_normal_backfill_exposes_actual_total_beyond_goal_and_recalculates_after_revoke(client, guest_headers, other_guest_headers, frozen_day):
    task = await create_task(client, guest_headers, target=10)
    previous = frozen_day['date'].isoformat()
    frozen_day['date'] += timedelta(days=1)
    path = f"/api/tasks/{task['id']}/records"
    first = assert_mutation(await client.post(path, headers=guest_headers, json={'amount': 10, 'date': previous}), 201)
    extra = assert_mutation(await client.post(path, headers=guest_headers, json={'amount': 3, 'date': previous}), 201)
    row = extra['tasks'][0]
    assert row['total_amount'] == 13
    assert row['progress'] == 10 and row['today_amount'] == 0 and row['is_done'] is True
    assert extra['stats']['xp'] == first['stats']['xp'] == 100
    assert (await client.get('/api/state', headers=other_guest_headers)).json()['tasks'] == []
    assert (await client.get('/api/state', headers=guest_headers)).json()['tasks'][0]['total_amount'] == 13
    corrected = assert_mutation(await client.patch(f"{path}/{extra['record']['id']}", headers=guest_headers, json={'amount': 1}))
    assert corrected['tasks'][0]['total_amount'] == 11
    revoked = assert_mutation(await client.delete(f"{path}/{first['record']['id']}", headers=guest_headers))
    assert revoked['tasks'][0]['total_amount'] == revoked['tasks'][0]['progress'] == 1
    assert revoked['stats']['xp'] == 0
