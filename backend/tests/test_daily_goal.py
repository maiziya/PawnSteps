"""Desired daily quantities are distinct from qualifying minima and task totals."""
from conftest import add_record, assert_mutation, create_task


async def test_daily_goal_preserves_minimum_and_cumulative_progress(client, guest_headers, frozen_day):
    task = await create_task(client, guest_headers, target=100, daily_minimum=2, daily_goal=5, unit='页')
    state = await add_record(client, guest_headers, task['id'], 2)
    result = state['tasks'][0]
    assert result['target'] == 100 and result['progress'] == 2
    assert result['daily_minimum'] == 2 and result['daily_goal'] == 5
    assert result['daily_done'] and state['stats']['streak'] == 1
    state = assert_mutation(await client.patch(f"/api/tasks/{task['id']}", headers=guest_headers, json={'daily_goal': 8}))
    assert state['tasks'][0]['daily_goal'] == 8
    assert state['tasks'][0]['daily_minimum'] == 2 and state['tasks'][0]['daily_done']


async def test_daily_task_goal_can_exceed_its_qualifying_quota(client, guest_headers, frozen_day):
    task = await create_task(client, guest_headers, target=3, daily_quota=2, daily_goal=5)
    state = await add_record(client, guest_headers, task['id'], 2)
    assert state['tasks'][0]['progress'] == 1 and state['tasks'][0]['daily_done']
    assert state['tasks'][0]['daily_goal'] == 5 and state['stats']['streak'] == 1


async def test_goal_constraints_apply_on_create_and_edit(client, guest_headers):
    response = await client.post('/api/tasks', headers=guest_headers, json={'name': 'Bad goal', 'target': 20, 'daily_minimum': 5, 'daily_goal': 2})
    assert response.status_code == 422
    response = await client.post('/api/tasks', headers=guest_headers, json={'name': 'Too much', 'target': 3, 'daily_minimum': 1, 'daily_goal': 5})
    assert response.status_code == 422
    task = await create_task(client, guest_headers, target=20, daily_minimum=2, daily_goal=5)
    for patch in [{'daily_goal': 1}, {'daily_minimum': 6}, {'target': 4}, {'daily_goal': None}]:
        response = await client.patch(f"/api/tasks/{task['id']}", headers=guest_headers, json=patch)
        assert response.status_code == 422
