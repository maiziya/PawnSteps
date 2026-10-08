"""Flexible schedules preserve actual check-ins and distinguish rest from missed work."""
from datetime import date, timedelta

from conftest import add_record, assert_mutation, create_task


async def state(client, headers):
    return assert_mutation(await client.get('/api/state', headers=headers))


async def test_weekday_rests_preserve_streak_without_fabricating_checkins(client, guest_headers, frozen_day):
    frozen_day['date'] = date(2026, 10, 5)
    task = await create_task(client, guest_headers, target=100, daily_minimum=1,
                             schedule={'mode': 'weekdays', 'weekdays': [0, 2, 4]})
    await add_record(client, guest_headers, task['id'], 1)
    frozen_day['date'] += timedelta(days=1)
    rest = await state(client, guest_headers)
    assert not rest['tasks'][0]['is_scheduled_today']
    assert rest['stats']['streak'] == 1 and rest['stats']['today_total'] == 0
    assert not rest['tasks'][0]['daily_done'] and rest['tasks'][0]['today_amount'] == 0
    frozen_day['date'] += timedelta(days=1)
    assert (await state(client, guest_headers))['stats']['streak'] == 0
    assert (await add_record(client, guest_headers, task['id'], 1))['stats']['streak'] == 2
    frozen_day['date'] += timedelta(days=2)
    reached = await add_record(client, guest_headers, task['id'], 1)
    assert reached['stats']['streak'] == 3
    assert next(reward for reward in reached['rewards'] if reward['streak_target'] == 3)['is_unlocked']
    history = (await client.get('/api/history?month=2026-10', headers=guest_headers)).json()
    assert '2026-10-06' in history['rest_dates'] and '2026-10-08' in history['rest_dates']
    assert all(entry['date'] != '2026-10-06' for entry in history['history'])


async def test_extra_work_on_a_rest_day_can_qualify(client, guest_headers, frozen_day):
    frozen_day['date'] = date(2026, 10, 5)
    task = await create_task(client, guest_headers, daily_quota=2, target=10,
                             schedule={'mode': 'weekdays', 'weekdays': [0]})
    await add_record(client, guest_headers, task['id'], 2)
    frozen_day['date'] += timedelta(days=1)
    partial = await add_record(client, guest_headers, task['id'], 1)
    assert not partial['tasks'][0]['daily_done'] and partial['stats']['streak'] == 1
    achieved = await add_record(client, guest_headers, task['id'], 1)
    assert achieved['stats']['streak'] == 2 and achieved['tasks'][0]['progress'] == 2


async def test_weekly_targets_count_days_and_reset_on_monday(client, guest_headers, frozen_day):
    frozen_day['date'] = date(2026, 10, 5)
    task = await create_task(client, guest_headers, target=100, daily_minimum=1,
                             schedule={'mode': 'weekly', 'weekly_target': 3})
    await add_record(client, guest_headers, task['id'], 1)
    await add_record(client, guest_headers, task['id'], 5)
    assert (await state(client, guest_headers))['tasks'][0]['weekly_completed'] == 1
    frozen_day['date'] += timedelta(days=2)
    await add_record(client, guest_headers, task['id'], 1)
    frozen_day['date'] += timedelta(days=2)
    achieved = await add_record(client, guest_headers, task['id'], 1)
    assert achieved['tasks'][0]['weekly_completed'] == achieved['tasks'][0]['weekly_target'] == 3
    assert achieved['stats']['streak'] == 3
    frozen_day['date'] += timedelta(days=1)
    rest = await state(client, guest_headers)
    assert not rest['tasks'][0]['is_scheduled_today'] and rest['stats']['streak'] == 3
    frozen_day['date'] += timedelta(days=2)
    reset = await state(client, guest_headers)
    assert reset['tasks'][0]['weekly_completed'] == 0 and reset['tasks'][0]['weekly_target'] == 3
    assert reset['tasks'][0]['is_scheduled_today'] and reset['stats']['streak'] == 3


async def test_a_missed_week_breaks_streak_at_its_deadline(client, guest_headers, frozen_day):
    frozen_day['date'] = date(2026, 10, 5)
    task = await create_task(client, guest_headers, target=100, daily_minimum=1,
                             schedule={'mode': 'weekly', 'weekly_target': 3})
    await add_record(client, guest_headers, task['id'], 1)
    frozen_day['date'] = date(2026, 10, 10)
    assert (await state(client, guest_headers))['stats']['streak'] == 1
    frozen_day['date'] += timedelta(days=1)
    assert (await state(client, guest_headers))['stats']['streak'] == 0
    frozen_day['date'] += timedelta(days=1)
    assert (await state(client, guest_headers))['stats']['streak'] == 0


async def test_first_short_week_uses_remaining_days(client, guest_headers, frozen_day):
    frozen_day['date'] = date(2026, 10, 10)
    task = await create_task(client, guest_headers, target=100, daily_minimum=1,
                             schedule={'mode': 'weekly', 'weekly_target': 5})
    assert task['weekly_target'] == 2
    await add_record(client, guest_headers, task['id'], 1)
    frozen_day['date'] += timedelta(days=1)
    assert (await add_record(client, guest_headers, task['id'], 1))['stats']['streak'] == 2
    frozen_day['date'] += timedelta(days=1)
    assert (await state(client, guest_headers))['tasks'][0]['weekly_target'] == 5


async def test_schedule_edits_do_not_reinterpret_old_rest_days(client, guest_headers, frozen_day):
    frozen_day['date'] = date(2026, 10, 5)
    task = await create_task(client, guest_headers, target=100, daily_minimum=1,
                             schedule={'mode': 'weekdays', 'weekdays': [0]})
    await add_record(client, guest_headers, task['id'], 1)
    frozen_day['date'] += timedelta(days=2)
    response = await client.patch(f"/api/tasks/{task['id']}", headers=guest_headers, json={'schedule': {'mode': 'daily'}})
    assert_mutation(response)
    achieved = await add_record(client, guest_headers, task['id'], 1)
    assert achieved['stats']['streak'] == 2


async def test_completed_tasks_do_not_turn_other_tasks_rest_days_into_misses(client, guest_headers, frozen_day):
    frozen_day['date'] = date(2026, 10, 5)
    one = await create_task(client, guest_headers, 'Finish once', target=1, daily_minimum=1)
    recurring = await create_task(client, guest_headers, 'Monday practice', target=10, daily_quota=1,
                                  schedule={'mode': 'weekdays', 'weekdays': [0]})
    await add_record(client, guest_headers, one['id'], 1)
    await add_record(client, guest_headers, recurring['id'], 1)
    frozen_day['date'] += timedelta(days=1)
    assert (await state(client, guest_headers))['stats']['streak'] == 1


async def test_schedule_validation_and_owner_isolation(client, guest_headers, other_guest_headers):
    for schedule in [{'mode': 'weekdays'}, {'mode': 'weekdays', 'weekdays': [0, 0]},
                     {'mode': 'weekdays', 'weekdays': [7]}, {'mode': 'weekly'},
                     {'mode': 'weekly', 'weekly_target': 8}, {'mode': 'daily', 'weekdays': [1]}]:
        response = await client.post('/api/tasks', headers=guest_headers,
                                     json={'name': 'Invalid', 'daily_minimum': 1, 'schedule': schedule})
        assert response.status_code == 422
    task = await create_task(client, guest_headers, target=10, daily_minimum=1)
    response = await client.patch(f"/api/tasks/{task['id']}", headers=other_guest_headers,
                                  json={'schedule': {'mode': 'weekdays', 'weekdays': [1]}})
    assert response.status_code == 404
