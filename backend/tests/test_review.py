"""Weekly reporting preserves business dates, units and real activity."""
from datetime import date, datetime, timedelta, timezone
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

import pytest

from conftest import add_record, assert_mutation, create_task


@pytest.fixture
def clock(monkeypatch):
    from app.services import focus, tracker
    value = {'now': datetime(2026, 10, 7, 1, tzinfo=timezone.utc)}
    monkeypatch.setattr(tracker, 'utcnow', lambda: value['now'])
    monkeypatch.setattr(tracker, 'today', lambda: value['now'].astimezone(ZoneInfo('Asia/Shanghai')).date())
    monkeypatch.setattr(focus, 'utcnow', lambda: value['now'])
    return value


def on_day(clock, value):
    clock['now'] = datetime.combine(date.fromisoformat(value), datetime.min.time(), ZoneInfo('Asia/Shanghai')).astimezone(timezone.utc) + timedelta(hours=9)


async def report(client, headers, day=None):
    response = await client.get('/api/review/weekly', headers=headers, params={'week_of': day} if day else {})
    assert response.status_code == 200, response.text
    return response.json()


async def test_dated_work_preserves_units_and_counts_distinct_days_and_tasks(client, guest_headers, clock):
    pages = await create_task(client, guest_headers, 'Reading', target=20, unit='页', daily_minimum=2)
    pieces = await create_task(client, guest_headers, 'Practice', target=20, unit='个', daily_minimum=3)
    await add_record(client, guest_headers, pages['id'], 1)
    await add_record(client, guest_headers, pages['id'], 3)
    await add_record(client, guest_headers, pieces['id'], 1)
    result = await report(client, guest_headers)
    summary = result['current']['summary']
    assert result['week_start'] == '2026-10-05' and result['elapsed_days'] == 3
    assert result['through_date'] == '2026-10-07'
    assert summary['quantities'] == {'个': 1, '页': 4}
    assert summary['active_tasks'] == 2 and summary['active_days'] == summary['achieved_days'] == 1
    assert result['current']['days'][2]['task_count'] == 2
    assert result['current']['days'][2]['achieved_count'] == 1
    assert result['current']['days'][3]['is_future']


async def test_partial_week_compares_matching_weekdays_and_past_week_is_complete(client, guest_headers, clock):
    on_day(clock, '2026-09-28')
    task = await create_task(client, guest_headers, target=100, daily_minimum=1, unit='页')
    await add_record(client, guest_headers, task['id'], 2)
    on_day(clock, '2026-10-03')
    await add_record(client, guest_headers, task['id'], 50)
    on_day(clock, '2026-10-07')
    await add_record(client, guest_headers, task['id'], 3)
    current = await report(client, guest_headers)
    assert current['previous']['end'] == '2026-09-30'
    assert current['previous']['summary']['quantities'] == {'页': 2}
    assert current['current']['summary']['quantities'] == {'页': 3}
    previous = await report(client, guest_headers, '2026-10-04')
    assert not previous['is_current_week'] and previous['elapsed_days'] == 7
    assert previous['current']['summary']['quantities'] == {'页': 52}
    assert all(not day['is_future'] for day in previous['current']['days'])


async def test_course_folders_and_undated_checks_are_excluded_and_unchecks_update_report(client, guest_headers, clock, session_factory):
    from app.models import Task
    task = await create_task(client, guest_headers, course_items=[{'name': 'Chapter/'}, {'name': 'Old'}, {'name': 'New'}], daily_minimum=1)
    async with session_factory() as session:
        row = await session.get(Task, UUID(task['id']))
        row.course_items = [{'name': 'Chapter/', 'done': False}, {'name': 'Old', 'done': True}, {'name': 'New', 'done': False}]
        await session.commit()
    assert_mutation(await client.post(f"/api/tasks/{task['id']}/course", headers=guest_headers, json={'indices': [2], 'done': True}))
    result = await report(client, guest_headers)
    assert result['current']['summary']['quantities'] == {'节': 1}
    assert result['current']['summary']['achieved_days'] == 1
    await client.post(f"/api/tasks/{task['id']}/course", headers=guest_headers, json={'indices': [2], 'done': False})
    updated = await report(client, guest_headers)
    assert updated['current']['summary']['quantities'] == {}
    assert updated['current']['summary']['achieved_days'] == 0


async def test_automatic_rest_days_do_not_become_achievements(client, guest_headers, clock):
    on_day(clock, '2026-10-05')
    await create_task(client, guest_headers, daily_plan=[0, 10, -1, 5], plan_start_date='2026-10-05')
    result = await report(client, guest_headers)
    assert result['current']['days'][0]['is_rest']
    assert result['current']['summary']['active_days'] == 0
    assert result['current']['summary']['achieved_days'] == 0
    assert result['current']['summary']['quantities'] == {}


async def test_record_corrections_and_task_delete_undo_are_reflected(client, guest_headers, clock, session_factory):
    from app.models import ProgressRecord
    task = await create_task(client, guest_headers, target=100, unit='页', daily_minimum=2)
    record = (await add_record(client, guest_headers, task['id'], 5))['record']
    async with session_factory() as session:
        session.add(ProgressRecord(task_id=UUID(task['id']), amount=20, date=None, source='legacy', request_id=uuid4()))
        await session.commit()
    assert (await report(client, guest_headers))['current']['summary']['quantities'] == {'页': 5}
    await client.patch(f"/api/tasks/{task['id']}/records/{record['id']}", headers=guest_headers, json={'amount': 1})
    corrected = await report(client, guest_headers)
    assert corrected['current']['summary']['quantities'] == {'页': 1}
    assert corrected['current']['summary']['achieved_days'] == 0
    deleted = assert_mutation(await client.delete(f"/api/tasks/{task['id']}", headers=guest_headers))
    assert (await report(client, guest_headers))['current']['summary']['active_tasks'] == 0
    await client.post('/api/tasks/undo', headers=guest_headers, json={'token': deleted['undo_token']})
    assert (await report(client, guest_headers))['current']['summary']['quantities'] == {'页': 1}
    await client.delete(f"/api/tasks/{task['id']}/records/{record['id']}", headers=guest_headers)
    assert (await report(client, guest_headers))['current']['summary']['quantities'] == {}


async def test_focus_cross_midnight_uses_actual_dates_and_excludes_pause_and_break(client, guest_headers, clock):
    clock['now'] = datetime(2026, 10, 4, 15, 59, 30, tzinfo=timezone.utc)
    await client.patch('/api/focus/settings', headers=guest_headers, json={'focus_minutes': 1})
    started = assert_mutation(await client.post('/api/focus/start', headers=guest_headers, json={'request_id': str(uuid4())}), 201)['focus']['active_session']
    clock['now'] += timedelta(seconds=20)
    await client.post(f"/api/focus/{started['id']}/pause", headers=guest_headers)
    clock['now'] += timedelta(seconds=60)
    await client.post(f"/api/focus/{started['id']}/resume", headers=guest_headers)
    clock['now'] += timedelta(seconds=41)
    result = await report(client, guest_headers)
    assert result['current']['summary']['focus_seconds'] == 40
    assert result['current']['summary']['pomodoros'] == 1
    assert result['current']['summary']['active_days'] == 1
    assert result['current']['summary']['active_tasks'] == result['current']['summary']['achieved_days'] == 0
    await client.post(f"/api/focus/{started['id']}/settle", headers=guest_headers, json={'record_progress': False})
    clock['now'] += timedelta(minutes=5)
    assert (await report(client, guest_headers))['current']['summary']['focus_seconds'] == 40
    previous = await report(client, guest_headers, '2026-10-04')
    assert previous['current']['summary']['focus_seconds'] == 20
    assert previous['current']['summary']['pomodoros'] == 0


async def test_completion_count_excludes_unfinished_expired_plans_and_undo_reopens_goals(client, guest_headers, clock):
    on_day(clock, '2026-10-05')
    await create_task(client, guest_headers, 'Expired', daily_plan=[10], plan_start_date='2026-10-05')
    goal = await create_task(client, guest_headers, 'Finished', target=1)
    record = (await add_record(client, guest_headers, goal['id'], 1))['record']
    on_day(clock, '2026-10-07')
    assert (await report(client, guest_headers))['current']['summary']['completed_tasks'] == 1
    await client.delete(f"/api/tasks/{goal['id']}/records/{record['id']}", headers=guest_headers)
    assert (await report(client, guest_headers))['current']['summary']['completed_tasks'] == 0


async def test_owner_isolation_and_week_validation(client, guest_headers, other_guest_headers, clock):
    task = await create_task(client, guest_headers)
    await add_record(client, guest_headers, task['id'], 1)
    assert (await report(client, other_guest_headers))['current']['summary']['active_tasks'] == 0
    assert (await client.get('/api/review/weekly')).status_code == 401
    for day in ['bad', '2026-10-12', '1999-12-31']:
        assert (await client.get('/api/review/weekly', headers=guest_headers, params={'week_of': day})).status_code == 422
    result = await report(client, guest_headers, '2026-01-01')
    assert result['week_start'] == '2025-12-29' and result['week_end'] == '2026-01-04'
