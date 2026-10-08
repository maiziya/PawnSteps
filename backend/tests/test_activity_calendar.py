"""Calendar activity includes partial work without fabricating dates or quantities."""
from datetime import timedelta

from conftest import add_record, assert_mutation, create_task


async def calendar(client, headers):
    response = await client.get('/api/history', headers=headers)
    assert response.status_code == 200, response.text
    return [entry for entry in response.json()['history'] if entry['amount'] > 0]


async def test_partial_progress_and_corrections_are_visible_and_isolated(client, guest_headers, other_guest_headers, frozen_day):
    normal = await create_task(client, guest_headers, 'Reading', target=20, unit='页')
    daily = await create_task(client, guest_headers, 'Practice', daily_quota=5)
    first = await add_record(client, guest_headers, normal['id'], 1)
    second = await add_record(client, guest_headers, normal['id'], 5)
    await add_record(client, guest_headers, daily['id'], 1)
    entries = {entry['task_id']: entry for entry in await calendar(client, guest_headers)}
    assert entries[normal['id']]['amount'] == 6
    assert entries[normal['id']]['unit'] == '页'
    assert entries[daily['id']]['amount'] == 1
    assert entries[daily['id']]['quota'] == 5
    assert not entries[daily['id']]['completed']
    assert await calendar(client, other_guest_headers) == []
    assert_mutation(await client.patch(f"/api/tasks/{normal['id']}/records/{second['record']['id']}", headers=guest_headers, json={'amount': 2}))
    assert next(e for e in await calendar(client, guest_headers) if e['task_id'] == normal['id'])['amount'] == 3
    for record in [first['record'], second['record']]:
        assert_mutation(await client.delete(f"/api/tasks/{normal['id']}/records/{record['id']}", headers=guest_headers))
    assert all(e['task_id'] != normal['id'] for e in await calendar(client, guest_headers))


async def test_course_activity_has_real_dates_is_idempotent_and_can_be_unchecked(client, guest_headers, frozen_day):
    task = await create_task(client, guest_headers, 'Course', course_items=[{'name': 'Chapter/'}, {'name': 'One'}, {'name': 'Two'}])
    url = f"/api/tasks/{task['id']}/course"
    for _ in range(2):
        assert_mutation(await client.post(url, headers=guest_headers, json={'indices': [0, 1], 'done': True}))
    first_day = frozen_day['date'].isoformat()
    rows = await calendar(client, guest_headers)
    assert len(rows) == 1
    assert rows[0]['amount'] == 1 and rows[0]['date'] == first_day and rows[0]['unit'] == '节'
    frozen_day['date'] += timedelta(days=1)
    assert_mutation(await client.post(url, headers=guest_headers, json={'indices': [1, 2], 'done': True}))
    assert {row['date']: row['amount'] for row in await calendar(client, guest_headers)} == {first_day: 1, frozen_day['date'].isoformat(): 1}
    assert_mutation(await client.post(url, headers=guest_headers, json={'indices': [1, 2], 'done': False}))
    assert await calendar(client, guest_headers) == []
    assert (await client.get('/api/state', headers=guest_headers)).json()['stats']['streak'] == 0


async def test_rest_day_does_not_fabricate_activity(client, guest_headers, frozen_day):
    await create_task(client, guest_headers, 'Plan', daily_plan=[0, 5], plan_start_date=frozen_day['date'].isoformat())
    assert await calendar(client, guest_headers) == []


async def test_minimum_separates_partial_met_and_exceeded_activity(client, guest_headers, frozen_day):
    task = await create_task(client, guest_headers, 'Daily reading', target=10, daily_quota=5, unit='页')
    state = await add_record(client, guest_headers, task['id'], 1)
    assert state['stats']['streak'] == 0
    entry = (await calendar(client, guest_headers))[0]
    assert entry['amount'] == 1 and entry['quota'] == 5 and not entry['completed']
    state = await add_record(client, guest_headers, task['id'], 4)
    assert state['stats']['streak'] == 1
    entry = (await calendar(client, guest_headers))[0]
    assert entry['amount'] == entry['quota'] and entry['completed']
    state = await add_record(client, guest_headers, task['id'], 2)
    entry = (await calendar(client, guest_headers))[0]
    assert entry['amount'] == 7 and entry['quota'] == 5 and entry['completed']
    assert state['stats']['streak'] == 1
    assert state['tasks'][0]['progress'] == 1
