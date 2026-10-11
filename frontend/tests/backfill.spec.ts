import { expect, test } from '@playwright/test';
import { navigate, openCourse, openRecords, persistedState, showCompletedTasks } from './helpers';
import { seedBackfill } from './backfill-helpers';


test('historical quantity stays out of today, merges by day and retains its marker after edit and revoke', async ({ page }) => {
  const { task, date } = await seedBackfill(page);
  const dialog = await openRecords(page, task.name);
  await dialog.getByLabel('完成日期', { exact: true }).fill(date);
  await dialog.getByLabel('本次完成量', { exact: true }).fill('3');
  await dialog.getByLabel('备注', { exact: true }).fill('昨天读完了这一节');
  await dialog.getByRole('button', { name: '保存补记', exact: true }).click();
  const day = dialog.getByRole('region', { name: `每日记录 ${date}`, exact: true });
  await expect(day.locator('.record-day-summary')).toContainText('3 页');
  await expect(day.locator('.record-backfill-label')).toContainText('补记');
  const saved = (await persistedState(page)).tasks.find(row => row.id === task.id)!;
  expect(saved.today_amount).toBe(0); expect(saved.progress).toBe(3);
  await day.getByRole('button', { name: '查看明细', exact: true }).click();
  const entry = day.getByRole('article');
  await expect(entry.locator('.record-date')).toContainText('补记于');
  await entry.getByRole('button', { name: '编辑记录', exact: true }).click();
  await entry.getByLabel('修改完成量', { exact: true }).fill('1');
  await entry.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(day.locator('.record-day-summary')).toContainText('1 页');
  await entry.getByRole('button', { name: '撤销记录', exact: true }).click();
  await expect(day).toHaveCount(0);
  expect((await persistedState(page)).tasks.find(row => row.id === task.id)!.progress).toBe(0);
});

test('calendar date opens a matching task picker and records a previously empty date', async ({ page }) => {
  const { task, date } = await seedBackfill(page);
  await navigate(page, '打卡日历');
  const prefix = `${Number(date.slice(5, 7))}月${Number(date.slice(8))}日`;
  const cell = page.getByRole('button', { name: new RegExp(`^${prefix}`) });
  await cell.click();
  await page.getByRole('button', { name: '补记当天', exact: true }).click();
  const picker = page.getByRole('dialog', { name: '补记任务', exact: true });
  await picker.getByRole('button', { name: `补记${task.name}`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `记录进度 · ${task.name}`, exact: true });
  await expect(dialog.getByLabel('完成日期', { exact: true })).toHaveValue(date);
  await dialog.getByLabel('本次完成量', { exact: true }).fill('2');
  await dialog.getByRole('button', { name: '保存补记', exact: true }).click();
  await expect(dialog.locator('.record-day-summary')).toContainText('2 页');
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.locator('.calendar-day-detail')).toContainText(task.name);
  await expect(page.locator('.calendar-day-detail .record-backfill-label')).toContainText('补记');
  await expect(page.locator('.calendar-day-detail')).toContainText('已达标');
  expect((await persistedState(page)).tasks.find(row => row.id === task.id)!.today_amount).toBe(0);
});

test('course completion can be backfilled and undone while preserving today’s quantity', async ({ page }) => {
  const { task, date } = await seedBackfill(page, true);
  const drawer = await openCourse(page, task.name);
  await drawer.getByLabel('课程完成日期', { exact: true }).fill(date);
  await drawer.locator('[data-course-item="1"]').click();
  await expect(drawer.locator('[data-course-item="1"]')).toContainText('补记');
  const saved = (await persistedState(page)).tasks.find(row => row.id === task.id)!;
  expect(saved.progress).toBe(1); expect(saved.today_amount).toBe(0);
  expect(saved.course_items![1].done_date).toBe(date);
  await drawer.locator('[data-course-item="1"]').click();
  await expect(drawer.locator('[data-course-item="1"] .record-backfill-label')).toHaveCount(0);
  await expect(drawer.getByRole('progressbar', { name: `${task.name}课程进度`, exact: true })).toHaveAttribute('aria-valuenow', '0');
  expect((await persistedState(page)).tasks.find(row => row.id === task.id)!.progress).toBe(0);
});

test('saving consecutive historical records refreshes both dialog quantities and the card total immediately', async ({ page }) => {
  const { task, date } = await seedBackfill(page);
  const dialog = await openRecords(page, task.name);
  await dialog.getByLabel('完成日期', { exact: true }).fill(date);
  for (const [amount, total] of [[2, 2], [3, 5]]) {
    await dialog.getByLabel('本次完成量', { exact: true }).fill(String(amount));
    await dialog.getByRole('button', { name: '保存补记', exact: true }).click();
    await expect(dialog.locator('.record-totals>span').nth(0)).toContainText(`${total} / 10`);
    await expect(dialog.locator('.record-totals>span').nth(1)).toContainText(String(total));
    await expect(dialog.locator('.record-day-summary')).toContainText(`${total} 页`);
  }
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  const card = page.locator('article.task-card').filter({ has: page.getByRole('heading', { name: task.name, exact: true }) });
  await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '5');
  await expect(card.getByLabel(`${task.name}已完成量`, { exact: true })).toContainText('今日 0');
});

test('backfill completion removes the old card and displays the saved progress once', async ({ page }) => {
  const { task, date } = await seedBackfill(page);
  const dialog = await openRecords(page, task.name);
  await dialog.getByLabel('完成日期', { exact: true }).fill(date);
  await dialog.getByLabel('本次完成量', { exact: true }).fill('10');
  await dialog.getByRole('button', { name: '保存补记', exact: true }).click();
  await expect(dialog.locator('.record-totals>span').nth(0)).toContainText('10 / 10');
  expect((await persistedState(page)).tasks.find(row => row.id === task.id)!.progress).toBe(10);
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await showCompletedTasks(page);
  const completed = page.getByRole('region', { name: '已完成任务列表', exact: true });
  await expect(completed.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '10');
  const cards = page.locator('article.task-card').filter({ has: page.getByRole('heading', { name: task.name, exact: true }) });
  await expect(cards).toHaveCount(1);
  await page.reload();
  await showCompletedTasks(page);
  await expect(cards).toHaveCount(1);
  await expect(cards.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '10');
});

test('extra historical work updates the actual completed quantity on a normal card', async ({ page }) => {
  const { task, date } = await seedBackfill(page);
  const dialog = await openRecords(page, task.name);
  await dialog.getByLabel('完成日期', { exact: true }).fill(date);
  for (const [amount, total] of [[10, 10], [3, 13]]) {
    await dialog.getByLabel('本次完成量', { exact: true }).fill(String(amount));
    await dialog.getByRole('button', { name: '保存补记', exact: true }).click();
    await expect(dialog.locator('.record-day-summary')).toContainText(`${total} 页`);
    await expect(dialog.locator('.record-totals>span').nth(0)).toContainText(`${total} / 10`);
  }
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await showCompletedTasks(page);
  const card = page.getByRole('region', { name: '已完成任务列表', exact: true });
  await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '10');
  await expect(card.locator('.task-progress-counter')).toHaveAttribute('aria-label', '13 / 10 页');
  await page.reload();
  await showCompletedTasks(page);
  await expect(card.locator('.task-progress-counter')).toHaveAttribute('aria-label', '13 / 10 页');
  await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '13 / 10 页');
});

test('a qualified normal task adds backfilled work to its total without changing today’s quantity', async ({ page }) => {
  const { task, date } = await seedBackfill(page);
  const dialog = await openRecords(page, task.name);
  await dialog.getByLabel('本次完成量', { exact: true }).fill('2');
  await dialog.getByRole('button', { name: '保存记录', exact: true }).click();
  await expect(dialog.locator('.record-totals>span').nth(0)).toContainText('2 / 10');
  expect((await persistedState(page)).tasks.find(row => row.id === task.id)!.daily_done).toBe(true);
  await dialog.getByLabel('完成日期', { exact: true }).fill(date);
  await dialog.getByLabel('本次完成量', { exact: true }).fill('3');
  await dialog.getByRole('button', { name: '保存补记', exact: true }).click();
  await expect(dialog.locator('.record-totals>span').nth(0)).toContainText('5 / 10');
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  const card = page.locator('article.task-card').filter({ has: page.getByRole('heading', { name: task.name, exact: true }) });
  await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '5');
  await expect(card.getByLabel(`${task.name}已完成量`, { exact: true })).toContainText('今日 2 / 3');
});
