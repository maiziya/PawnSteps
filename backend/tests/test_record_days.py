"""Day summaries preserve the ledger while pagination and corrections stay accurate."""

from datetime import timedelta
from uuid import UUID, uuid4

from conftest import add_record, assert_mutation, create_task


async def test_repeated_steps_are_one_day_and_retry_does_not_duplicate_amount(client, guest_headers, frozen_day):
    task = await create_task(client, guest_headers, target=100)
    request_id = str(uuid4())
    await add_record(client, guest_headers, task['id'], 1, request_id=request_id)
    await add_record(client, guest_headers, task['id'], 5)
    retry = await add_record(client, guest_headers, task['id'], 1, request_id=request_id)
    day = {'date': frozen_day['date'].isoformat(), 'amount': 6, 'record_count': 2}
    assert retry['record_day'] == day
    assert retry['record_day_count'] == 1
    response = await client.get(f"/api/tasks/{task['id']}/record-days", headers=guest_headers)
    assert response.status_code == 200
    assert response.json()['days'] == [day]
    assert response.json()['total'] == 1
    assert retry['tasks'][0]['progress'] == 6


async def test_summary_includes_all_records_even_when_detail_page_is_full(client, guest_headers, frozen_day):
    task = await create_task(client, guest_headers, target=100)
    for _ in range(53):
        await add_record(client, guest_headers, task['id'], 1)
    path = f"/api/tasks/{task['id']}"
    days = (await client.get(f'{path}/record-days', headers=guest_headers, params={'limit': 1})).json()
    assert days['total'] == 1
    assert days['days'][0]['amount'] == 53
    assert days['days'][0]['record_count'] == 53
    details = (await client.get(f'{path}/records', headers=guest_headers,
        params={'day': frozen_day['date'].isoformat(), 'offset': 50})).json()
    assert details['total'] == 53
    assert len(details['records']) == 3


async def test_days_page_independently_and_details_never_mix_dates(client, guest_headers, frozen_day):
    task = await create_task(client, guest_headers, target=100)
    oldest = frozen_day['date'].isoformat()
    await add_record(client, guest_headers, task['id'], 2)
    frozen_day['date'] += timedelta(days=1)
    middle = frozen_day['date'].isoformat()
    await add_record(client, guest_headers, task['id'], 3)
    frozen_day['date'] += timedelta(days=1)
    await add_record(client, guest_headers, task['id'], 4)
    path = f"/api/tasks/{task['id']}"
    first = (await client.get(f'{path}/record-days', headers=guest_headers, params={'limit': 2})).json()
    second = (await client.get(f'{path}/record-days', headers=guest_headers, params={'limit': 2, 'offset': 2})).json()
    assert first['total'] == second['total'] == 3
    assert [day['amount'] for day in first['days'] + second['days']] == [4, 3, 2]
    assert second['days'][0]['date'] == oldest
    details = (await client.get(f'{path}/records', headers=guest_headers, params={'day': middle})).json()
    assert details['total'] == 1
    assert details['records'][0]['amount'] == 3
    assert details['records'][0]['date'] == middle


async def test_edit_decrement_revoke_update_summary_and_remove_empty_day(client, guest_headers):
    task = await create_task(client, guest_headers, target=100)
    first = await add_record(client, guest_headers, task['id'], 2)
    second = await add_record(client, guest_headers, task['id'], 5)
    path = f"/api/tasks/{task['id']}"
    edited = assert_mutation(await client.patch(f"{path}/records/{second['record']['id']}",
        headers=guest_headers, json={'amount': 3}))
    assert edited['record_day']['amount'] == 5
    decrement = assert_mutation(await client.post(f'{path}/decrement', headers=guest_headers,
        json={'request_id': str(uuid4())}))
    assert decrement['record_day']['amount'] == 4
    revoked = assert_mutation(await client.delete(f"{path}/records/{second['record']['id']}", headers=guest_headers))
    assert revoked['record_day']['amount'] == 2
    assert revoked['record_day']['record_count'] == 1
    empty = assert_mutation(await client.delete(f"{path}/records/{first['record']['id']}", headers=guest_headers))
    assert empty['record_day']['amount'] == 0
    assert empty['record_day_count'] == 0
    assert empty['tasks'][0]['progress'] == 0
    assert (await client.get(f'{path}/record-days', headers=guest_headers)).json()['days'] == []


async def test_undated_legacy_is_separate_and_other_owners_cannot_read(client, guest_headers, other_guest_headers, session_factory):
    from app.models import ProgressRecord
    task = await create_task(client, guest_headers, target=100)
    await add_record(client, guest_headers, task['id'], 1)
    async with session_factory() as session:
        session.add_all([ProgressRecord(task_id=UUID(task['id']), amount=amount, note='', date=None, source='legacy') for amount in (2, 3)])
        await session.commit()
    path = f"/api/tasks/{task['id']}"
    response = (await client.get(f'{path}/record-days', headers=guest_headers)).json()
    assert response['total'] == 2
    assert response['days'][-1] == {'date': None, 'amount': 5, 'record_count': 2}
    details = (await client.get(f'{path}/records', headers=guest_headers, params={'undated': 'true'})).json()
    assert details['total'] == 2
    assert all(record['date'] is None for record in details['records'])
    for suffix in ('record-days', 'records?undated=true'):
        assert (await client.get(f'{path}/{suffix}', headers=other_guest_headers)).status_code == 404
