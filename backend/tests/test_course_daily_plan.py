"""Course check-ins use dated lessons and never count folder markers as work."""
from datetime import timedelta
from uuid import UUID

from conftest import assert_mutation, create_task


async def mark(client, headers, task_id, indices, done=True):
    return assert_mutation(await client.post(f'/api/tasks/{task_id}/course', headers=headers,
                                            json={'indices': indices, 'done': done}))


async def test_course_minimum_goal_and_repeated_checks(client, guest_headers, frozen_day):
    task = await create_task(client, guest_headers, course_items=[{'name': 'Chapter/'}, *[{'name': str(i)} for i in range(6)]],
                             daily_minimum=2, daily_goal=3)
    assert task['target'] == 6 and task['unit'] == '节'
    partial = await mark(client, guest_headers, task['id'], [0, 1])
    assert partial['tasks'][0]['today_amount'] == 1
    assert not partial['tasks'][0]['daily_done'] and partial['stats']['streak'] == 0
    reached = await mark(client, guest_headers, task['id'], [1, 2])
    assert reached['tasks'][0]['progress'] == 2 and reached['tasks'][0]['daily_done']
    assert reached['stats']['today_completed'] == 1 and reached['stats']['streak'] == 1
    repeated = await mark(client, guest_headers, task['id'], [1, 2])
    assert repeated['tasks'][0]['today_amount'] == 2
    exceeded = await mark(client, guest_headers, task['id'], [3, 4])
    assert exceeded['tasks'][0]['today_amount'] == 4
    entry = (await client.get('/api/history', headers=guest_headers)).json()['history'][0]
    assert entry['amount'] == 4 and entry['quota'] == 2 and entry['completed']


async def test_course_crossday_reset_and_historical_uncheck(client, guest_headers, frozen_day):
    task = await create_task(client, guest_headers, course_items=[{'name': str(i)} for i in range(4)], daily_minimum=1, daily_goal=2)
    await mark(client, guest_headers, task['id'], [0])
    yesterday = frozen_day['date'].isoformat()
    frozen_day['date'] += timedelta(days=1)
    reset = (await client.get('/api/state', headers=guest_headers)).json()
    assert reset['tasks'][0]['progress'] == 1
    assert reset['tasks'][0]['today_amount'] == 0 and not reset['tasks'][0]['daily_done']
    assert reset['stats']['streak'] == 0
    state = await mark(client, guest_headers, task['id'], [1])
    assert state['stats']['streak'] == 2
    state = await mark(client, guest_headers, task['id'], [0], False)
    assert state['tasks'][0]['progress'] == 1 and state['stats']['streak'] == 1
    history = (await client.get('/api/history', headers=guest_headers)).json()['history']
    old = next(entry for entry in history if entry['date'] == yesterday)
    assert old['amount'] == 0 and not old['completed']


async def test_course_minimum_edits_are_dated_and_plan_can_be_disabled(client, guest_headers, frozen_day):
    task = await create_task(client, guest_headers, course_items=[{'name': str(i)} for i in range(6)], daily_minimum=2, daily_goal=3)
    await mark(client, guest_headers, task['id'], [0, 1])
    yesterday = frozen_day['date'].isoformat()
    frozen_day['date'] += timedelta(days=1)
    await mark(client, guest_headers, task['id'], [2])
    state = assert_mutation(await client.patch(f"/api/tasks/{task['id']}", headers=guest_headers, json={'daily_minimum': 1, 'daily_goal': 2}))
    assert state['stats']['streak'] == 2
    rows = (await client.get('/api/history', headers=guest_headers)).json()['history']
    assert next(row for row in rows if row['date'] == yesterday)['quota'] == 2
    state = assert_mutation(await client.patch(f"/api/tasks/{task['id']}", headers=guest_headers, json={'daily_minimum': 0, 'daily_goal': None}))
    assert state['tasks'][0]['progress'] == 3 and not state['tasks'][0]['daily_done']


async def test_legacy_course_checks_are_not_assigned_a_new_date(client, guest_headers, frozen_day, session_factory):
    from app.models import Task
    task = await create_task(client, guest_headers, course_items=[{'name': 'Old'}, {'name': 'New'}])
    async with session_factory() as session:
        row = await session.get(Task, UUID(task['id']))
        row.course_items = [{'name': 'Old', 'done': True}, {'name': 'New', 'done': False}]
        await session.commit()
    state = assert_mutation(await client.patch(f"/api/tasks/{task['id']}", headers=guest_headers, json={'daily_minimum': 1, 'daily_goal': 2}))
    assert state['tasks'][0]['progress'] == 1 and state['tasks'][0]['today_amount'] == 0
    assert not state['tasks'][0]['daily_done']
    assert state['tasks'][0]['course_items'][0]['done_date'] is None


async def test_course_plan_validation_and_owner_isolation(client, guest_headers, other_guest_headers):
    items = [{'name': 'Folder/'}, {'name': 'One'}, {'name': 'Two'}]
    for fields in [{'daily_minimum': 3}, {'daily_minimum': 1, 'daily_goal': 3}, {'daily_minimum': 2, 'daily_goal': 1}]:
        response = await client.post('/api/tasks', headers=guest_headers, json={'name': 'Invalid', 'course_items': items, **fields})
        assert response.status_code == 422
    task = await create_task(client, guest_headers, course_items=items, daily_minimum=1, daily_goal=2)
    response = await client.patch(f"/api/tasks/{task['id']}", headers=other_guest_headers, json={'daily_minimum': 2})
    assert response.status_code == 404
    response = await client.patch(f"/api/tasks/{task['id']}", headers=guest_headers, json={'target': 1})
    assert response.status_code == 422
