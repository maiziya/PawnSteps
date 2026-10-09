import { expect, test } from '@playwright/test';
import { openWorkspace, navigate, expectNoHorizontalOverflow } from './helpers';

test('mobile focus keeps task choice and timer controls above navigation in both themes', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 667 }); await openWorkspace(page); await navigate(page, '专注计时');
  const button = page.getByRole('button', { name: '开始专注', exact: true });
  await expect(button).toBeEnabled(); await expectNoHorizontalOverflow(page);
  const nav = (await page.getByRole('navigation', { name: '移动导航', exact: true }).boundingBox())!;
  const bounds = (await button.boundingBox())!; expect(bounds.y + bounds.height).toBeLessThanOrEqual(nav.y);
  await expect(page.locator('#focus-mobile-task')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('focus-light.png') });
  await page.getByRole('button', { name: '切换主题', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('focus-dark.png') });
  await button.click(); await page.getByRole('button', { name: '结束本轮', exact: true }).click();
  await page.getByRole('button', { name: '确认结束', exact: true }).click();
  await expect(page.getByRole('region', { name: '确认专注成果' })).toBeVisible();
  const save = (await page.getByRole('button', { name: '只保存时长', exact: true }).boundingBox())!;
  expect(save.y + save.height).toBeLessThanOrEqual(nav.y);
});
