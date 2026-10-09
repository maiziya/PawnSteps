"""Weekly calendar bounds preserve dated work and existing rest-day projections."""

from datetime import date, timedelta
from uuid import UUID

import pytest

from conftest import add_record, assert_mutation, create_task


async def history(client, headers, **params):
    response = await client.get('/api/history', headers=headers, params=params)
    assert response.status_code == 200, response.text
    payload = response.json()
    assert set(payload) == {'history', 'rest_dates', 'streak'}
    return payload


async def test_week_contains_seven_days_across_months_and_excludes_neighboring_days(
    client, guest_headers, frozen_day
):
    monday = date(2026, 9, 28)
    frozen_day['date'] = monday - timedelta(days=1)
    task = await create_task(client, guest_headers, target=100, unit='页')
    for offset in range(-1, 8):
        frozen_day['date'] = monday + timedelta(days=offset)
        await add_record(client, guest_headers, task['id'], offset + 2)
    result = await history(client, guest_headers, week_of='2026-10-01')
    expected = {(monday + timedelta(days=offset)).isoformat(): offset + 2 for offset in range(7)}
    assert {row['date']: row['amount'] for row in result['history']} == expected
    assert [row['date'] for row in result['history']] == sorted(expected, reverse=True)
    assert all(row['task_id'] == task['id'] and row['unit'] == '页' for row in result['history'])
    assert result['rest_dates'] == []
    assert await history(client, guest_headers, week_of='2026-09-28') == result
    assert await history(client, guest_headers, week_of='2026-10-04') == result

    # Existing month and unscoped requests retain their original bounds.
    september = await history(client, guest_headers, month='2026-09')
    assert {row['date'] for row in september['history']} == {
        '2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30',
    }
    assert len((await history(client, guest_headers))['history']) == 9


async def test_crossyear_week_retains_explicit_plan_rest_and_partial_work(
    client, guest_headers, frozen_day
):
    frozen_day['date'] = date(2025, 12, 28)
    task = await create_task(client, guest_headers, daily_plan=[5, 0, 5, -1, 5, 0, 5, 5, 5],
                             plan_start_date='2025-12-28', unit='个')
    for day, amount in [('2025-12-28', 5), ('2025-12-30', 5), ('2026-01-01', 2),
                        ('2026-01-04', 5), ('2026-01-05', 5)]:
        frozen_day['date'] = date.fromisoformat(day)
        await add_record(client, guest_headers, task['id'], amount)
    result = await history(client, guest_headers, week_of='2026-01-01')
    assert result['rest_dates'] == ['2025-12-29', '2025-12-31', '2026-01-02']
    rows = {row['date']: row for row in result['history']}
    assert set(rows) == {'2025-12-29', '2025-12-30', '2025-12-31',
                         '2026-01-01', '2026-01-02', '2026-01-04'}
    for day in result['rest_dates']:
        assert rows[day]['amount'] == rows[day]['quota'] == 0
        assert rows[day]['completed']
    assert rows['2025-12-30']['amount'] == rows['2025-12-30']['quota'] == 5
    assert rows['2025-12-30']['completed']
    assert rows['2026-01-01']['amount'] == 2 and rows['2026-01-01']['quota'] == 5
    assert not rows['2026-01-01']['completed']
    assert all(row['task_kind'] == 'plan' and row['unit'] == '个' for row in rows.values())


async def test_week_preserves_minimum_statuses_course_dates_and_owner_isolation(
    client, guest_headers, other_guest_headers, frozen_day
):
    monday = date(2026, 9, 28)
    frozen_day['date'] = monday
    reading = await create_task(client, guest_headers, 'Reading', target=100,
                                daily_minimum=5, unit='页')
    records = []
    for offset, amount in enumerate([1, 5, 7]):
        frozen_day['date'] = monday + timedelta(days=offset)
        records.append((await add_record(client, guest_headers, reading['id'], amount))['record'])
    course = await create_task(client, guest_headers, 'Course', daily_minimum=1,
                               course_items=[{'name': 'Chapter/'}, {'name': 'One'}, {'name': 'Two'}])
    frozen_day['date'] = monday + timedelta(days=3)
    assert_mutation(await client.post(f"/api/tasks/{course['id']}/course", headers=guest_headers,
                                      json={'indices': [0, 1], 'done': True}))
    private = await create_task(client, other_guest_headers, 'Private', target=100, daily_minimum=1)
    await add_record(client, other_guest_headers, private['id'], 20)
    deleted = await create_task(client, guest_headers, 'Deleted', target=100, daily_minimum=1)
    await add_record(client, guest_headers, deleted['id'], 3)
    assert_mutation(await client.delete(f"/api/tasks/{deleted['id']}", headers=guest_headers))

    result = await history(client, guest_headers, week_of='2026-10-01')
    reading_rows = sorted((row for row in result['history'] if row['task_id'] == reading['id']),
                          key=lambda row: row['date'])
    assert [(row['amount'], row['quota'], row['completed']) for row in reading_rows] == [
        (1, 5, False), (5, 5, True), (7, 5, True),
    ]
    course_row = next(row for row in result['history'] if row['task_id'] == course['id'])
    assert course_row['date'] == '2026-10-01'
    assert (course_row['amount'], course_row['quota'], course_row['completed']) == (1, 1, True)
    assert course_row['task_kind'] == 'course' and course_row['unit'] == '节'
    assert {row['task_id'] for row in result['history']} == {reading['id'], course['id']}
    other = await history(client, other_guest_headers, week_of='2026-10-01')
    assert {row['task_id'] for row in other['history']} == {private['id']}

    assert_mutation(await client.patch(f"/api/tasks/{reading['id']}/records/{records[2]['id']}",
                                      headers=guest_headers, json={'amount': 4}))
    assert_mutation(await client.delete(f"/api/tasks/{reading['id']}/records/{records[0]['id']}",
                                       headers=guest_headers))
    corrected = await history(client, guest_headers, week_of='2026-10-01')
    reading_rows = sorted((row for row in corrected['history'] if row['task_id'] == reading['id']),
                          key=lambda row: row['date'])
    assert [(row['amount'], row['quota'], row['completed']) for row in reading_rows] == [
        (0, 5, False), (5, 5, True), (4, 5, False),
    ]


async def test_weekly_rest_dates_include_the_full_week_beyond_today_without_future_activity(
    client, guest_headers, frozen_day, session_factory
):
    from app.models import ProgressRecord

    frozen_day['date'] = date(2026, 9, 28)
    task = await create_task(client, guest_headers, target=100, daily_minimum=1,
                             schedule={'mode': 'weekly', 'weekly_target': 2})
    await add_record(client, guest_headers, task['id'], 1)
    frozen_day['date'] += timedelta(days=1)
    await add_record(client, guest_headers, task['id'], 1)
    async with session_factory() as session:
        session.add(ProgressRecord(task_id=UUID(task['id']), amount=5, date=date(2026, 10, 2)))
        await session.commit()
    result = await history(client, guest_headers, week_of='2026-09-30')
    assert {row['date'] for row in result['history']} == {'2026-09-28', '2026-09-29'}
    # Existing schedule projection marks the goal-reaching day as rest as well.
    assert result['rest_dates'] == ['2026-09-29', '2026-09-30', '2026-10-01',
                                   '2026-10-02', '2026-10-03', '2026-10-04']


async def test_weekday_rest_dates_keep_crossmonth_days_and_optional_work(
    client, guest_headers, frozen_day
):
    frozen_day['date'] = date(2026, 9, 28)
    task = await create_task(client, guest_headers, target=100, daily_minimum=1,
                             schedule={'mode': 'weekdays', 'weekdays': [0, 2, 4]})
    await add_record(client, guest_headers, task['id'], 1)
    frozen_day['date'] += timedelta(days=1)
    await add_record(client, guest_headers, task['id'], 1)
    result = await history(client, guest_headers, week_of='2026-10-01')
    assert result['rest_dates'] == ['2026-09-29', '2026-10-01', '2026-10-03', '2026-10-04']
    extra = next(row for row in result['history'] if row['date'] == '2026-09-29')
    assert extra['completed'] and extra['amount'] == 1


@pytest.mark.parametrize('params', [
    {'week_of': 'bad'}, {'week_of': '2026-02-30'}, {'week_of': ''},
    {'week_of': '0000-01-01'}, {'week_of': '10000-01-01'}, {'week_of': '9999-12-31'},
    {'month': '2026-10', 'week_of': '2026-10-01'}, {'month': '2026-13'},
])
async def test_week_validation_rejects_invalid_dates_or_conflicting_scopes(client, guest_headers, params):
    response = await client.get('/api/history', headers=guest_headers, params=params)
    assert response.status_code == 422, response.text


@pytest.mark.parametrize('week_of', ['0001-01-01', '1999-12-31', '9999-12-26'])
async def test_calendar_retains_its_date_range_without_weekly_review_restrictions(
    client, guest_headers, week_of
):
    assert await history(client, guest_headers, week_of=week_of) == {
        'history': [], 'rest_dates': [], 'streak': 0,
    }


async def test_week_history_requires_an_owner(client):
    assert (await client.get('/api/history', params={'week_of': '2026-10-01'})).status_code == 401
