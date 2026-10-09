import { expect, test } from '@playwright/test';
import { openWorkspace, navigate, persistedState, uniqueName, taskCard, expectNoHorizontalOverflow } from './helpers';
import type { FocusState } from '../lib/focus-types';

async function focusState(page: import('@playwright/test').Page): Promise<FocusState> {
  const guest = await page.evaluate(() => localStorage.getItem('pawnsteps-guest-id')!);
  const response = await page.request.get('/api/focus', { headers: { 'X-Guest-Id': guest } });
  expect(response.ok()).toBeTruthy(); return response.json();
}
async function create(page: import('@playwright/test').Page, fields: object) {
  const guest = await page.evaluate(() => localStorage.getItem('pawnsteps-guest-id')!);
  const response = await page.request.post('/api/tasks', { headers: { 'X-Guest-Id': guest }, data: { name: uniqueName('专注任务'), target: 20, ...fields } });
  expect(response.ok()).toBeTruthy(); const data = await response.json(); return data.tasks.at(-1);
}
async function end(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: '结束本轮', exact: true }).click();
  await page.getByRole('button', { name: '确认结束', exact: true }).click();
  await expect(page.getByRole('region', { name: '确认专注成果' })).toBeVisible();
}

test('focus restores across navigation and reload, excludes paused time and synchronizes tabs', async ({ page, context }) => {
  await openWorkspace(page); await navigate(page, '专注计时');
  await page.getByRole('button', { name: '开始专注', exact: true }).click();
  await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
  const first = (await focusState(page)).active_session!;
  await expect.poll(async () => (await focusState(page)).active_session!.elapsed_seconds).toBeGreaterThanOrEqual(1);
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  const paused = (await focusState(page)).active_session!;
  await navigate(page, '打卡日历');
  await expect(page.getByRole('button', { name: '返回专注计时' })).toContainText('已暂停');
  await page.getByRole('button', { name: '返回专注计时' }).click();
  await page.reload(); await expect(page.getByRole('button', { name: '继续专注', exact: true })).toBeVisible();
  const restored = (await focusState(page)).active_session!;
  expect(restored.id).toBe(first.id); expect(restored.elapsed_seconds).toBe(paused.elapsed_seconds);
  const tab = await context.newPage(); await tab.goto('/#focus');
  await expect(tab.getByRole('button', { name: '继续专注', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '继续专注', exact: true }).click();
  await expect(tab.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
  expect((await focusState(tab)).active_session!.id).toBe(first.id);
  await end(page); await page.getByRole('button', { name: '只保存时长', exact: true }).click();
  await expect(tab.getByRole('button', { name: '开始专注', exact: true })).toBeVisible();
  expect((await focusState(page)).summary.total_pomodoros).toBe(0);
  await expectNoHorizontalOverflow(page);
});

test('task menu starts associated focus; early end confirms actual quantity only once', async ({ page }) => {
  await openWorkspace(page); const task = await create(page, { unit: '个', daily_minimum: 1 });
  await page.reload();
  await taskCard(page, task.name).getByRole('button', { name: `任务操作：${task.name}` }).click();
  await page.getByRole('menuitem', { name: '开始专注', exact: true }).click();
  await expect(page.getByRole('heading', { name: '专注计时', exact: true })).toBeVisible();
  await expect.poll(async () => (await focusState(page)).active_session?.elapsed_seconds || 0).toBeGreaterThanOrEqual(1);
  expect((await persistedState(page)).tasks.find(item => item.id === task.id)!.progress).toBe(0);
  await end(page); await page.getByLabel('本轮实际完成量', { exact: true }).fill('3');
  await page.getByRole('button', { name: '记录并确认', exact: true }).click();
  await expect(page.getByRole('button', { name: '开始专注', exact: true })).toBeVisible();
  const result = (await persistedState(page)).tasks.find(item => item.id === task.id)!;
  expect(result.progress).toBe(3); expect(result.record_count).toBe(1); expect(result.today_amount).toBe(3);
  await page.reload(); expect((await persistedState(page)).tasks.find(item => item.id === task.id)!.record_count).toBe(1);
});

test('one real minute completes, waits for quantity confirmation, then starts a break', async ({ page }) => {
  test.setTimeout(100_000);
  await openWorkspace(page); const task = await create(page, { unit: '分钟', daily_minimum: 1 });
  await page.reload(); await navigate(page, '专注计时');
  await page.getByRole('button', { name: '专注设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '专注节奏' });
  await settings.getByLabel('专注时长', { exact: false }).fill('1');
  await settings.getByLabel('短休息', { exact: false }).fill('1');
  await settings.getByRole('button', { name: '保存设置', exact: true }).click(); await expect(settings).toBeHidden();
  await page.locator('#focus-task').selectOption(task.id);
  await page.getByRole('button', { name: '开始专注', exact: true }).click();
  // Simulate a background tab while keeping browser scheduling deterministic.
  await page.evaluate(() => Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }));
  await expect(page.getByRole('region', { name: '确认专注成果' })).toBeVisible({ timeout: 70_000 });
  await page.evaluate(() => { delete (document as unknown as { hidden?: boolean }).hidden; });
  expect((await persistedState(page)).tasks.find(item => item.id === task.id)!.progress).toBe(0);
  await expect(page.getByLabel('本轮实际完成量')).toHaveValue('1');
  await page.getByRole('button', { name: '记录并确认', exact: true }).click();
  await expect(page.getByRole('button', { name: '跳过休息', exact: true })).toBeVisible();
  const state = await focusState(page);
  expect(state.summary.today_seconds).toBe(60); expect(state.summary.today_pomodoros).toBe(1);
  expect(state.active_session!.phase).toBe('short_break');
  expect((await persistedState(page)).tasks.find(item => item.id === task.id)!.record_count).toBe(1);
  await page.getByRole('button', { name: '跳过休息', exact: true }).click();
  await page.getByRole('button', { name: '确认结束', exact: true }).click();
  await expect(page.getByRole('button', { name: '开始专注', exact: true })).toBeVisible();
});

test('course confirmation supports fast selection and clearing without changing readonly lessons', async ({ page }) => {
  await openWorkspace(page); const task = await create(page, { course_items: [{ name: 'Lessons/', done: false }, { name: 'Already learned', done: false }, { name: 'Lesson B', done: false }, { name: 'Lesson C', done: false }, { name: 'Lesson D', done: false }] });
  const guest = await page.evaluate(() => localStorage.getItem('pawnsteps-guest-id')!);
  await page.request.post(`/api/tasks/${task.id}/course`, { headers: { 'X-Guest-Id': guest }, data: { indices: [1], done: true } });
  await page.reload(); await navigate(page, '专注计时'); await page.locator('#focus-task').selectOption(task.id);
  await page.getByRole('button', { name: '开始专注', exact: true }).click();
  await expect.poll(async () => (await focusState(page)).active_session!.elapsed_seconds).toBeGreaterThanOrEqual(1);
  await end(page); await page.getByRole('button', { name: '选择完成的课程', exact: true }).click();
  const picker = page.getByRole('dialog', { name: '本轮完成的课程', exact: true });
  await expect(picker.getByRole('checkbox', { name: 'Already learned' })).toBeDisabled();
  const labels = picker.locator('[data-course-item]');
  for (const expected of [4, 1, 4]) {
    const first = (await labels.first().boundingBox())!, last = (await labels.last().boundingBox())!;
    await page.mouse.move(first.x + 32, first.y + 8); await page.mouse.down();
    await page.mouse.move(last.x + last.width - 3, last.y + last.height - 3, { steps: 1 }); await page.mouse.up();
    await expect(picker.getByRole('checkbox', { checked: true })).toHaveCount(expected);
  }
  expect((await persistedState(page)).tasks.find(item => item.id === task.id)!.progress).toBe(1);
  await picker.getByRole('button', { name: '确认选择', exact: true }).click();
  await page.getByRole('button', { name: '记录并确认', exact: true }).click();
  await expect.poll(async () => (await persistedState(page)).tasks.find(item => item.id === task.id)!.progress).toBe(4);
});

test('uncertain settlement stays retryable and completion undo preserves a single record', async ({ page }) => {
  await openWorkspace(page); const task = await create(page, { unit: '个', target: 1 });
  await page.reload(); await navigate(page, '专注计时'); await page.locator('#focus-task').selectOption(task.id);
  await page.getByRole('button', { name: '开始专注', exact: true }).click();
  await expect.poll(async () => (await focusState(page)).active_session!.elapsed_seconds).toBeGreaterThanOrEqual(1);
  await end(page); await page.getByLabel('本轮实际完成量', { exact: true }).fill('1');
  const bodies: object[] = [];
  await page.route('**/api/focus/*/settle', async route => {
    bodies.push(route.request().postDataJSON());
    if (bodies.length === 1) { const response = await route.fetch(); expect(response.ok()).toBeTruthy(); await route.fulfill({ status: 503, json: { detail: '暂时未确认' } }); }
    else await route.continue();
  });
  await page.getByRole('button', { name: '记录并确认', exact: true }).click();
  await expect(page.getByRole('button', { name: '重试确认', exact: true })).toBeVisible();
  // A visibility refresh can observe the already settled server state before retry.
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.getByRole('button', { name: '重试确认', exact: true }).click();
  await expect(page.getByRole('button', { name: '开始专注', exact: true })).toBeVisible();
  expect(bodies).toHaveLength(2); expect(bodies[1]).toEqual(bodies[0]);
  expect((await persistedState(page)).tasks.find(item => item.id === task.id)!.record_count).toBe(1);
  await page.locator('[data-sonner-toast]').filter({ hasText: `已完成「${task.name}」` }).getByRole('button', { name: '撤销', exact: true }).click();
  await expect.poll(async () => (await persistedState(page)).tasks.find(item => item.id === task.id)!.progress).toBe(0);
});
