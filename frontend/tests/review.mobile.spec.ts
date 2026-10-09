import { expect, test } from '@playwright/test';
import { openWorkspace, navigate, expectNoHorizontalOverflow } from './helpers';

test('mobile enters weekly review from calendar and shows core metrics and the chart above navigation', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await openWorkspace(page); await navigate(page, '打卡日历');
  await page.getByRole('group', { name: '打卡记录视图' }).getByRole('button', { name: '每周回顾', exact: true }).click();
  await expect(page.getByRole('region', { name: '每日积累' })).toBeVisible();
  const nav = page.getByRole('navigation', { name: '移动导航' });
  await expect(nav.getByRole('button')).toHaveCount(5);
  await expect(nav.getByRole('button', { name: '打卡日历', exact: true })).toHaveAttribute('aria-current', 'page');
  const boundary = (await nav.boundingBox())!.y;
  const chart = (await page.getByRole('region', { name: '每日积累' }).boundingBox())!;
  expect(chart.y + chart.height).toBeLessThanOrEqual(boundary);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('review-light.png') });
  await page.getByRole('button', { name: '切换主题', exact: true }).click();
  await page.getByRole('group', { name: '趋势指标' }).getByRole('button', { name: '专注', exact: true }).click();
  await expect(page.getByRole('group', { name: '每日专注时长' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('review-dark.png') });
});
