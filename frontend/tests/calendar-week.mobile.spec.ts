import { expect, test } from '@playwright/test';
import { expectNoHorizontalOverflow, navigate, openWorkspace, persistedState } from './helpers';

test('the seven-day strip and selected records remain legible on a small mobile screen in both themes', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await openWorkspace(page);
  const headers = { 'X-Guest-Id': await page.evaluate(() => localStorage.getItem('pawnsteps-guest-id')!) };
  const names = ['阅读', '运动', '整理'];
  for (const [index, name] of names.entries()) {
    const response = await page.request.post('/api/tasks', { headers, data: { name, target: 20, daily_minimum: 5, unit: '个' } });
    expect(response.ok()).toBeTruthy();
    const task = (await response.json()).tasks.find((item: { name: string }) => item.name === name);
    expect((await page.request.post(`/api/tasks/${task.id}/records`, { headers, data: { amount: [1, 5, 6][index] } })).ok()).toBeTruthy();
  }
  await page.reload();
  const state = await persistedState(page);
  await navigate(page, '打卡日历');
  const views = page.getByRole('group', { name: '打卡记录视图', exact: true });
  await views.getByRole('button', { name: '周', exact: true }).click();
  const days = page.locator('.calendar-week-day');
  await expect(days).toHaveCount(7);
  await expect(page.locator('.calendar-week-detail')).toContainText('阅读');
  await expect(page.locator('.calendar-week-detail .calendar-completed-list > li')).toHaveCount(3);
  await expect(page.locator(`.calendar-week-day[data-date="${state.today}"]`).getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  await expectNoHorizontalOverflow(page);
  for (const day of await days.all()) {
    await expect(day.getByRole('button')).toBeInViewport({ ratio: 1 });
  }
  const lastRow = page.locator('.calendar-week-detail .calendar-completed-list > li').last();
  await expect.poll(async () => {
    const row = await lastRow.boundingBox();
    const nav = await page.getByRole('navigation', { name: '移动导航', exact: true }).boundingBox();
    return row && nav ? row.y + row.height - nav.y : Number.POSITIVE_INFINITY;
  }, { message: 'Three short daily records should fit above the fixed mobile navigation' }).toBeLessThanOrEqual(0);
  await page.screenshot({ path: testInfo.outputPath('calendar-week-light.png') });
  await page.getByRole('button', { name: '切换主题', exact: true }).click();
  await expectNoHorizontalOverflow(page);
  await expect(page.locator('.calendar-week-detail')).toContainText('超量完成 +1');
  await page.screenshot({ path: testInfo.outputPath('calendar-week-dark.png') });
  await page.getByRole('button', { name: '上一周', exact: true }).click();
  await expect(page.locator('.calendar-week-detail')).not.toContainText('阅读');
  await page.getByRole('button', { name: '本周', exact: true }).click();
  await expect(page.locator('.calendar-week-detail')).toContainText('阅读');
  await expectNoHorizontalOverflow(page);
  await views.getByRole('button', { name: '月历', exact: true }).click();
  await expect(page.locator('.calendar-day[aria-pressed="true"]')).toHaveAttribute('aria-current', 'date');
});
