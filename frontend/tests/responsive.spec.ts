import { expect, test } from '@playwright/test';
import { createTask, expectNoHorizontalOverflow, openWorkspace, uniqueName } from './helpers';

test('desktop and tablet layouts fit their viewport and theme preference survives reload', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await openWorkspace(page);
  await createTask(page, uniqueName('保持自己的节奏'), { target: 10 });
  for (const width of [768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`light-${width}.png`), fullPage: true });
  }
  await page.getByRole('button', { name: '切换暗色模式', exact: true }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('dark-1440.png'), fullPage: true });
  expect(errors).toEqual([]);
});
