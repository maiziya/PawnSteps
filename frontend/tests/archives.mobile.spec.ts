import { expect, test } from '@playwright/test';
import { archivedRow, cleanupArchiveGuest, seedArchives } from './archive-helpers';
import { expectNoHorizontalOverflow, persistedState } from './helpers';

test.afterEach(async ({ page }) => { await cleanupArchiveGuest(page); });

test('archive-only workspace remains reachable, paginates, searches and fits both themes', async ({ page }, testInfo) => {
  const { tasks } = await seedArchives(page, 7, true);
  await page.reload();
  await expect(page.getByRole('button', { name: '查看归档', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '归档任务', exact: true }).click();
  await expect(page.locator('.archive-row')).toHaveCount(2);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { localStorage.setItem('pawnsteps-theme', theme); }, theme);
    await page.reload();
    await page.getByRole('button', { name: '归档任务', exact: true }).click();
    await expectNoHorizontalOverflow(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    const pagination = (await page.locator('.archive-pagination').boundingBox())!;
    const nav = (await page.getByRole('navigation', { name: '移动导航' }).boundingBox())!;
    expect(pagination.y + pagination.height).toBeLessThanOrEqual(nav.y);
    await expect(page.getByRole('button', { name: '下一页归档', exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`archive-mobile-${theme}.png`), fullPage: true });
  }
  await page.getByRole('button', { name: '下一页归档', exact: true }).click();
  await expect(page.locator('.archive-pagination')).toContainText('2 / 4');
  await page.getByRole('button', { name: '搜索任务', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索任务', exact: true }).fill(tasks[0].name);
  await expect(page.locator('.archive-row')).toHaveCount(1);
  const row = archivedRow(page, tasks[0]);
  await expect(row).toBeVisible();
  await expect(page.locator('.archive-pagination')).toHaveCount(0);
  await row.getByRole('button', { name: `恢复${tasks[0].name}`, exact: true }).click();
  await expect(row).toHaveCount(0);
  expect((await persistedState(page)).tasks[0].id).toBe(tasks[0].id);
  await page.getByRole('textbox', { name: '搜索任务', exact: true }).fill('');
  await page.getByRole('button', { name: '全部', exact: true }).click();
  await expectNoHorizontalOverflow(page);
});
