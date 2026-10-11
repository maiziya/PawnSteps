from datetime import timedelta
from uuid import uuid4
import pytest
from conftest import add_record, assert_mutation, create_task


def stages(*values):
    return [{'value': value, 'name': f'Stage {value}'} for value in values]


async def test_stages_default_off_sorted_and_progress_is_derived(client, guest_headers):
    legacy = await create_task(client, guest_headers, name='No stages')
    assert legacy['stages'] == []
    assert legacy['stage_progress'] == {'completed': 0, 'total': 0, 'next_stage': None}
    task = await create_task(client, guest_headers, name='Reading', target=10, stages=stages(10, 3, 6))
    assert [stage['value'] for stage in task['stages']] == [3, 6, 10]
    assert task['stage_progress']['next_stage']['remaining'] == 3
    body = {'amount': 7, 'request_id': str(uuid4())}
    response = assert_mutation(await client.post(f"/api/tasks/{task['id']}/records", headers=guest_headers, json=body), 201)
    saved = next(row for row in response['tasks'] if row['id'] == task['id'])
    assert saved['stage_progress'] == {'completed': 2, 'total': 3, 'next_stage': {'value': 10, 'name': 'Stage 10', 'remaining': 3}}
    assert response['stats']['xp'] == 0
    repeated = assert_mutation(await client.post(f"/api/tasks/{task['id']}/records", headers=guest_headers, json=body), 201)
    assert next(row for row in repeated['tasks'] if row['id'] == task['id'])['record_count'] == 1
    final = await add_record(client, guest_headers, task['id'], 5)
    saved = next(row for row in final['tasks'] if row['id'] == task['id'])
    assert saved['stage_progress'] == {'completed': 3, 'total': 3, 'next_stage': None}
    assert final['stats']['xp'] == 100


@pytest.mark.parametrize('nodes', [stages(0), stages(11), stages(3, 3), [{'value': True}], [{'value': 1.5}], [{'value': '3'}], stages(1, 2, 3, 4, 5, 6, 7), [{'value': 1, 'name': 'x' * 41}], [{'value': 1, 'reached': True}]])
async def test_stage_validation_rejects_invalid_nodes(client, guest_headers, nodes):
    response = await client.post('/api/tasks', headers=guest_headers, json={'name': 'Invalid', 'target': 10, 'stages': nodes})
    assert response.status_code == 422


async def test_edit_undo_and_target_changes_keep_stage_state_consistent(client, guest_headers, frozen_day):
    task = await create_task(client, guest_headers, target=10, stages=stages(3, 6, 10))
    previous = frozen_day['date'].isoformat()
    frozen_day['date'] += timedelta(days=1)
    result = assert_mutation(await client.post(f"/api/tasks/{task['id']}/records", headers=guest_headers, json={'amount': 6, 'date': previous}), 201)
    assert result['tasks'][0]['stage_progress']['completed'] == 2
    assert result['tasks'][0]['today_amount'] == 0
    path = f"/api/tasks/{task['id']}/records/{result['record']['id']}"
    corrected = assert_mutation(await client.patch(path, headers=guest_headers, json={'amount': 2}))
    assert corrected['tasks'][0]['stage_progress']['completed'] == 0
    assert corrected['tasks'][0]['stage_progress']['next_stage']['remaining'] == 1
    rejected = await client.patch(f"/api/tasks/{task['id']}", headers=guest_headers, json={'target': 5})
    assert rejected.status_code == 422
    adjusted = assert_mutation(await client.patch(f"/api/tasks/{task['id']}", headers=guest_headers, json={'target': 5, 'stages': stages(3, 5)}))
    assert adjusted['tasks'][0]['stage_progress']['total'] == 2
    cleared = assert_mutation(await client.patch(f"/api/tasks/{task['id']}", headers=guest_headers, json={'stages': []}))
    assert cleared['tasks'][0]['stage_progress']['next_stage'] is None
    assert_mutation(await client.delete(path, headers=guest_headers))


async def test_daily_stages_count_qualified_days_and_do_not_reset_with_today(client, guest_headers, frozen_day):
    task = await create_task(client, guest_headers, target=3, daily_quota=2, stages=stages(1, 2, 3))
    first = await add_record(client, guest_headers, task['id'], 1)
    assert first['tasks'][0]['stage_progress']['completed'] == 0
    second = await add_record(client, guest_headers, task['id'], 5)
    assert second['tasks'][0]['stage_progress']['completed'] == 1
    frozen_day['date'] += timedelta(days=1)
    state = assert_mutation(await client.get('/api/state', headers=guest_headers))
    assert state['tasks'][0]['stage_progress']['completed'] == 1
    assert state['tasks'][0]['today_amount'] == 0
    third = await add_record(client, guest_headers, task['id'], 2)
    assert third['tasks'][0]['stage_progress']['completed'] == 2


async def test_course_stages_exclude_folders_and_plan_expiry_does_not_complete_unearned_stages(client, guest_headers, frozen_day):
    course = await create_task(client, guest_headers, name='Course', course_items=[{'name': 'Folder/'}, {'name': 'One'}, {'name': 'Two'}], stages=stages(1, 2))
    result = assert_mutation(await client.post(f"/api/tasks/{course['id']}/course", headers=guest_headers, json={'indices': [1], 'done': True}))
    assert result['tasks'][0]['stage_progress']['completed'] == 1
    plan = await create_task(client, guest_headers, name='Plan', daily_plan=[2, 0, 2], plan_start_date=frozen_day['date'].isoformat(), stages=stages(2, 4))
    await add_record(client, guest_headers, plan['id'], 5)
    frozen_day['date'] += timedelta(days=3)
    state = assert_mutation(await client.get('/api/state', headers=guest_headers))
    expired = next(row for row in state['tasks'] if row['id'] == plan['id'])
    assert expired['is_done'] and expired['plan_expired']
    assert expired['stage_progress']['completed'] == 1
    assert expired['stage_progress']['next_stage']['remaining'] == 2


async def test_stage_edit_is_owner_scoped_and_archive_retains_stages(client, guest_headers, other_guest_headers):
    task = await create_task(client, guest_headers, stages=[{'value': 1, 'name': '  First  '}])
    assert task['stages'][0]['name'] == 'First'
    assert (await client.patch(f"/api/tasks/{task['id']}", headers=other_guest_headers, json={'stages': []})).status_code == 404
    archived = assert_mutation(await client.post(f"/api/tasks/{task['id']}/archive", headers=guest_headers))
    assert archived['archived_tasks'][0]['stages'] == task['stages']
    assert (await client.patch(f"/api/tasks/{task['id']}", headers=guest_headers, json={'stages': []})).status_code == 409
    restored = assert_mutation(await client.post(f"/api/tasks/{task['id']}/restore", headers=guest_headers))
    assert restored['tasks'][0]['stages'] == task['stages']


async def test_daily_backfill_reaches_stage_using_day_count_without_changing_today(client, guest_headers, frozen_day):
    task = await create_task(client, guest_headers, target=3, daily_quota=2, stages=stages(1, 3))
    previous = frozen_day['date'].isoformat()
    frozen_day['date'] += timedelta(days=1)
    result = assert_mutation(await client.post(f"/api/tasks/{task['id']}/records", headers=guest_headers, json={'amount': 5, 'date': previous}), 201)
    assert result['tasks'][0]['stage_progress']['completed'] == 1
    assert result['tasks'][0]['stage_progress']['next_stage']['remaining'] == 2
    assert result['tasks'][0]['today_amount'] == 0
