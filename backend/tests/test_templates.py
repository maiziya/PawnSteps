from datetime import timedelta
import pytest
from conftest import add_record, assert_mutation, create_task


def custom(state):
    return [row for row in state['templates'] if not row['is_builtin']]


async def save(client, headers, task, name='My template'):
    state = assert_mutation(await client.post('/api/templates', headers=headers, json={'name': name, 'source_task_id': task['id']}), 201)
    return custom(state)[0]


async def test_builtins_are_valid_configs_and_creation_starts_at_zero(client, guest_headers):
    state = assert_mutation(await client.get('/api/templates', headers=guest_headers))
    assert len(state['templates']) == 3 and all(row['is_builtin'] for row in state['templates'])
    for index, row in enumerate(state['templates']):
        detail = (await client.get(f"/api/templates/{row['id']}", headers=guest_headers)).json()
        config = detail['configuration']
        config['name'] = f'Builtin {index}'
        created = assert_mutation(await client.post('/api/tasks', headers=guest_headers, json=config), 201)
        task = next(item for item in created['tasks'] if item['name'] == config['name'])
        assert task['progress'] == task['today_amount'] == task['record_count'] == 0
        assert task['stage_progress']['completed'] == 0 and task['is_done'] is False
    assert (await client.patch('/api/templates/builtin-reading', headers=guest_headers, json={'name': 'Changed'})).status_code == 422


async def test_template_copies_config_not_progress_deadline_or_associations(client, guest_headers):
    source = await create_task(client, guest_headers, target=20, daily_minimum=2, daily_goal=5, unit='题', deadline='2030-01-01', stages=[{'value': 5, 'name': 'First'}])
    await add_record(client, guest_headers, source['id'], 7)
    row = await save(client, guest_headers, source)
    detail = (await client.get(f"/api/templates/{row['id']}", headers=guest_headers)).json()
    config = detail['configuration']
    assert config['name'] != source['name'] and len(config['name']) <= 100
    assert config['deadline'] is None and config['reward_id'] is None and config['category_id'] is None
    assert config['stages'] == source['stages'] and config['daily_minimum'] == 2 and config['daily_goal'] == 5
    state = assert_mutation(await client.post('/api/tasks', headers=guest_headers, json=config), 201)
    clone = next(task for task in state['tasks'] if task['name'] == config['name'])
    assert clone['progress'] == 0 and clone['record_count'] == 0
    assert next(task for task in state['tasks'] if task['id'] == source['id'])['progress'] == 7


async def test_course_template_resets_checklist_and_plan_template_refreshes_start_date(client, guest_headers, frozen_day):
    course = await create_task(client, guest_headers, name='Course', course_items=[{'name': 'Folder/'}, {'name': 'One'}, {'name': 'Two'}], daily_minimum=1, daily_goal=2, stages=[{'value': 1}])
    assert_mutation(await client.post(f"/api/tasks/{course['id']}/course", headers=guest_headers, json={'indices': [1], 'done': True}))
    row = await save(client, guest_headers, course, name='Course template')
    config = (await client.get(f"/api/templates/{row['id']}", headers=guest_headers)).json()['configuration']
    assert all(item['done'] is False and item['done_date'] is None and item['is_backfill'] is False for item in config['course_items'])
    cloned = assert_mutation(await client.post('/api/tasks', headers=guest_headers, json=config), 201)
    assert next(task for task in cloned['tasks'] if task['name'] == config['name'])['target'] == 2
    plan = await create_task(client, guest_headers, name='Plan', daily_plan=[2, 0, 3], plan_start_date=frozen_day['date'].isoformat(), stages=[{'value': 2}, {'value': 5}])
    row = await save(client, guest_headers, plan, name='Plan template')
    frozen_day['date'] += timedelta(days=5)
    config = (await client.get(f"/api/templates/{row['id']}", headers=guest_headers)).json()['configuration']
    assert config['plan_start_date'] == frozen_day['date'].isoformat()
    cloned = assert_mutation(await client.post('/api/tasks', headers=guest_headers, json=config), 201)
    fresh = next(task for task in cloned['tasks'] if task['name'] == config['name'])
    assert not fresh['is_done'] and not fresh['plan_expired'] and fresh['progress'] == 0


async def test_owner_isolation_rename_replace_delete_and_duplicate_names(client, guest_headers, other_guest_headers):
    task = await create_task(client, guest_headers, target=10)
    row = await save(client, guest_headers, task, name='Original')
    path = f"/api/templates/{row['id']}"
    for method, body in [('get', None), ('patch', {'name': 'Stolen'}), ('delete', None)]:
        response = await getattr(client, method)(path, headers=other_guest_headers, **({'json': body} if body else {}))
        assert response.status_code == 404
    assert custom(assert_mutation(await client.get('/api/templates', headers=other_guest_headers))) == []
    assert (await client.post('/api/templates', headers=other_guest_headers, json={'name': 'Cross owner', 'source_task_id': task['id']})).status_code == 404
    duplicate = await client.post('/api/templates', headers=guest_headers, json={'name': 'original', 'source_task_id': task['id']})
    assert duplicate.status_code == 409
    renamed = assert_mutation(await client.patch(path, headers=guest_headers, json={'name': 'Renamed'}))
    assert custom(renamed)[0]['name'] == 'Renamed'
    second = await create_task(client, guest_headers, name='Replacement', target=30, unit='分钟')
    replaced = assert_mutation(await client.patch(path, headers=guest_headers, json={'source_task_id': second['id']}))
    assert custom(replaced)[0]['target'] == 30 and custom(replaced)[0]['unit'] == '分钟'
    removed = assert_mutation(await client.delete(path, headers=guest_headers))
    assert custom(removed) == [] and len(removed['tasks']) == 2


async def test_limits_and_configuration_independence_after_source_deleted(client, guest_headers, monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, 'guest_template_limit', 1)
    source = await create_task(client, guest_headers)
    row = await save(client, guest_headers, source)
    assert (await client.post('/api/templates', headers=guest_headers, json={'name': 'Another', 'source_task_id': source['id']})).status_code == 403
    assert_mutation(await client.delete(f"/api/tasks/{source['id']}", headers=guest_headers))
    assert (await client.get(f"/api/templates/{row['id']}", headers=guest_headers)).status_code == 200


async def test_guest_registration_migrates_and_exports_saved_template(client, guest_headers):
    source = await create_task(client, guest_headers, target=5)
    row = await save(client, guest_headers, source)
    registered = assert_mutation(await client.post('/api/auth/register', headers=guest_headers, json={'username': 'template-user', 'password': 'Strong-test-password-100', 'migrate_guest': True}), 201)
    assert custom(registered)[0]['id'] == row['id']
    headers = {'Authorization': f"Bearer {registered['access_token']}"}
    exported = (await client.get('/api/profile/export', headers=headers)).json()
    assert exported['saved_templates'][0]['id'] == row['id']
    assert exported['saved_templates'][0]['configuration']['target'] == 5
    assert custom(assert_mutation(await client.get('/api/templates', headers=guest_headers))) == []


@pytest.mark.parametrize('body', [{}, {'name': ''}, {'name': None}, {'owner_id': 'guest:other'}, {'source_task_id': None}])
async def test_template_patch_rejects_empty_null_and_unknown_fields(client, guest_headers, body):
    task = await create_task(client, guest_headers)
    row = await save(client, guest_headers, task)
    assert (await client.patch(f"/api/templates/{row['id']}", headers=guest_headers, json=body)).status_code == 422


async def test_existing_account_merge_retains_both_same_named_templates(client, guest_headers):
    from conftest import register_user
    registered = await register_user(client, username='template-merge-user')
    account = {'Authorization': f"Bearer {registered['access_token']}"}
    original = await create_task(client, account, name='Original', target=10)
    await save(client, account, original, name='Shared name')
    guest = await create_task(client, guest_headers, name='Guest', target=20)
    guest_template = await save(client, guest_headers, guest, name='Shared name')
    merged = assert_mutation(await client.post('/api/auth/login', headers=guest_headers, json={'identifier': 'template-merge-user', 'password': 'correct-horse-73!', 'migrate_guest': True}))
    assert {row['name'] for row in custom(merged)} == {'Shared name', 'Shared name · 2'}
    assert {row['target'] for row in custom(merged)} == {10, 20}
    assert any(row['id'] == guest_template['id'] for row in custom(merged))


async def test_editing_legacy_task_preserves_unset_goal_and_can_clear_optional_goal(client, guest_headers):
    task = await create_task(client, guest_headers, target=20, daily_minimum=0, daily_goal=None)
    path = f"/api/tasks/{task['id']}"
    state = assert_mutation(await client.patch(path, headers=guest_headers, json={'daily_goal': None, 'stages': [{'value': 4}]}))
    edited = next(row for row in state['tasks'] if row['id'] == task['id'])
    assert edited['daily_goal'] is None and edited['stages'] == [{'value': 4, 'name': ''}]
    assert_mutation(await client.patch(path, headers=guest_headers, json={'daily_goal': 5}))
    state = assert_mutation(await client.patch(path, headers=guest_headers, json={'daily_goal': None}))
    assert next(row for row in state['tasks'] if row['id'] == task['id'])['daily_goal'] is None
