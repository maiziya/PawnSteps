"""Ordinary goals keep quantity progress while qualifying daily check-ins separately."""
from datetime import timedelta

from conftest import add_record, assert_mutation, create_task


async def test_ordinary_goal_qualifies_without_turning_total_into_days(client, guest_headers, frozen_day):
    task = await create_task(client, guest_headers, target=100, daily_minimum=5, unit='页')
    first = await add_record(client, guest_headers, task['id'], 1)
    assert first['stats']['streak'] == 0
    assert first['tasks'][0]['progress'] == 1
    state = await add_record(client, guest_headers, task['id'], 5)
    assert state['tasks'][0]['progress'] == 6
    assert state['tasks'][0]['daily_quota'] == 0
    assert state['tasks'][0]['daily_done']
    assert state['stats']['streak'] == 1
    assert state['stats']['today_completed'] == 1
    entry = (await client.get('/api/history', headers=guest_headers)).json()['history'][0]
    assert entry['quota'] == 5 and entry['amount'] == 6 and entry['completed']
    frozen_day['date'] += timedelta(days=1)
    state = (await client.get('/api/state', headers=guest_headers)).json()
    assert state['tasks'][0]['progress'] == 6
    assert state['tasks'][0]['today_amount'] == 0
    assert not state['tasks'][0]['daily_done']
    state = await add_record(client, guest_headers, task['id'], 5)
    assert state['tasks'][0]['progress'] == 11 and state['stats']['streak'] == 2
    state = assert_mutation(await client.delete(f"/api/tasks/{task['id']}/records/{state['record']['id']}", headers=guest_headers))
    assert state['tasks'][0]['progress'] == 6 and state['stats']['streak'] == 0


async def test_minimum_changes_today_but_preserves_historical_threshold(client, guest_headers, frozen_day):
    task = await create_task(client, guest_headers, target=100, daily_minimum=5)
    await add_record(client, guest_headers, task['id'], 5)
    old_day = frozen_day['date'].isoformat()
    frozen_day['date'] += timedelta(days=1)
    await add_record(client, guest_headers, task['id'], 3)
    state = assert_mutation(await client.patch(f"/api/tasks/{task['id']}", headers=guest_headers, json={'daily_minimum': 2}))
    assert state['stats']['streak'] == 2
    rows = (await client.get('/api/history', headers=guest_headers)).json()['history']
    assert next(row for row in rows if row['date'] == old_day)['quota'] == 5
    assert next(row for row in rows if row['date'] != old_day)['quota'] == 2
    response = await client.patch(f"/api/tasks/{task['id']}", headers=guest_headers, json={'daily_minimum': -1})
    assert response.status_code == 422


async def test_minimum_cannot_exceed_total_or_change_a_daily_task_kind(client, guest_headers):
    response = await client.post('/api/tasks', headers=guest_headers, json={'name': 'Invalid minimum', 'target': 2, 'daily_minimum': 3})
    assert response.status_code == 422
    ordinary = await create_task(client, guest_headers, 'Ordinary', target=10, daily_minimum=5)
    response = await client.patch(f"/api/tasks/{ordinary['id']}", headers=guest_headers, json={'target': 4})
    assert response.status_code == 422
    daily = await create_task(client, guest_headers, 'Daily', daily_quota=3)
    response = await client.patch(f"/api/tasks/{daily['id']}", headers=guest_headers, json={'daily_minimum': 1})
    assert response.status_code == 422
