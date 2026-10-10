import { expect, test, type Page } from '@playwright/test';
import type { HistoryEntry, MutationResponse } from '../lib/types';
import { navigate, openWorkspace, persistedState, uniqueName } from './helpers';

test.use({ timezoneId: 'America/Los_Angeles' });

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function monday(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  return shiftDate(value, -((date.getUTCDay() + 6) % 7));
}

async function identity(page: Page) {
  const guest = await page.evaluate(() => localStorage.getItem('pawnsteps-guest-id')!);
  return { 'X-Guest-Id': guest };
}

async function addTask(page: Page, headers: Record<string, string>, name: string, daily = false) {
  const response = await page.request.post('/api/tasks', {
    headers,
    data: { name, target: 20, daily_minimum: daily ? 0 : 5, daily_quota: daily ? 5 : 0, unit: '页' },
  });
  expect(response.ok()).toBeTruthy();
  const state: MutationResponse = await response.json();
  return state.tasks.find(task => task.name === name)!;
}

async function addRecord(page: Page, headers: Record<string, string>, taskId: string, amount: number) {
  const response = await page.request.post(`/api/tasks/${taskId}/records`, { headers, data: { amount } });
  expect(response.status()).toBe(201);
  const state: MutationResponse = await response.json();
  return state.record!;
}

async function showWeek(page: Page) {
  await navigate(page, '打卡日历');
  await page.getByRole('group', { name: '打卡记录视图', exact: true }).getByRole('button', { name: '周', exact: true }).click();
  await expect(page.locator('.calendar-week-day')).toHaveCount(7);
}

function entry(date: string, taskName: string, amount: number, quota: number | null): HistoryEntry {
  return {
    task_id: `00000000-0000-4000-8000-${String(amount).padStart(12, '0')}`,
    task_name: taskName, date, completed: quota !== null && amount >= quota,
    amount, quota, unit: '页', task_kind: 'normal',
  };
}

test('each weekly preview expands in place and can collapse independently', async ({ page }) => {
  await openWorkspace(page);
  const state = await persistedState(page), firstDay = shiftDate(monday(state.today), -7), secondDay = shiftDate(firstDay, 1);
  const entries = [
    ...Array.from({ length: 7 }, (_, index) => entry(firstDay, `第一天记录${index + 1}`, index + 1, 5)),
    ...Array.from({ length: 4 }, (_, index) => entry(secondDay, `第二天记录${index + 1}`, index + 11, 5)),
  ];
  await page.route('**/api/history?*', async route => {
    const url = new URL(route.request().url()), requested = url.searchParams.get('week_of');
    const start = requested ? monday(requested) : `${url.searchParams.get('month')}-01`;
    const end = requested ? shiftDate(start, 6) : `${url.searchParams.get('month')}-31`;
    await route.fulfill({ json: { history: entries.filter(item => item.date >= start && item.date <= end), rest_dates: [], streak: 0 } });
  });
  await showWeek(page); await page.getByRole('button', { name: '上一周', exact: true }).click();
  const first = page.locator(`.calendar-week-day[data-date="${firstDay}"]`), second = page.locator(`.calendar-week-day[data-date="${secondDay}"]`);
  await expect(first.locator('.calendar-week-entries > li')).toHaveCount(3);
  const more = first.getByRole('button', { name: '查看全部 7 项', exact: true });
  await more.focus(); await page.keyboard.press('Enter');
  await expect(first.locator('.calendar-week-entries > li')).toHaveCount(7, { timeout: 2000 });
  await expect(first.getByRole('button', { name: '收起', exact: true })).toBeFocused();
  await expect(second.locator('.calendar-week-entries > li')).toHaveCount(3);
  await second.getByRole('button', { name: '查看全部 4 项', exact: true }).click();
  await expect(second.locator('.calendar-week-entries > li')).toHaveCount(4);
  await expect(first.locator('.calendar-week-entries > li')).toHaveCount(7);
  await first.getByRole('button', { name: '收起', exact: true }).click();
  await expect(first.locator('.calendar-week-entries > li')).toHaveCount(3);
  await expect(second.locator('.calendar-week-entries > li')).toHaveCount(4);
  await page.getByRole('button', { name: '下一周', exact: true }).click();
  await page.getByRole('button', { name: '上一周', exact: true }).click();
  await expect(first.locator('.calendar-week-entries > li')).toHaveCount(3);
  await expect(second.locator('.calendar-week-entries > li')).toHaveCount(3);
});

test('calendar view switches keep controls stable and retain frame height while loading', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 768 }); await openWorkspace(page);
  const state = await persistedState(page), entries = Array.from({ length: 30 }, (_, index) => entry(state.today, `当天记录${index + 1}`, index + 1, 5));
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), seen = new Promise<void>(resolve => { started = resolve; });
  await page.route('**/api/history?*', async route => {
    if (new URL(route.request().url()).searchParams.has('week_of')) { started(); await gate; }
    await route.fulfill({ json: { history: entries, rest_dates: [], streak: 0 } });
  });
  await navigate(page, '打卡日历');
  await expect(page.locator('.calendar-day-detail .calendar-completed-list > li')).toHaveCount(30);
  const before = (await page.locator('.calendar-panel').boundingBox())!, controls = (await page.locator('.calendar-view-toggle').boundingBox())!;
  try {
    await page.getByRole('button', { name: '周', exact: true }).click(); await seen;
    const waiting = (await page.locator('.calendar-panel').boundingBox())!, nextControls = (await page.locator('.calendar-view-toggle').boundingBox())!;
    expect.soft(Math.abs(nextControls.y - controls.y), 'Switching modes must not move the view controls').toBeLessThanOrEqual(1);
    expect.soft(waiting.height, 'A loading placeholder must not collapse the preceding calendar frame').toBeGreaterThanOrEqual(before.height - 1);
  } finally { release(); }
  await expect(page.locator('.calendar-week-detail .calendar-completed-list > li')).toHaveCount(30);
});

test('returning to a loaded calendar range reuses its records without a loading flash', async ({ page }) => {
  await openWorkspace(page); const state = await persistedState(page);
  let requests = 0;
  await page.route('**/api/history?*', async route => {
    requests++;
    await route.fulfill({ json: { history: [entry(state.today, '切换保留的记录', 1, 5)], rest_dates: [], streak: 0 } });
  });
  await navigate(page, '打卡日历'); await expect(page.locator('.calendar-day-detail')).toContainText('切换保留的记录');
  await page.getByRole('button', { name: '周', exact: true }).click(); await expect(page.locator('.calendar-week-detail')).toContainText('切换保留的记录');
  await page.getByRole('button', { name: '月历', exact: true }).click(); await expect(page.locator('.calendar-day-detail')).toContainText('切换保留的记录');
  await page.getByRole('button', { name: '列表', exact: true }).click(); await expect(page.locator('.calendar-list-panel')).toContainText('切换保留的记录');
  await page.getByRole('button', { name: '周', exact: true }).click(); await expect(page.locator('.calendar-week-detail')).toContainText('切换保留的记录');
  expect(requests).toBe(2);
});

test('weekly calendar reflects real ordinary and daily records, including corrections', async ({ page }, testInfo) => {
  await openWorkspace(page);
  const headers = await identity(page);
  const ordinary = await addTask(page, headers, uniqueName('每周阅读'));
  const daily = await addTask(page, headers, uniqueName('每日阅读'), true);
  const first = await addRecord(page, headers, ordinary.id, 1);
  await page.reload();
  const state = await persistedState(page);
  await showWeek(page);
  const today = page.locator(`.calendar-week-day[data-date="${state.today}"]`);
  const detail = page.locator('.calendar-week-detail');
  await expect(today).toHaveClass(/activity-partial/);
  await expect(today.locator('.calendar-day-dots i')).toHaveCount(1);
  await expect(detail).toContainText(ordinary.name);
  await expect(detail).toContainText('完成 1 / 5 页 · 未达标，还差 4 页');
  expect((await persistedState(page)).stats.streak).toBe(0);

  await addRecord(page, headers, daily.id, 5);
  await page.getByRole('button', { name: '刷新进度', exact: true }).click();
  await expect(today).toHaveClass(/activity-met/);
  await expect(detail).toContainText(daily.name);
  await expect(detail).toContainText('完成 5 / 5 页 · 已达标');
  expect((await persistedState(page)).stats.streak).toBe(1);

  const excess = await addRecord(page, headers, ordinary.id, 5);
  await page.getByRole('button', { name: '刷新进度', exact: true }).click();
  await expect(today).toHaveClass(/activity-exceeded/);
  await expect(detail).toContainText('完成 6 / 5 页 · 超量完成 +1 页');
  await page.screenshot({ path: testInfo.outputPath('calendar-week-desktop.png') });

  expect((await page.request.delete(`/api/tasks/${ordinary.id}/records/${excess.id}`, { headers })).ok()).toBeTruthy();
  expect((await page.request.delete(`/api/tasks/${ordinary.id}/records/${first.id}`, { headers })).ok()).toBeTruthy();
  await page.getByRole('button', { name: '刷新进度', exact: true }).click();
  await expect(today).toHaveClass(/activity-met/);
  await expect(detail).not.toContainText(ordinary.name);
  await expect(detail.locator('.calendar-completed-list > li')).toHaveCount(1);
});

test('a week spans both months and years and preserves the selected day when switching views', async ({ page }) => {
  await openWorkspace(page);
  const headers = await identity(page);
  const current = await persistedState(page);
  const entries = [
    entry('2025-12-29', '部分阅读', 1, 5),
    entry('2025-12-30', '达标阅读', 5, 5),
    entry('2025-12-31', '超量阅读', 6, 5),
    entry('2026-01-04', '自由阅读', 2, null),
  ];
  const queries: string[] = [];
  await page.route('**/api/history?*', async route => {
    expect(route.request().headers()['x-guest-id']).toBe(headers['X-Guest-Id']);
    const url = new URL(route.request().url());
    queries.push(url.search);
    const requested = url.searchParams.get('week_of');
    const start = requested ? monday(requested) : `${url.searchParams.get('month')}-01`;
    const end = requested ? shiftDate(start, 6) : `${url.searchParams.get('month')}-31`;
    await route.fulfill({ json: { history: entries.filter(item => item.date >= start && item.date <= end), rest_dates: start <= '2026-01-02' && end >= '2026-01-02' ? ['2026-01-02'] : [], streak: 0 } });
  });
  await navigate(page, '打卡日历');
  const monthDistance = (Number(current.today.slice(0, 4)) - 2025) * 12 + Number(current.today.slice(5, 7)) - 12;
  for (let offset = 0; offset < Math.abs(monthDistance); offset++) {
    await page.getByRole('button', { name: monthDistance >= 0 ? '上个月' : '下个月', exact: true }).click();
  }
  await expect(page.locator('.calendar-month-nav h2')).toHaveText('2025 年 12 月');
  await page.locator('.calendar-day').filter({ hasText: /^31$/ }).click();
  await page.getByRole('group', { name: '打卡记录视图', exact: true }).getByRole('button', { name: '周', exact: true }).click();
  const expectedDates = Array.from({ length: 7 }, (_, index) => shiftDate('2025-12-29', index));
  await expect.poll(() => page.locator('.calendar-week-day').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-date')))).toEqual(expectedDates);
  await expect(page.locator('.calendar-week-day[data-date="2025-12-29"]')).toHaveClass(/activity-partial/);
  await expect(page.locator('.calendar-week-day[data-date="2025-12-30"]')).toHaveClass(/activity-met/);
  await expect(page.locator('.calendar-week-day[data-date="2025-12-31"]')).toHaveClass(/activity-exceeded/);
  await expect(page.locator('.calendar-week-day[data-date="2026-01-01"] .calendar-day-dots i')).toHaveCount(0);
  await expect(page.locator('.calendar-week-day[data-date="2026-01-02"]')).toHaveClass(/is-rest/);
  await expect(page.locator('.calendar-week-detail')).toContainText('超量阅读');
  await page.locator('.calendar-week-day[data-date="2026-01-02"]').getByRole('button').click();
  await expect(page.locator('.calendar-week-detail')).toContainText('这一天是休息日，不计漏打卡');
  await page.locator('.calendar-week-day[data-date="2026-01-04"]').getByRole('button').click();
  await expect(page.locator('.calendar-week-detail')).toContainText('自由阅读');
  await page.getByRole('group', { name: '打卡记录视图', exact: true }).getByRole('button', { name: '月历', exact: true }).click();
  await expect(page.locator('.calendar-month-nav h2')).toHaveText('2026 年 1 月');
  await expect(page.locator('.calendar-day[aria-pressed="true"]')).toHaveText('4');
  await expect(page.locator('.calendar-day-detail')).toContainText('自由阅读');
  await page.getByRole('group', { name: '打卡记录视图', exact: true }).getByRole('button', { name: '列表', exact: true }).click();
  await expect(page.locator('.calendar-list-panel')).toContainText('自由阅读');
  await page.getByRole('group', { name: '打卡记录视图', exact: true }).getByRole('button', { name: '周', exact: true }).click();
  await expect(page.locator('.calendar-week-day[data-date="2026-01-04"]').getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '上一周', exact: true }).click();
  await expect(page.locator('.calendar-week-day').first()).toHaveAttribute('data-date', '2025-12-22');
  await page.getByRole('button', { name: '下一周', exact: true }).click();
  await expect(page.locator('.calendar-week-day').first()).toHaveAttribute('data-date', '2025-12-29');
  await page.getByRole('button', { name: '本周', exact: true }).click();
  await expect(page.locator('.calendar-week-day').first()).toHaveAttribute('data-date', monday(current.today));
  await expect(page.locator(`.calendar-week-day[data-date="${current.today}"]`).getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  expect(queries.some(query => new URLSearchParams(query).has('week_of'))).toBeTruthy();
});

test('a failed weekly history request can retry without showing invented records', async ({ page }) => {
  await openWorkspace(page);
  const headers = await identity(page);
  const task = await addTask(page, headers, uniqueName('周视图重试'));
  await addRecord(page, headers, task.id, 1);
  await page.reload();
  let fail = true;
  await page.route('**/api/history?week_of=*', route => fail ? route.fulfill({ status: 503, json: { detail: '周记录暂时不可用' } }) : route.continue());
  await showWeek(page);
  await expect(page.locator('.calendar-error[role="alert"]')).toContainText('周记录暂时不可用');
  await expect(page.locator('.calendar-week-detail .calendar-completed-list')).toHaveCount(0);
  fail = false;
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.locator('.calendar-error[role="alert"]')).toHaveCount(0);
  await expect(page.locator('.calendar-week-detail')).toContainText(task.name);
});

test('weekly records switch owners after a storage event without a manual refresh', async ({ page }) => {
  await openWorkspace(page);
  const firstHeaders = await identity(page);
  const firstTask = await addTask(page, firstHeaders, uniqueName('原游客阅读'));
  await addRecord(page, firstHeaders, firstTask.id, 1);
  await page.reload();
  await showWeek(page);
  const detail = page.locator('.calendar-week-detail');
  await expect(detail).toContainText(firstTask.name);

  const secondGuest = await page.evaluate(() => crypto.randomUUID());
  const secondHeaders = { 'X-Guest-Id': secondGuest };
  const secondTask = await addTask(page, secondHeaders, uniqueName('新游客阅读'));
  await addRecord(page, secondHeaders, secondTask.id, 6);
  const switchedHistory = page.waitForResponse(response =>
    new URL(response.url()).pathname === '/api/history'
    && new URL(response.url()).searchParams.has('week_of')
    && response.request().headers()['x-guest-id'] === secondGuest
    && response.ok());
  await page.evaluate(({ oldValue, newValue }) => {
    localStorage.setItem('pawnsteps-guest-id', newValue);
    window.dispatchEvent(new StorageEvent('storage', { key: 'pawnsteps-guest-id', oldValue, newValue }));
  }, { oldValue: firstHeaders['X-Guest-Id'], newValue: secondGuest });
  await switchedHistory;
  await expect(detail).toContainText(secondTask.name);
  await expect(detail).toContainText('完成 6 / 5 页 · 超量完成 +1 页');
  await expect(detail).not.toContainText(firstTask.name);
  await expect(page.locator('.calendar-week-grid')).not.toContainText(firstTask.name);
});

test('a slow response from the previous week cannot replace the newly selected week', async ({ page }) => {
  await openWorkspace(page);
  const state = await persistedState(page);
  const currentWeek = monday(state.today);
  const previousWeek = shiftDate(currentWeek, -7);
  let release!: () => void;
  let started!: () => void;
  let settled!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const seen = new Promise<void>(resolve => { started = resolve; });
  const completed = new Promise<void>(resolve => { settled = resolve; });
  await page.route('**/api/history?week_of=*', async route => {
    const week = monday(new URL(route.request().url()).searchParams.get('week_of')!);
    if (week === currentWeek) {
      started();
      await gate;
      try { await route.fulfill({ json: { history: [entry(state.today, '迟到的记录', 6, 5)], rest_dates: [], streak: 0 } }); }
      catch { /* A cancelled browser request may already be closed. */ }
      finally { settled(); }
    } else {
      await route.fulfill({ json: { history: [entry(previousWeek, '上一周的记录', 1, 5)], rest_dates: [], streak: 0 } });
    }
  });
  await showWeek(page);
  await seen;
  await page.getByRole('button', { name: '上一周', exact: true }).click();
  await expect(page.locator('.calendar-week-day').first()).toHaveAttribute('data-date', previousWeek);
  await expect(page.locator('.calendar-week-grid')).toContainText('上一周的记录');
  release();
  await completed;
  await expect(page.locator('.calendar-week-grid')).not.toContainText('迟到的记录');
  await expect(page.locator('.calendar-week-grid')).toContainText('上一周的记录');
});
