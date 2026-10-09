import { expect, test } from '@playwright/test';
import { openWorkspace, expectNoHorizontalOverflow, taskCard } from './helpers';

test('three short today tasks and their focus controls fit above mobile navigation', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 667 }); await openWorkspace(page);
  const guest = await page.evaluate(() => localStorage.getItem('pawnsteps-guest-id')!);
  const headers = { 'X-Guest-Id': guest }, tasks: { id: string; name: string }[] = [];
  for (const title of ['阅读', '运动', '整理']) {
    const name = title;
    const response = await page.request.post('/api/tasks', { headers, data: { name, target: 20, daily_minimum: 1 } }); expect(response.ok()).toBeTruthy();
    tasks.push((await response.json()).tasks.find((task: { name: string }) => task.name === name));
  }
  const current = await (await page.request.get('/api/state', { headers })).json();
  expect((await page.request.put('/api/day-plan', { headers, data: { date: current.today, task_ids: tasks.map(task => task.id) } })).ok()).toBeTruthy();
  await page.goto('/#today'); await page.reload(); await expect(page.locator('article.task-card')).toHaveCount(3);
  await expectNoHorizontalOverflow(page);
  const nav = (await page.getByRole('navigation', { name: '移动导航', exact: true }).boundingBox())!;
  const last = taskCard(page, tasks[2].name).getByRole('button', { name: `${tasks[2].name}开始专注`, exact: true });
  const bounds = (await last.boundingBox())!; expect(bounds.y + bounds.height).toBeLessThanOrEqual(nav.y);
  await page.screenshot({ path: testInfo.outputPath('today-plan-light.png') });
  await page.getByRole('button', { name: '切换主题', exact: true }).click(); await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('today-plan-dark.png') });
  await page.getByRole('button', { name: '调整今日计划', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '今天最重要的事', exact: true });
  await expect(dialog.getByRole('button', { name: '保存计划', exact: true })).toBeInViewport({ ratio: 1 });
});
