"""Decrements adjust one owned record and remain safe across request retries."""
import asyncio
from datetime import timedelta
from uuid import UUID, uuid4

import pytest
from sqlalchemy import func, select

from conftest import add_record, assert_mutation, create_task


async def decrement(client, headers, task_id, request_id=None):
    return assert_mutation(await client.post(
        f'/api/tasks/{task_id}/decrement', headers=headers,
        json={'request_id': request_id or str(uuid4())},
    ))


async def test_decrement_uses_latest_work_date_and_preserves_record_metadata(client, guest_headers, frozen_day):
    task = await create_task(client, guest_headers, target=20)
    older = (await add_record(client, guest_headers, task['id'], 3, 'Yesterday'))['record']
    frozen_day['date'] += timedelta(days=1)
    creation_id = str(uuid4())
    newer = (await add_record(client, guest_headers, task['id'], 2, 'Today', request_id=creation_id))['record']
    await client.patch(f"/api/tasks/{task['id']}/records/{older['id']}", headers=guest_headers, json={'note': 'Edited later'})
    state = await decrement(client, guest_headers, task['id'])
    assert state['record']['id'] == newer['id']
    assert state['record']['amount'] == 1
    assert state['record']['date'] == newer['date']
    assert state['record']['note'] == 'Today'
    assert state['record']['request_id'] == creation_id
    assert state['record']['source'] == 'manual'
    assert state['tasks'][0]['progress'] == 4
    assert state['tasks'][0]['today_amount'] == 1
    assert state['tasks'][0]['record_count'] == 2
    replay = await add_record(client, guest_headers, task['id'], 2, 'Today', request_id=creation_id)
    assert replay['record']['amount'] == 1
    assert replay['tasks'][0]['progress'] == 4


async def test_decrement_one_soft_revokes_and_retry_after_zero_does_not_repeat(client, guest_headers, session_factory):
    from app.models import ProgressAdjustment

    task = await create_task(client, guest_headers)
    record = (await add_record(client, guest_headers, task['id'], 1))['record']
    request_id = str(uuid4())
    first = await decrement(client, guest_headers, task['id'], request_id)
    assert first['record']['id'] == record['id']
    assert first['record']['amount'] == 1
    assert first['record']['deleted_at']
    assert first['tasks'][0]['progress'] == 0
    assert first['tasks'][0]['record_count'] == 0
    retry = await decrement(client, guest_headers, task['id'], request_id)
    assert retry['record'] == first['record']
    empty = await client.post(f"/api/tasks/{task['id']}/decrement", headers=guest_headers,
                              json={'request_id': str(uuid4())})
    assert empty.status_code == 409
    async with session_factory() as session:
        assert await session.scalar(select(func.count()).select_from(ProgressAdjustment)) == 1


async def test_completed_ordinary_decrements_actual_overshoot_before_reopening(client, guest_headers):
    task = await create_task(client, guest_headers, target=3)
    await add_record(client, guest_headers, task['id'], 5)
    for expected in [4, 3]:
        state = await decrement(client, guest_headers, task['id'])
        assert state['record']['amount'] == expected
        assert state['tasks'][0]['progress'] == 3
        assert state['tasks'][0]['today_amount'] == expected
        assert state['tasks'][0]['is_done'] is True
    reopened = await decrement(client, guest_headers, task['id'])
    assert reopened['tasks'][0]['progress'] == 2
    assert reopened['tasks'][0]['is_done'] is False
    assert reopened['tasks'][0]['done_at'] is None
    assert reopened['stats']['xp'] == 0


async def test_daily_decrement_only_changes_today_and_recomputes_threshold_streak(client, guest_headers, frozen_day):
    task = await create_task(client, guest_headers, target=2, daily_quota=2)
    previous = (await add_record(client, guest_headers, task['id'], 2))['record']
    frozen_day['date'] += timedelta(days=1)
    current = (await add_record(client, guest_headers, task['id'], 2))['record']
    state = await decrement(client, guest_headers, task['id'])
    assert state['record']['id'] == current['id']
    assert state['record']['amount'] == 1
    assert state['tasks'][0]['progress'] == 1
    assert state['tasks'][0]['today_amount'] == 1
    assert state['tasks'][0]['daily_done'] is False
    assert state['stats']['streak'] == 0
    assert state['stats']['xp'] == 0
    rows = (await client.get(f"/api/tasks/{task['id']}/records", headers=guest_headers)).json()['records']
    assert next(row for row in rows if row['id'] == previous['id'])['amount'] == 2


async def test_daily_decrement_never_reaches_yesterday_when_today_is_empty(client, guest_headers, frozen_day):
    task = await create_task(client, guest_headers, target=3, daily_quota=2)
    yesterday = (await add_record(client, guest_headers, task['id'], 2))['record']
    frozen_day['date'] += timedelta(days=1)
    response = await client.post(f"/api/tasks/{task['id']}/decrement", headers=guest_headers,
                                 json={'request_id': str(uuid4())})
    assert response.status_code == 409
    state = assert_mutation(await client.get('/api/state', headers=guest_headers))
    assert state['tasks'][0]['progress'] == 1
    assert state['tasks'][0]['today_amount'] == 0
    rows = (await client.get(f"/api/tasks/{task['id']}/records", headers=guest_headers)).json()['records']
    assert rows == [yesterday]


@pytest.mark.parametrize('offset', [1, 2, 3])
async def test_plan_decrement_rejects_rest_or_expiry_but_replays_prior_receipt(client, guest_headers, frozen_day, offset):
    task = await create_task(client, guest_headers, daily_plan=[2, 0, -1],
                             plan_start_date=frozen_day['date'].isoformat())
    await add_record(client, guest_headers, task['id'], 2)
    request_id = str(uuid4())
    first = await decrement(client, guest_headers, task['id'], request_id)
    frozen_day['date'] += timedelta(days=offset)
    response = await client.post(f"/api/tasks/{task['id']}/decrement", headers=guest_headers,
                                 json={'request_id': str(uuid4())})
    assert response.status_code == 409
    retry = await decrement(client, guest_headers, task['id'], request_id)
    assert retry['record'] == first['record']
    assert retry['tasks'][0]['progress'] == 1


async def test_decrement_validation_course_future_plan_and_owner_isolation(client, guest_headers, other_guest_headers, frozen_day):
    task = await create_task(client, guest_headers)
    await add_record(client, guest_headers, task['id'], 1)
    path = f"/api/tasks/{task['id']}/decrement"
    for body in [{}, {'request_id': None}, {'request_id': 'invalid'}, {'request_id': str(uuid4()), 'amount': 2}]:
        assert (await client.post(path, headers=guest_headers, json=body)).status_code == 422
    assert (await client.post(path, headers=other_guest_headers, json={'request_id': str(uuid4())})).status_code == 404
    course = await create_task(client, guest_headers, name='Course', course_items=[{'name': 'One', 'done': False}])
    assert (await client.post(f"/api/tasks/{course['id']}/decrement", headers=guest_headers,
                              json={'request_id': str(uuid4())})).status_code == 422
    future = await create_task(client, guest_headers, name='Future', daily_plan=[2],
                               plan_start_date=(frozen_day['date'] + timedelta(days=1)).isoformat())
    assert (await client.post(f"/api/tasks/{future['id']}/decrement", headers=guest_headers,
                              json={'request_id': str(uuid4())})).status_code == 409


async def test_create_and_decrement_request_ids_cannot_collide(client, guest_headers):
    task = await create_task(client, guest_headers, target=20)
    creation_id = str(uuid4())
    await add_record(client, guest_headers, task['id'], 3, request_id=creation_id)
    conflict = await client.post(f"/api/tasks/{task['id']}/decrement", headers=guest_headers,
                                 json={'request_id': creation_id})
    assert conflict.status_code == 409
    adjustment_id = str(uuid4())
    await decrement(client, guest_headers, task['id'], adjustment_id)
    conflict = await client.post(f"/api/tasks/{task['id']}/records", headers=guest_headers,
                                 json={'amount': 1, 'request_id': adjustment_id})
    assert conflict.status_code == 409
    state = assert_mutation(await client.get('/api/state', headers=guest_headers))
    assert state['tasks'][0]['progress'] == 2


async def test_decrement_replay_returns_latest_record_after_edit_and_revoke(client, guest_headers):
    task = await create_task(client, guest_headers, target=20)
    record = (await add_record(client, guest_headers, task['id'], 3))['record']
    request_id = str(uuid4())
    await decrement(client, guest_headers, task['id'], request_id)
    path = f"/api/tasks/{task['id']}/records/{record['id']}"
    await client.patch(path, headers=guest_headers, json={'amount': 6, 'note': 'Adjusted later'})
    retry = await decrement(client, guest_headers, task['id'], request_id)
    assert retry['record']['amount'] == 6
    assert retry['tasks'][0]['progress'] == 6
    await client.delete(path, headers=guest_headers)
    retry = await decrement(client, guest_headers, task['id'], request_id)
    assert retry['record']['deleted_at']
    assert retry['tasks'][0]['progress'] == 0


async def test_decrement_uses_unknown_date_legacy_baseline_after_dated_records(client, guest_headers, session_factory):
    from app.models import ProgressRecord

    task = await create_task(client, guest_headers, target=20)
    legacy_id = uuid4()
    async with session_factory() as session:
        session.add(ProgressRecord(id=legacy_id, task_id=UUID(task['id']), amount=4,
                                   note='Unknown date', date=None, source='legacy'))
        await session.commit()
    current = (await add_record(client, guest_headers, task['id'], 1))['record']
    first = await decrement(client, guest_headers, task['id'])
    assert first['record']['id'] == current['id']
    assert first['record']['deleted_at']
    second = await decrement(client, guest_headers, task['id'])
    assert second['record']['id'] == str(legacy_id)
    assert second['record']['date'] is None
    assert second['record']['source'] == 'legacy'
    assert second['record']['note'] == 'Unknown date'
    assert second['record']['amount'] == 3
    assert second['tasks'][0]['today_amount'] == 0
    assert second['tasks'][0]['progress'] == 3


async def test_task_undo_preserves_receipt_and_expired_deletion_cascades(client, guest_headers, session_factory, monkeypatch):
    from app.models import ProgressAdjustment, ProgressRecord, Task
    from app.services import tracker

    task = await create_task(client, guest_headers)
    await add_record(client, guest_headers, task['id'], 2)
    request_id = str(uuid4())
    await decrement(client, guest_headers, task['id'], request_id)
    removed = assert_mutation(await client.delete(f"/api/tasks/{task['id']}", headers=guest_headers))
    assert_mutation(await client.post('/api/tasks/undo', headers=guest_headers, json={'token': removed['undo_token']}))
    retry = await decrement(client, guest_headers, task['id'], request_id)
    assert retry['tasks'][0]['progress'] == 1
    await client.delete(f"/api/tasks/{task['id']}", headers=guest_headers)
    later = tracker.utcnow() + timedelta(seconds=6)
    monkeypatch.setattr(tracker, 'utcnow', lambda: later)
    assert_mutation(await client.get('/api/state', headers=guest_headers))
    async with session_factory() as session:
        for model in (Task, ProgressRecord, ProgressAdjustment):
            assert await session.scalar(select(func.count()).select_from(model)) == 0


async def test_parallel_decrements_are_serialized_and_retries_apply_once(client, guest_headers, session_factory):
    from app.models import ProgressAdjustment

    if session_factory.kw['bind'].dialect.name != 'postgresql':
        pytest.skip('Parallel transaction checks require disposable PostgreSQL')
    task = await create_task(client, guest_headers, target=20)
    await add_record(client, guest_headers, task['id'], 10)
    request_id = str(uuid4())
    repeated = await asyncio.gather(*[decrement(client, guest_headers, task['id'], request_id) for _ in range(8)])
    assert all(state['tasks'][0]['progress'] == 9 for state in repeated)
    await asyncio.gather(*[decrement(client, guest_headers, task['id']) for _ in range(8)])
    state = assert_mutation(await client.get('/api/state', headers=guest_headers))
    assert state['tasks'][0]['progress'] == 1
    assert state['tasks'][0]['record_count'] == 1
    async with session_factory() as session:
        assert await session.scalar(select(func.count()).select_from(ProgressAdjustment)) == 9
