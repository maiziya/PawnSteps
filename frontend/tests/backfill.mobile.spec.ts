import { expect, test } from '@playwright/test';
import { seedBackfill } from './backfill-helpers';
import { expectNoHorizontalOverflow, openRecords, persistedState } from './helpers';

test('historical date entry and the backfill timestamp fit a narrow phone in both themes', async ({ page }) => {
  const { task, date } = await seedBackfill(page);
  await page.setViewportSize({ width: 320, height: 668 });
  const dialog = await openRecords(page, task.name);
  await dialog.getByLabel('完成日期', { exact: true }).fill(date);
  await dialog.getByLabel('本次完成量', { exact: true }).fill('2');
  await dialog.getByRole('button', { name: '保存补记', exact: true }).click();
  const day = dialog.getByRole('region', { name: `每日记录 ${date}`, exact: true });
  await day.getByRole('button', { name: '查看明细', exact: true }).click();
  for (const dark of [false, true]) {
    await page.evaluate(value => document.documentElement.classList.toggle('dark', value), dark);
    await expect(day.getByRole('article')).toContainText('补记于');
    await expectNoHorizontalOverflow(page);
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  }
  expect((await persistedState(page)).tasks.find(row => row.id === task.id)!.today_amount).toBe(0);
});
