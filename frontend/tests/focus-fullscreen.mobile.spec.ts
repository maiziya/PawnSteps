import { expect, test } from '@playwright/test';
import { navigate, openWorkspace, expectNoHorizontalOverflow } from './helpers';

test('phone fullscreen fallback fits timer controls in portrait and landscape in both themes', async ({ page }, testInfo) => {
  await page.addInitScript(() => Object.defineProperty(Element.prototype, 'requestFullscreen', { configurable: true, value: undefined }));
  await page.setViewportSize({ width: 375, height: 667 }); await openWorkspace(page); await navigate(page, '专注计时');
  await page.getByRole('button', { name: '全屏专注', exact: true }).click();
  await expect(page.locator('.mobile-nav')).toBeHidden();
  const start = page.getByRole('button', { name: '开始专注', exact: true });
  await expect(start).toBeEnabled();
  for (const [width, height] of [[375, 667], [667, 375]]) {
    await page.setViewportSize({ width, height }); await expectNoHorizontalOverflow(page);
    const box = (await start.boundingBox())!; expect(box.y).toBeGreaterThanOrEqual(0); expect(box.y + box.height).toBeLessThanOrEqual(height);
    await page.screenshot({ path: testInfo.outputPath(`fullscreen-${width}-light.png`) });
  }
  await page.setViewportSize({ width: 375, height: 667 });
  await page.getByRole('button', { name: '切换暗色模式', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('fullscreen-dark.png') });
  await start.click(); await page.getByRole('button', { name: '结束本轮', exact: true }).click();
  await page.getByRole('button', { name: '确认结束', exact: true }).click();
  const save = page.getByRole('button', { name: '只保存时长', exact: true });
  await expect(save).toBeVisible(); const box = (await save.boundingBox())!; expect(box.y + box.height).toBeLessThanOrEqual(667);
  await page.getByRole('button', { name: '退出全屏', exact: true }).click();
  await expect(page.locator('.mobile-nav')).toBeVisible();
});
