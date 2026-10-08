import { expect, test } from '@playwright/test';
import { createTask, expectNoHorizontalOverflow, navigate, openWorkspace, taskCard, uniqueName } from './helpers';

test('mobile supports creation, progress, navigation, and both themes without overflow', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 375, height: 812 });
  await openWorkspace(page);
  const name = uniqueName('把小步走稳');
  await createTask(page, name, { target: 3 });
  await taskCard(page, name).getByRole('button', { name: `${name}增加一步`, exact: true }).tap();
  await expect(taskCard(page, name).getByRole('slider')).toHaveValue('1');
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('mobile-light-375.png'), fullPage: true });
  await page.getByRole('button', { name: '切换主题', exact: true }).tap();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await navigate(page, '心愿奖励');
  await expect(page.getByRole('heading', { name: '我的奖励架', exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('mobile-dark-rewards-375.png'), fullPage: true });
  await navigate(page, '个人中心');
  await expectNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
});
