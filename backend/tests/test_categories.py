from conftest import add_record, assert_mutation, create_task


async def category(client, headers, name='Learning'):
    state = assert_mutation(await client.post('/api/categories', headers=headers, json={'name': name, 'color': 'sage'}), 201)
    return next(row for row in state['categories'] if row['name'] == name)


async def test_classification_crud_preserves_records_and_archives(client, guest_headers):
    group = await category(client, guest_headers)
    task = await create_task(client, guest_headers, target=10, category_id=group['id'])
    await add_record(client, guest_headers, task['id'], 3)
    renamed = assert_mutation(await client.patch(f"/api/categories/{group['id']}", headers=guest_headers, json={'name': 'Study', 'color': 'clay'}))
    assert renamed['categories'][0]['name'] == 'Study'
    assert renamed['tasks'][0]['progress'] == 3
    assert_mutation(await client.post(f"/api/tasks/{task['id']}/archive", headers=guest_headers))
    cleared = assert_mutation(await client.delete(f"/api/categories/{group['id']}", headers=guest_headers))
    assert cleared['categories'] == []
    assert cleared['archived_tasks'][0]['category_id'] is None
    restored = assert_mutation(await client.post(f"/api/tasks/{task['id']}/restore", headers=guest_headers))
    assert restored['tasks'][0]['progress'] == 3
    assert restored['tasks'][0]['record_count'] == 1


async def test_categories_are_owner_scoped_and_assignments_validate_owner(client, guest_headers, other_guest_headers):
    group = await category(client, guest_headers)
    other = await create_task(client, other_guest_headers)
    for method in ('patch', 'delete'):
        kwargs = {'json': {'name': 'Changed'}} if method == 'patch' else {}
        assert (await getattr(client, method)(f"/api/categories/{group['id']}", headers=other_guest_headers, **kwargs)).status_code == 404
    assert (await client.put(f"/api/tasks/{other['id']}/category", headers=other_guest_headers, json={'category_id': group['id']})).status_code == 404
    assert (await client.post('/api/tasks', headers=other_guest_headers, json={'name': 'Blocked', 'category_id': group['id']})).status_code == 404
    assert (await client.get('/api/state', headers=other_guest_headers)).json()['categories'] == []
    assigned = assert_mutation(await client.put(f"/api/tasks/{other['id']}/category", headers=other_guest_headers, json={'category_id': None}))
    assert assigned['tasks'][0]['category_id'] is None


async def test_duplicate_names_validation_and_order(client, guest_headers):
    first = await category(client, guest_headers)
    second = await category(client, guest_headers, 'Work')
    assert (await client.post('/api/categories', headers=guest_headers, json={'name': ' learning '})).status_code == 409
    for body in ({'name': ' '}, {'name': 'x' * 21}, {'name': 'Test', 'color': '#ffffff'}):
        assert (await client.post('/api/categories', headers=guest_headers, json=body)).status_code == 422
    assert (await client.patch(f"/api/categories/{first['id']}", headers=guest_headers, json={'color': None})).status_code == 422
    order = assert_mutation(await client.post('/api/categories/reorder', headers=guest_headers, json={'ids': [second['id'], first['id']]}))
    assert [row['id'] for row in order['categories']] == [second['id'], first['id']]
    assert (await client.post('/api/categories/reorder', headers=guest_headers, json={'ids': [first['id']]})).status_code == 422


async def test_guest_categories_merge_on_login_and_export(client, guest_headers, other_guest_headers):
    await category(client, guest_headers, 'Learning')
    registered = await client.post('/api/auth/register', headers=guest_headers, json={'username': 'category-owner', 'password': 'a-safe-test-password'})
    assert registered.status_code == 201, registered.text
    token = registered.json()['access_token']
    group = await category(client, other_guest_headers, 'learning')
    task = await create_task(client, other_guest_headers, category_id=group['id'])
    logged = await client.post('/api/auth/login', headers=other_guest_headers, json={'identifier': 'category-owner', 'password': 'a-safe-test-password'})
    assert logged.status_code == 200, logged.text
    state = logged.json()
    assert len(state['categories']) == 1
    assert state['tasks'][0]['id'] == task['id']
    assert state['tasks'][0]['category_id'] == state['categories'][0]['id']
    exported = await client.get('/api/profile/export', headers={'Authorization': f'Bearer {token}'})
    assert exported.status_code == 200
    assert exported.json()['categories'] == state['categories']
