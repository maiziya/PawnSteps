import { expect, test } from '@playwright/test';
import { expectNoHorizontalOverflow, openWorkspace, taskCard, uniqueName } from './helpers';

test.use({ reducedMotion: 'no-preference' });
test('mobile progress feedback fits long units and both themes', async ({ page }, testInfo) => {
  await openWorkspace(page);
  const headers = { 'X-Guest-Id': await page.evaluate(() => localStorage.getItem('pawnsteps-guest-id')!) };
  const name = uniqueName('阅读一本很长的书并记录每天的学习笔记');
  const response = await page.request.post('/api/tasks', { headers, data: { name, target: 50, unit: '阅读笔记段落' } });
  expect(response.status()).toBe(201);
  await page.reload();
  const card = taskCard(page, name);
  await card.getByRole('button', { name: `${name}增加5阅读笔记段落`, exact: true }).click();
  await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '5');
  await expect(card.locator('.task-progress').getByRole('status')).toHaveText('+5 阅读笔记段落');
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { localStorage.setItem('pawnsteps-theme', theme); }, theme);
    await page.reload();
    for (const width of [320, 375, 430]) {
      await page.setViewportSize({ width, height: 812 });
      await expectNoHorizontalOverflow(page);
      await expect(card.getByRole('progressbar')).toBeVisible();
      await expect(card.getByRole('button', { name: `${name}增加5阅读笔记段落`, exact: true })).toBeVisible();
    }
    await page.screenshot({ path: testInfo.outputPath(`progress-phone-${theme}.png`) });
  }
});
