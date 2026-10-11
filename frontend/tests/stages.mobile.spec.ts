import { expect, test } from '@playwright/test';
import { openWorkspace, expectNoHorizontalOverflow, taskCard, uniqueName } from './helpers';

test('long stage names fit a narrow card and the six-stage editor without horizontal overflow', async ({ page }, testInfo) => {
  await openWorkspace(page);
  const guest = await page.evaluate(() => localStorage.getItem('pawnsteps-guest-id')!);
  const name = uniqueName('移动端阶段测试');
  const response = await page.request.post('/api/tasks', { headers: { 'X-Guest-Id': guest }, data: { name, target: 100, unit: '页', stages: [10, 20, 30, 50, 70, 100].map(value => ({ value, name: '读完当前章节并整理自己的学习笔记与下一阶段计划' })) } });
  expect(response.status()).toBe(201);
  await page.reload();
  await expect(taskCard(page, name)).toBeVisible();
  await page.setViewportSize({ width: 320, height: 740 });
  await expectNoHorizontalOverflow(page);
  await taskCard(page, name).getByRole('button', { name: `任务操作：${name}`, exact: true }).click();
  await page.getByRole('menuitem', { name: `编辑${name}`, exact: true }).click();
  const form = page.getByRole('dialog', { name: '调整你的目标', exact: true });
  await form.locator('.task-course-options>summary').click();
  await form.getByRole('button', { name: '调整阶段', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '阶段目标', exact: true });
  await expect(editor.getByLabel('阶段 6 节点', { exact: true })).toHaveValue('100');
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('stage-editor-phone.png') });
  await editor.getByRole('button', { name: '保存阶段', exact: true }).click();
  await form.getByRole('button', { name: '保存调整', exact: true }).click();
  await expect(taskCard(page, name).locator('.task-stage-summary')).toContainText('还差 10 页');
});
