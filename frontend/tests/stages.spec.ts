import { expect, test, type Page } from '@playwright/test';
import { seedBackfill } from './backfill-helpers';
import { navigate, openCourse, openRecords, openWorkspace, persistedState, taskCard, uniqueName, expectNoHorizontalOverflow } from './helpers';

async function seed(page: Page, data: Record<string, unknown> = {}) {
  await openWorkspace(page);
  const guest = await page.evaluate(() => localStorage.getItem('pawnsteps-guest-id')!);
  const name = uniqueName('分阶段读完一本书');
  const response = await page.request.post('/api/tasks', { headers: { 'X-Guest-Id': guest }, data: { name, target: 20, unit: '页', stages: [{ value: 1, name: '翻开第一页' }, { value: 3, name: '渐入佳境' }, { value: 5, name: '建立节奏' }, { value: 20, name: '完成任务' }], ...data } });
  expect(response.status()).toBe(201);
  const task = (await response.json()).tasks.find((row: { name: string }) => row.name === name);
  await page.reload();
  await expect(taskCard(page, name)).toBeVisible();
  return task;
}

async function step(page: Page, name: string, amount: number, unit = '页') {
  const response = page.waitForResponse(response => new URL(response.url()).pathname.endsWith(amount < 0 ? '/decrement' : '/records') && response.request().method() === 'POST');
  await taskCard(page, name).getByRole('button', { name: `${name}${amount < 0 ? '减少' : '增加'}${Math.abs(amount)}${unit}`, exact: true }).click();
  expect((await response).ok()).toBe(true);
}


test('create configures stages in a compact editor, saves names and keeps the next stage visible', async ({ page }, testInfo) => {
  await openWorkspace(page);
  const name = uniqueName('分阶段阅读');
  await page.getByRole('button', { name: '添加任务', exact: true }).click();
  const form = page.getByRole('dialog', { name: '从一个小目标开始', exact: true });
  await form.getByLabel('任务名称', { exact: true }).fill(name);
  await form.getByLabel('目标任务总量', { exact: false }).fill('20');
  await form.getByLabel('计量单位', { exact: true }).selectOption('页');
  await form.locator('.task-course-options>summary').click();
  await form.getByRole('button', { name: '配置阶段', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '阶段目标', exact: true });
  await editor.getByRole('button', { name: '均分四阶段', exact: true }).click();
  await expect(editor.getByLabel('阶段 1 节点', { exact: true })).toHaveValue('5');
  await expect(editor.getByLabel('阶段 4 节点', { exact: true })).toHaveValue('20');
  await editor.getByLabel('阶段 1 名称', { exact: true }).fill('开始阅读');
  await page.screenshot({ path: testInfo.outputPath('stage-editor-light.png') });
  await editor.getByRole('button', { name: '保存阶段', exact: true }).click();
  await expect(editor).toBeHidden();
  await expect(form).toBeVisible();
  await form.getByRole('button', { name: '创建任务', exact: true }).click();
  const card = taskCard(page, name);
  await expect(card.locator('.task-stage-summary')).toContainText('下一阶段 · 开始阅读');
  await expect(card.locator('.task-stage-summary')).toContainText('还差 5 页');
  expect((await persistedState(page)).tasks.find(row => row.name === name)!.stages?.length).toBe(4);
  await step(page, name, 5);
  await expect(card.locator('.task-stage-summary')).toHaveClass(/is-celebrating/);
  await expect(card.locator('.task-stage-summary')).toContainText('已达成 · 开始阅读');
  await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '5');
  await expect(card.locator('.task-progress-stage-tick')).toHaveCount(3);
  await page.screenshot({ path: testInfo.outputPath('stage-card-light.png') });
  await page.reload();
  await expect(card.locator('.task-stage-summary')).not.toHaveClass(/is-celebrating/);
  await expect(card.locator('.task-stage-summary')).toContainText('下一阶段 · 完成一半');
  await page.getByRole('button', { name: '切换暗色模式', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('stage-card-dark.png') });
});

test('one step crossing multiple stages gives one feedback, undo recalculates and editing reached stages never celebrates', async ({ page }) => {
  const task = await seed(page);
  const card = taskCard(page, task.name), summary = card.locator('.task-stage-summary');
  await step(page, task.name, 5);
  await expect(summary).toContainText('达成 3 个阶段');
  const state = await persistedState(page);
  expect(state.tasks.find(row => row.id === task.id)!.stage_progress?.completed).toBe(3);
  expect(state.stats.xp).toBe(0);
  await step(page, task.name, -1);
  await expect(summary).not.toHaveClass(/is-celebrating/);
  await expect(summary).toContainText('下一阶段 · 建立节奏');
  await expect(summary).toContainText('还差 1 页');
  await card.getByRole('button', { name: `任务操作：${task.name}`, exact: true }).click();
  await page.getByRole('menuitem', { name: `编辑${task.name}`, exact: true }).click();
  const form = page.getByRole('dialog', { name: '调整你的目标', exact: true });
  await form.locator('.task-course-options>summary').click();
  await form.getByRole('button', { name: '调整阶段', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '阶段目标', exact: true });
  await editor.getByLabel('阶段 3 节点', { exact: true }).fill('4');
  await editor.getByRole('button', { name: '保存阶段', exact: true }).click();
  await form.getByRole('button', { name: '保存调整', exact: true }).click();
  await expect(summary).not.toHaveClass(/is-celebrating/);
  await expect(summary).toContainText('下一阶段 · 完成任务');
});

test('editor rejects duplicate or out-of-range values and cancel preserves the saved stages', async ({ page }) => {
  const task = await seed(page);
  await taskCard(page, task.name).getByRole('button', { name: `任务操作：${task.name}`, exact: true }).click();
  await page.getByRole('menuitem', { name: `编辑${task.name}`, exact: true }).click();
  const form = page.getByRole('dialog', { name: '调整你的目标', exact: true });
  await form.locator('.task-course-options>summary').click();
  await form.getByRole('button', { name: '调整阶段', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '阶段目标', exact: true });
  await editor.getByLabel('阶段 2 节点', { exact: true }).fill('1');
  await editor.getByRole('button', { name: '保存阶段', exact: true }).click();
  await expect(editor.getByRole('alert')).toHaveText('阶段节点不能重复。');
  await editor.getByLabel('阶段 2 节点', { exact: true }).fill('21');
  await editor.getByRole('button', { name: '保存阶段', exact: true }).click();
  await expect(editor.getByRole('alert')).toContainText('不能超过总目标');
  await editor.getByRole('button', { name: '取消', exact: true }).click();
  await form.getByRole('button', { name: '保存调整', exact: true }).click();
  expect((await persistedState(page)).tasks.find(row => row.id === task.id)!.stages?.map(stage => stage.value)).toEqual([1, 3, 5, 20]);
});

test('daily stages use achieved days, not today’s quantity or its meter scale', async ({ page }) => {
  const task = await seed(page, { target: 3, daily_quota: 2, stages: [{ value: 1, name: '第一天' }, { value: 3, name: '完成坚持' }] });
  await step(page, task.name, 1);
  await expect(taskCard(page, task.name).locator('.task-stage-summary')).toContainText('还差 1 天');
  await step(page, task.name, 1);
  await expect(taskCard(page, task.name).locator('.task-stage-summary')).toContainText('已达成 · 第一天');
  await expect(taskCard(page, task.name).locator('.task-stage-summary')).toContainText('还差 2 天');
  await expect(taskCard(page, task.name).locator('.task-progress-stage-tick')).toHaveCount(0);
});

test('course drawer reflects stages and clearing a lesson reverses the reached state', async ({ page }) => {
  const task = await seed(page, { stages: [{ value: 1, name: '入门' }, { value: 2, name: '学完课程' }], course_items: [{ name: '基础/' }, { name: '第一节' }, { name: '第二节' }] });
  const drawer = await openCourse(page, task.name);
  await drawer.locator('[data-course-item="1"]').click();
  const summary = drawer.locator('.task-stage-summary');
  await expect(summary).toContainText('已达成 · 入门');
  await expect(summary).toContainText('还差 1 节');
  await drawer.locator('[data-course-item="1"]').click();
  await expect(summary).not.toHaveClass(/is-celebrating/);
  await expect(summary).toContainText('下一阶段 · 入门');
  await expectNoHorizontalOverflow(page);
});


test('backfilling a daily achievement celebrates its cumulative stage while today remains empty', async ({ page }) => {
  const { task, date } = await seedBackfill(page, false, { target: 3, daily_quota: 2, daily_minimum: 0, stages: [{ value: 1, name: '第一天' }, { value: 3, name: '完成坚持' }] });
  const dialog = await openRecords(page, task.name);
  await dialog.getByLabel('完成日期', { exact: true }).fill(date);
  await dialog.getByLabel('本次完成量', { exact: true }).fill('5');
  await dialog.getByRole('button', { name: '保存补记', exact: true }).click();
  await expect(dialog.locator('.record-day-summary')).toContainText('5 页');
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  const card = taskCard(page, task.name);
  await expect(card.locator('.task-stage-summary')).toContainText('已达成 · 第一天');
  await expect(card.locator('.task-stage-summary')).toContainText('还差 2 天');
  await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  await page.reload();
  await expect(card.locator('.task-stage-summary')).not.toHaveClass(/is-celebrating/);
  await expect(card.locator('.task-stage-summary')).toContainText('下一阶段 · 完成坚持');
});
