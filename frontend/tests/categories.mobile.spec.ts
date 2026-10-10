import { expect, test } from '@playwright/test';
import { createTask, expectNoHorizontalOverflow, openWorkspace, taskCard, uniqueName } from './helpers';

test('classification controls, long names and management fit narrow phones in both themes', async ({ page }) => {
  await openWorkspace(page);
  const name = uniqueName('手机分类');
  await createTask(page, name, { target: 10 });
  await page.setViewportSize({ width: 320, height: 668 });
  const tabs = (await page.getByRole('group', { name: '筛选任务', exact: true }).boundingBox())!;
  const categoryButton = (await page.getByRole('button', { name: '筛选分类', exact: true }).boundingBox())!;
  expect(tabs.x + tabs.width).toBeLessThanOrEqual(categoryButton.x);
  for (const tab of await page.getByRole('group', { name: '筛选任务', exact: true }).getByRole('button').all()) {
    const box = (await tab.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(categoryButton.x);
  }
  await page.getByRole('button', { name: '筛选分类', exact: true }).click();
  await page.getByRole('menuitem', { name: '管理分类', exact: true }).click();
  const manager = page.getByRole('dialog', { name: '管理分类', exact: true });
  const category = '阅读学习与整理笔记的日常计划';
  await manager.getByLabel('分类名称', { exact: true }).fill(category);
  await manager.getByRole('button', { name: '添加', exact: true }).click();
  await expect(manager.getByRole('button', { name: `编辑分类${category}`, exact: true })).toBeEnabled();
  for (const dark of [false, true]) {
    await page.evaluate(value => document.documentElement.classList.toggle('dark', value), dark);
    await expectNoHorizontalOverflow(page);
    expect(await manager.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  }
  await manager.getByRole('button', { name: '关闭', exact: true }).click();
  const state = await page.request.get('/api/state', { headers: { 'X-Guest-Id': await page.evaluate(() => localStorage.getItem('pawnsteps-guest-id')!) } });
  const data = await state.json();
  await page.request.put(`/api/tasks/${data.tasks[0].id}/category`, { headers: { 'X-Guest-Id': await page.evaluate(() => localStorage.getItem('pawnsteps-guest-id')!) }, data: { category_id: data.categories[0].id } });
  await page.reload();
  await expect(taskCard(page, name).getByLabel(`分类：${category}`, { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
