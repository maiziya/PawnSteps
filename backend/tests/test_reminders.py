from datetime import datetime, timedelta
from uuid import uuid4
from zoneinfo import ZoneInfo
import pytest
from conftest import add_record, assert_mutation, create_task


@pytest.fixture
def reminder_clock(monkeypatch, frozen_day):
    from app.services import reminders
    clock = {'hour': 10, 'minute': 0}
    monkeypatch.setattr(reminders, 'now', lambda: datetime.combine(frozen_day['date'], datetime.min.time(), tzinfo=ZoneInfo('Asia/Shanghai')).replace(hour=clock['hour'], minute=clock['minute']))
    return clock


async def claim(client, headers, device):
    return assert_mutation(await client.post('/api/reminders/claim', headers=headers, json={'device_id': device}))


async def test_reminder_is_due_at_ten_in_application_timezone_only(client, guest_headers, reminder_clock):
    await create_task(client, guest_headers)
    device = str(uuid4())
    for hour in (9, 11, 23):
        reminder_clock['hour'] = hour
        config = (await client.get('/api/reminders', headers=guest_headers)).json()
        assert config['due'] is False and config['time'] == '10:00' and config['timezone'] == 'Asia/Shanghai'
        assert (await claim(client, guest_headers, device))['reminder']['claimed'] is False
    reminder_clock['hour'] = 10
    assert (await claim(client, guest_headers, device))['reminder']['claimed'] is True


async def test_claim_ack_and_repeat_are_isolated_by_owner_device_and_day(client, guest_headers, other_guest_headers, reminder_clock, frozen_day):
    await create_task(client, guest_headers, name='Reading')
    await create_task(client, other_guest_headers, name='Exercise')
    device = str(uuid4())
    first = (await claim(client, guest_headers, device))['reminder']
    assert first['claimed'] and first['task_count'] == 1 and 'Reading' in first['body']
    assert (await claim(client, guest_headers, device))['reminder']['claimed'] is False
    body = {'device_id': device, 'date': first['date'], 'token': first['token']}
    assert (await client.post('/api/reminders/ack', headers=other_guest_headers, json=body)).status_code == 409
    assert_mutation(await client.post('/api/reminders/ack', headers=guest_headers, json=body))
    assert_mutation(await client.post('/api/reminders/release', headers=guest_headers, json=body))
    assert (await claim(client, guest_headers, device))['reminder']['claimed'] is False
    assert (await claim(client, guest_headers, str(uuid4())))['reminder']['claimed'] is True
    assert (await claim(client, other_guest_headers, device))['reminder']['claimed'] is True
    frozen_day['date'] += timedelta(days=1)
    assert (await claim(client, guest_headers, device))['reminder']['claimed'] is True


async def test_failed_delivery_releases_lease_and_stale_token_cannot_ack(client, guest_headers, reminder_clock):
    await create_task(client, guest_headers)
    device = str(uuid4())
    first = (await claim(client, guest_headers, device))['reminder']
    body = {'device_id': device, 'date': first['date'], 'token': first['token']}
    assert_mutation(await client.post('/api/reminders/release', headers=guest_headers, json=body))
    second = (await claim(client, guest_headers, device))['reminder']
    assert second['claimed'] and second['token'] != first['token']
    assert (await client.post('/api/reminders/ack', headers=guest_headers, json=body)).status_code == 409
    reminder_clock['minute'] = 2
    assert (await claim(client, guest_headers, device))['reminder']['claimed'] is True


async def test_completed_qualified_archived_rest_and_future_tasks_do_not_remind(client, guest_headers, reminder_clock, frozen_day):
    completed = await create_task(client, guest_headers, name='Completed', target=1)
    await add_record(client, guest_headers, completed['id'], 1)
    qualified = await create_task(client, guest_headers, name='Qualified', target=10, daily_minimum=1)
    await add_record(client, guest_headers, qualified['id'], 1)
    archived = await create_task(client, guest_headers, name='Archived')
    assert_mutation(await client.post(f"/api/tasks/{archived['id']}/archive", headers=guest_headers))
    await create_task(client, guest_headers, name='Rest', daily_plan=[0, 2], plan_start_date=frozen_day['date'].isoformat())
    await create_task(client, guest_headers, name='Future', daily_plan=[2, 2], plan_start_date=(frozen_day['date'] + timedelta(days=1)).isoformat())
    result = (await claim(client, guest_headers, str(uuid4())))['reminder']
    assert result['claimed'] is False and result['task_count'] == 0 and result['token'] is None


async def test_today_plan_is_prioritized_and_titles_stay_bounded(client, guest_headers, reminder_clock, frozen_day):
    await create_task(client, guest_headers, name='普通任务')
    selected = await create_task(client, guest_headers, name='重要任务' * 20)
    assert_mutation(await client.put('/api/day-plan', headers=guest_headers, json={'date': frozen_day['date'].isoformat(), 'task_ids': [selected['id']]}))
    result = (await claim(client, guest_headers, str(uuid4())))['reminder']
    assert result['claimed'] and result['task_count'] == 2 and result['url'] == '/#today'
    assert result['body'].index('重要任务') < result['body'].index('普通任务')
    assert len(result['body']) < 150


async def test_reminder_validation_and_auth(client, guest_headers, reminder_clock):
    assert (await client.get('/api/reminders')).status_code == 401
    assert (await client.post('/api/reminders/claim', headers=guest_headers, json={'device_id': 'invalid'})).status_code == 422
    assert (await client.post('/api/reminders/claim', headers=guest_headers, json={'device_id': str(uuid4()), 'owner_id': 'guest:someone'})).status_code == 422


async def test_parallel_tabs_share_one_delivery_claim(client, guest_headers, reminder_clock):
    import asyncio
    await create_task(client, guest_headers)
    device = str(uuid4())
    responses = await asyncio.gather(*(claim(client, guest_headers, device) for _ in range(4)))
    assert sum(response['reminder']['claimed'] for response in responses) == 1


async def test_completed_today_plan_does_not_hide_remaining_unplanned_tasks(client, guest_headers, reminder_clock, frozen_day):
    planned = await create_task(client, guest_headers, name='Finished plan', target=1)
    await create_task(client, guest_headers, name='Remaining task')
    assert_mutation(await client.put('/api/day-plan', headers=guest_headers, json={'date': frozen_day['date'].isoformat(), 'task_ids': [planned['id']]}))
    await add_record(client, guest_headers, planned['id'], 1)
    result = (await claim(client, guest_headers, str(uuid4())))['reminder']
    assert result['claimed'] and result['task_count'] == 1 and result['url'] == '/#tasks'
    assert 'Remaining task' in result['body'] and 'Finished plan' not in result['body']
