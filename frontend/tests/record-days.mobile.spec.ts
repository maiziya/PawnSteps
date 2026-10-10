import { expect, test } from '@playwright/test';
import { createTask, expectNoHorizontalOverflow, openRecords, openWorkspace, taskCard, uniqueName } from './helpers';

test('daily summaries and editable details remain legible at narrow widths in both themes', async ({ page }) => {
  await openWorkspace(page);
  const name = uniqueName('手机每日记录');
  await createTask(page, name, { target: 100, unit: '个' });
  const card = taskCard(page, name);
  await card.getByRole('button', { name: `${name}增加5个`, exact: true }).click();
  await expect(card.getByRole('button', { name: `${name}增加1个`, exact: true })).toBeEnabled();
  await page.setViewportSize({ width: 320, height: 568 });
  const dialog = await openRecords(page, name);
  await expect(dialog.locator('.record-day')).toHaveCount(1);
  for (const dark of [false, true]) {
    await page.evaluate(value => document.documentElement.classList.toggle('dark', value), dark);
    await expect(dialog.locator('.record-day-summary')).toContainText('5 个');
    await expectNoHorizontalOverflow(page);
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await dialog.getByRole('button', { name: '查看明细', exact: true }).click();
    await expect(dialog.getByRole('article')).toHaveCount(1);
    await expect(dialog.getByRole('button', { name: '编辑记录', exact: true })).toBeEnabled();
    await dialog.getByRole('button', { name: '收起明细', exact: true }).click();
    await expect(dialog.getByRole('article')).toHaveCount(0);
  }
});
