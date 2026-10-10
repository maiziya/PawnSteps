import { expect, test } from '@playwright/test';
import { navigate, openWorkspace, persistedState, uniqueName, expectNoHorizontalOverflow } from './helpers';

async function prepare(page: import('@playwright/test').Page) {
  await openWorkspace(page);
  const guest = await page.evaluate(() => localStorage.getItem('pawnsteps-guest-id')!);
  const headers = { 'X-Guest-Id': guest };
  const name = uniqueName('阅读进度');
  const response = await page.request.post('/api/tasks', { headers, data: { name, target: 20, unit: '页', daily_minimum: 2 } });
  expect(response.ok()).toBeTruthy();
  const task = (await response.json()).tasks.find((item: { name: string }) => item.name === name);
  expect((await page.request.post(`/api/tasks/${task.id}/records`, { headers, data: { amount: 3, note: 'Read today' } })).ok()).toBeTruthy();
  await page.reload(); return { task, headers };
}

test('weekly review preserves quantities, drills into days and responds to record corrections', async ({ page }) => {
  const { task } = await prepare(page);
  await navigate(page, '每周回顾');
  const panel = page.getByRole('region', { name: '每周回顾', exact: true });
  await expect(panel.getByRole('group', { name: '推进任务', exact: true })).toContainText('1项');
  await expect(panel.getByRole('group', { name: '达标天数', exact: true })).toContainText('1天');
  await expect(panel.getByRole('region', { name: '本周完成量', exact: true })).toContainText('3页');
  await panel.getByRole('button', { name: /1项任务有进度，1项达标/ }).click();
  await expect(panel.getByRole('button', { name: '查看整周', exact: true })).toBeVisible();
  await panel.getByRole('button', { name: `查看${task.name}的记录`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `记录进度 · ${task.name}` });
  await dialog.getByRole('button', { name: '查看明细', exact: true }).click();
  await dialog.getByRole('button', { name: '撤销记录', exact: true }).click();
  await expect(dialog.getByRole('article')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('#main-content')).toBeFocused();
  await expect(panel.getByRole('group', { name: '推进任务', exact: true })).toContainText('0项');
  await expect(panel.getByRole('group', { name: '达标天数', exact: true })).toContainText('0天');
  expect((await persistedState(page)).tasks.find(item => item.id === task.id)!.progress).toBe(0);
  await expectNoHorizontalOverflow(page);
});

test('week navigation uses server dates, prevents future weeks, and reload keeps the review view', async ({ page }) => {
  const { headers } = await prepare(page);
  await navigate(page, '打卡日历');
  await page.getByRole('group', { name: '打卡记录视图' }).getByRole('button', { name: '每周回顾', exact: true }).click();
  await expect(page.getByRole('button', { name: '下一周', exact: true })).toBeDisabled();
  const response = await page.request.get('/api/review/weekly', { headers });
  const current = await response.json();
  const next = page.waitForResponse(result => result.url().includes('/api/review/weekly?week_of=') && result.ok());
  await page.getByRole('button', { name: '上一周', exact: true }).click();
  const previous = await (await next).json();
  expect(previous.week_start).toBe(current.previous.start);
  expect(previous.elapsed_days).toBe(7);
  await expect(page.getByRole('button', { name: '下一周', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '本周', exact: true }).click();
  await expect(page.getByRole('button', { name: '下一周', exact: true })).toBeDisabled();
  await page.reload(); await expect(page.getByRole('heading', { name: '每周回顾', level: 1 })).toBeVisible();
});

test('failed weekly fetch shows a retry and does not replace totals with fake zeroes', async ({ page }) => {
  await prepare(page);
  let fails = true;
  await page.route('**/api/review/weekly*', route => fails ? route.fulfill({ status: 503, json: { detail: '回顾暂时不可用' } }) : route.continue());
  await navigate(page, '每周回顾');
  await expect(page.getByRole('region', { name: '每周回顾', exact: true }).getByRole('alert')).toContainText('回顾暂时不可用');
  await expect(page.locator('.review-metrics')).toHaveCount(0);
  fails = false;
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.getByRole('group', { name: '推进任务', exact: true })).toContainText('1项');
});

test('course records open from the review and completing the course returns focus to the report', async ({ page }) => {
  const { headers } = await prepare(page);
  const name = uniqueName('回顾课程');
  const response = await page.request.post('/api/tasks', { headers, data: { name, daily_minimum: 1, course_items: [{ name: 'Lessons/' }, { name: 'Lesson A' }, { name: 'Lesson B' }] } });
  expect(response.ok()).toBeTruthy();
  const task = (await response.json()).tasks.find((item: { name: string }) => item.name === name);
  expect((await page.request.post(`/api/tasks/${task.id}/course`, { headers, data: { indices: [1], done: true } })).ok()).toBeTruthy();
  await page.reload(); await navigate(page, '每周回顾');
  await page.getByRole('button', { name: `查看${name}的记录`, exact: true }).click();
  const drawer = page.getByRole('dialog', { name, exact: true });
  await drawer.locator('[data-course-item="2"]').click();
  await expect(drawer.getByRole('checkbox', { name: 'Lesson B', exact: true })).toBeChecked();
  await expect(drawer.locator('.course-drawer-progress')).toContainText('2 / 2');
  await drawer.getByRole('button', { name: '返回每周回顾', exact: true }).click();
  await expect(drawer).toBeHidden();
  await expect(page.locator('#main-content')).toBeFocused();
  await expect(page.getByRole('group', { name: '达成目标', exact: true })).toContainText('1个');
});
