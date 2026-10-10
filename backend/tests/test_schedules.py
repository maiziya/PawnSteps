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


async def test_frequency_change_starts_tomorrow_and_survives_unrelated_edits(client, guest_headers, frozen_day):
    frozen_day['date'] = date(2026, 10, 5)
    task = await create_task(client, guest_headers, target=100, daily_minimum=2)
    await add_record(client, guest_headers, task['id'], 2)
    changed = assert_mutation(await client.patch(f"/api/tasks/{task['id']}", headers=guest_headers,
        json={'schedule': {'mode': 'weekdays', 'weekdays': [4]}}))
    row = changed['tasks'][0]
    assert row['schedule']['mode'] == 'daily' and row['is_scheduled_today']
    assert row['pending_schedule']['weekdays'] == [4]
    assert row['pending_schedule_date'] == '2026-10-06'
    renamed = assert_mutation(await client.patch(f"/api/tasks/{task['id']}", headers=guest_headers,
        json={'name': 'Renamed practice'}))
    assert renamed['tasks'][0]['pending_schedule'] == row['pending_schedule']
    assert renamed['stats']['today_completed'] == renamed['stats']['today_total'] == 1
    frozen_day['date'] += timedelta(days=1)
    next_day = await state(client, guest_headers)
    assert next_day['tasks'][0]['schedule']['weekdays'] == [4]
    assert next_day['tasks'][0]['pending_schedule'] is None
    assert not next_day['tasks'][0]['is_scheduled_today']
    assert next_day['stats']['streak'] == 1 and next_day['stats']['today_total'] == 0
    history = (await client.get('/api/history?week_of=2026-10-05', headers=guest_headers)).json()
    assert '2026-10-05' not in history['rest_dates']
    assert history['history'][0]['amount'] == 2


async def test_pending_frequency_can_be_replaced_or_cancelled(client, guest_headers, frozen_day):
    frozen_day['date'] = date(2026, 12, 31)
    task = await create_task(client, guest_headers, target=100, daily_minimum=1)
    for weekdays in [[0], [4]]:
        changed = assert_mutation(await client.patch(f"/api/tasks/{task['id']}", headers=guest_headers,
            json={'schedule': {'mode': 'weekdays', 'weekdays': weekdays}}))
        assert changed['tasks'][0]['pending_schedule']['weekdays'] == weekdays
        assert changed['tasks'][0]['pending_schedule_date'] == '2027-01-01'
    assert_mutation(await client.patch(f"/api/tasks/{task['id']}", headers=guest_headers,
        json={'schedule': {'mode': 'daily'}}))
    frozen_day['date'] += timedelta(days=1)
    assert (await state(client, guest_headers))['tasks'][0]['schedule']['mode'] == 'daily'


async def test_rest_day_work_does_not_inflate_today_obligations(client, guest_headers, frozen_day):
    frozen_day['date'] = date(2026, 10, 6)
    task = await create_task(client, guest_headers, target=100, daily_minimum=2,
        schedule={'mode': 'weekdays', 'weekdays': [0]})
    await create_task(client, guest_headers, 'Required today', target=100, daily_minimum=2)
    achieved = await add_record(client, guest_headers, task['id'], 2)
    assert achieved['stats']['today_total'] == 1 and achieved['stats']['today_completed'] == 0
    assert achieved['stats']['streak'] == 1
    history = (await client.get('/api/history?month=2026-10', headers=guest_headers)).json()
    assert '2026-10-06' not in history['rest_dates']
    assert history['history'][0]['completed']
    from uuid import uuid4
    corrected = assert_mutation(await client.post(f"/api/tasks/{task['id']}/decrement", headers=guest_headers,
        json={'request_id': str(uuid4())}))
    assert corrected['stats']['streak'] == 0
    assert not next(row for row in corrected['tasks'] if row['id'] == task['id'])['daily_done']


async def test_weekly_required_completion_counts_today_but_extra_day_does_not(client, guest_headers, frozen_day):
    frozen_day['date'] = date(2026, 10, 5)
    task = await create_task(client, guest_headers, target=100, daily_minimum=1,
        schedule={'mode': 'weekly', 'weekly_target': 1})
    achieved = await add_record(client, guest_headers, task['id'], 1)
    assert achieved['stats']['today_total'] == achieved['stats']['today_completed'] == 1
    frozen_day['date'] += timedelta(days=1)
    extra = await add_record(client, guest_headers, task['id'], 1)
    assert extra['tasks'][0]['weekly_completed'] == 2
    assert extra['stats']['today_total'] == extra['stats']['today_completed'] == 0
    assert extra['stats']['streak'] == 2


async def test_array_plan_rests_do_not_earn_streak_or_daily_completion(client, guest_headers, frozen_day):
    frozen_day['date'] = date(2026, 10, 5)
    task = await create_task(client, guest_headers, daily_plan=[1, 0, -1, 1], plan_start_date='2026-10-05')
    await add_record(client, guest_headers, task['id'], 1)
    frozen_day['date'] += timedelta(days=2)
    rest = await state(client, guest_headers)
    assert rest['stats']['streak'] == 1
    assert rest['stats']['today_completed'] == rest['stats']['today_total'] == 0
