import { expect, test, type Page } from '@playwright/test';
import { openWorkspace, persistedState, taskCard, uniqueName } from './helpers';

async function seed(page: Page, fields: Record<string, unknown> = {}) {
  await openWorkspace(page);
  const guest = await page.evaluate(() => localStorage.getItem('pawnsteps-guest-id')!);
  const name = typeof fields.name === 'string' ? fields.name : uniqueName('常用阅读配置');
  const headers = { 'X-Guest-Id': guest };
  const response = await page.request.post('/api/tasks', { headers, data: { name, target: 20, unit: '页', daily_minimum: 2, daily_goal: 5, stages: [{ value: 5, name: '第一阶段' }], ...fields } });
  expect(response.status()).toBe(201);
  const task = (await response.json()).tasks.find((row: { name: string }) => row.name === name);
  await page.reload();
  await expect(taskCard(page, name)).toBeVisible();
  return { task, headers };
}
async function saveTemplate(page: Page, task: { name: string }, name: string) {
  await taskCard(page, task.name).getByRole('button', { name: `任务操作：${task.name}`, exact: true }).click();
  await page.getByRole('menuitem', { name: '保存为模板', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '保存为模板', exact: true });
  await dialog.getByLabel('模板名称', { exact: true }).fill(name);
  await dialog.getByRole('button', { name: '保存模板', exact: true }).click();
  await expect(dialog).toBeHidden();
}
async function openPicker(page: Page) {
  await page.getByRole('button', { name: '添加任务', exact: true }).click();
  const form = page.getByRole('dialog', { name: '从一个小目标开始', exact: true });
  await form.getByRole('button', { name: '使用模板', exact: true }).click();
  const picker = page.getByRole('dialog', { name: '选择任务模板', exact: true });
  return { form, picker };
}

test('built-in reading fills goals and stages without creating anything until submitted', async ({ page }, testInfo) => {
  await openWorkspace(page);
  const { form, picker } = await openPicker(page);
  await expect(picker.getByRole('button', { name: '应用模板：阅读计划', exact: true })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('templates-builtins-light.png') });
  await picker.getByRole('button', { name: '应用模板：阅读计划', exact: true }).click();
  await expect(picker).toBeHidden();
  await expect(form.getByLabel('目标任务总量', { exact: false })).toHaveValue('100');
  await expect(form.getByLabel('最小完成量', { exact: true })).toHaveValue('5');
  await expect(form.getByLabel('每日目标量', { exact: true })).toHaveValue('10');
  await expect(form.getByLabel('计量单位', { exact: true })).toHaveValue('页');
  expect((await persistedState(page)).tasks.length).toBe(0);
  const name = uniqueName('套用阅读模板');
  await form.getByLabel('任务名称', { exact: true }).fill(name);
  await form.getByRole('button', { name: '创建任务', exact: true }).click();
  await expect(taskCard(page, name)).toBeVisible();
  const saved = (await persistedState(page)).tasks.find(row => row.name === name)!;
  expect(saved.progress).toBe(0); expect(saved.record_count).toBe(0);
  expect(saved.stages?.map(stage => stage.value)).toEqual([25, 50, 75, 100]);
});

test('custom template saves independently, suggests a distinct task name and resets recorded progress', async ({ page }) => {
  const { task, headers } = await seed(page);
  const record = await page.request.post(`/api/tasks/${task.id}/records`, { headers, data: { amount: 7 } });
  expect(record.status()).toBe(201);
  await page.reload();
  const templateName = uniqueName('工作日阅读');
  await saveTemplate(page, task, templateName);
  const { form, picker } = await openPicker(page);
  await picker.getByRole('button', { name: '我的模板', exact: true }).click();
  await picker.getByRole('button', { name: `应用模板：${templateName}`, exact: true }).click();
  const suggested = await form.getByLabel('任务名称', { exact: true }).inputValue();
  expect(suggested).not.toBe(task.name);
  await expect(form.getByLabel('目标任务总量', { exact: false })).toHaveValue('20');
  await form.getByRole('button', { name: '创建任务', exact: true }).click();
  await expect(taskCard(page, suggested)).toBeVisible();
  const state = await persistedState(page);
  expect(state.tasks.find(row => row.name === suggested)!.progress).toBe(0);
  expect(state.tasks.find(row => row.id === task.id)!.progress).toBe(7);
});

test('renaming, replacing and deleting templates retain tasks and update the picker', async ({ page }, testInfo) => {
  const { task, headers } = await seed(page);
  const initial = uniqueName('常用模板');
  await saveTemplate(page, task, initial);
  const { form, picker } = await openPicker(page);
  await picker.getByRole('button', { name: '我的模板', exact: true }).click();
  await picker.getByRole('button', { name: `模板操作：${initial}`, exact: true }).click();
  await page.getByRole('menuitem', { name: '重命名模板', exact: true }).click();
  const renamed = uniqueName('晨间阅读');
  await picker.getByLabel('新的模板名称', { exact: true }).fill(renamed);
  await picker.getByRole('button', { name: '保存名称', exact: true }).click();
  await expect(picker.getByRole('button', { name: `应用模板：${renamed}`, exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('templates-custom-light.png') });
  await picker.getByRole('button', { name: '关闭', exact: true }).click();
  await form.getByRole('button', { name: '取消', exact: true }).click();
  expect((await page.request.patch(`/api/tasks/${task.id}`, { headers, data: { target: 30, daily_goal: 6 } })).ok()).toBe(true);
  await page.reload();
  await taskCard(page, task.name).getByRole('button', { name: `任务操作：${task.name}`, exact: true }).click();
  await page.getByRole('menuitem', { name: '保存为模板', exact: true }).click();
  const save = page.getByRole('dialog', { name: '保存为模板', exact: true });
  const state = await persistedState(page);
  const template = state.templates!.find(row => row.name === renamed)!;
  await save.getByLabel('保存方式', { exact: true }).selectOption(template.id);
  await save.getByRole('button', { name: '更新模板', exact: true }).click();
  await expect(save).toBeHidden();
  const again = await openPicker(page);
  await again.picker.getByRole('button', { name: '我的模板', exact: true }).click();
  await expect(again.picker).toContainText('30 页');
  await again.picker.getByRole('button', { name: `模板操作：${renamed}`, exact: true }).click();
  await page.getByRole('menuitem', { name: '删除模板', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: '删除模板', exact: true });
  await confirmation.getByRole('button', { name: '删除模板', exact: true }).click();
  await expect(confirmation).toBeHidden();
  await expect(again.picker).toContainText('还没有自定义模板');
  expect((await persistedState(page)).tasks.length).toBe(1);
});

test('course templates bring an unchecked syllabus', async ({ page }) => {
  const { task, headers } = await seed(page, { name: uniqueName('课程配置'), daily_minimum: 1, daily_goal: 2, stages: [{ value: 1, name: '入门' }], course_items: [{ name: '第一章/' }, { name: '第一节' }, { name: '第二节' }] });
  expect((await page.request.post(`/api/tasks/${task.id}/course`, { headers, data: { indices: [1], done: true } })).ok()).toBe(true);
  await page.reload();
  const templateName = uniqueName('课程模板');
  await saveTemplate(page, task, templateName);
  const { form, picker } = await openPicker(page);
  await picker.getByRole('button', { name: '我的模板', exact: true }).click();
  await picker.getByRole('button', { name: `应用模板：${templateName}`, exact: true }).click();
  await expect(form).toContainText('2 节课程');
  const name = await form.getByLabel('任务名称', { exact: true }).inputValue();
  await form.getByRole('button', { name: '创建任务', exact: true }).click();
  const fresh = (await persistedState(page)).tasks.find(row => row.name === name)!;
  expect(fresh.progress).toBe(0); expect(fresh.course_items!.every(item => !item.done)).toBe(true);
});


test('legacy templates preserve an unset daily goal and a zero minimum', async ({ page }) => {
  const { task } = await seed(page, { daily_minimum: 0, daily_goal: null, stages: [] });
  const templateName = uniqueName('自由进度模板');
  await saveTemplate(page, task, templateName);
  const { form, picker } = await openPicker(page);
  await picker.getByRole('button', { name: '我的模板', exact: true }).click();
  await picker.getByRole('button', { name: `应用模板：${templateName}`, exact: true }).click();
  await expect(form.getByLabel('最小完成量', { exact: true })).toHaveValue('0');
  await expect(form.getByLabel('每日目标量', { exact: true })).toHaveValue('');
  const name = await form.getByLabel('任务名称', { exact: true }).inputValue();
  await form.getByRole('button', { name: '创建任务', exact: true }).click();
  const fresh = (await persistedState(page)).tasks.find(row => row.name === name)!;
  expect(fresh.daily_minimum).toBe(0); expect(fresh.daily_goal).toBeNull();
});
