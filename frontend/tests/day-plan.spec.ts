import { expect, test } from '@playwright/test';
import { openCourse, openWorkspace, taskCard, uniqueName } from './helpers';

async function seed(page: import('@playwright/test').Page, count = 4) {
  await openWorkspace(page);
  const guest = await page.evaluate(() => localStorage.getItem('pawnsteps-guest-id')!);
  const headers = { 'X-Guest-Id': guest };
  const tasks: { id: string; name: string }[] = [];
  for (let index = 0; index < count; index++) {
    const name = uniqueName(`计划任务${index + 1}`);
    const response = await page.request.post('/api/tasks', { headers, data: { name, target: index === 0 ? 1 : 20, unit: '个', daily_minimum: 1 } });
    expect(response.ok()).toBeTruthy(); tasks.push((await response.json()).tasks.find((item: { name: string }) => item.name === name));
  }
  await page.reload(); return { tasks, headers };
}
async function saved(page: import('@playwright/test').Page, headers: Record<string, string>) {
  const response = await page.request.get('/api/state', { headers }); expect(response.ok()).toBeTruthy(); return response.json();
}
async function choose(page: import('@playwright/test').Page, names: string[]) {
  await page.getByRole('button', { name: '调整今日计划', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '今天最重要的事', exact: true });
  for (const name of names) await dialog.getByRole('checkbox', { name: new RegExp(name) }).check();
  await dialog.getByRole('button', { name: '保存计划', exact: true }).click(); await expect(dialog).toBeHidden();
}

test('selection caps at three, preserves click order and reloads directly into today scope', async ({ page }) => {
  const { tasks, headers } = await seed(page);
  await page.getByRole('button', { name: '调整今日计划', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '今天最重要的事', exact: true });
  for (const index of [2, 0, 1]) await dialog.getByRole('checkbox', { name: new RegExp(tasks[index].name) }).check();
  await expect(dialog.getByRole('checkbox', { name: new RegExp(tasks[3].name) })).toBeDisabled();
  await expect(dialog).toContainText('已选 3 / 3 项');
  await dialog.getByRole('button', { name: '保存计划', exact: true }).click();
  await expect(page.getByRole('heading', { name: '今日计划', level: 1 })).toBeVisible();
  expect((await saved(page, headers)).today_plan.task_ids).toEqual([tasks[2].id, tasks[0].id, tasks[1].id]);
  await expect(page.locator('article.task-card')).toHaveCount(3);
  expect(await page.locator('article.task-card h3').allTextContents()).toEqual([tasks[2].name, tasks[0].name, tasks[1].name]);
  await page.reload(); await expect(page.getByRole('heading', { name: '今日计划', level: 1 })).toBeVisible();
  await expect(page.locator('article.task-card')).toHaveCount(3);
});

test('completion and undo retain selection; today task can start associated focus directly', async ({ page }) => {
  const { tasks, headers } = await seed(page, 2); await choose(page, tasks.map(task => task.name));
  await taskCard(page, tasks[0].name).getByRole('button', { name: `${tasks[0].name}增加1个`, exact: true }).click();
  await expect.poll(async () => (await saved(page, headers)).tasks.find((task: { id: string }) => task.id === tasks[0].id).is_done).toBeTruthy();
  await expect(page.locator('.today-plan-done').getByRole('heading', { name: '已完成', exact: true })).toBeVisible();
  expect((await saved(page, headers)).today_plan.task_ids).toEqual(tasks.map(task => task.id));
  await page.locator('[data-sonner-toast]').filter({ hasText: `已完成「${tasks[0].name}」` }).getByRole('button', { name: '撤销', exact: true }).click();
  await expect(taskCard(page, tasks[0].name).getByRole('button', { name: `${tasks[0].name}增加1个`, exact: true })).toBeVisible();
  await expect(taskCard(page, tasks[0].name).getByRole('button', { name: `任务操作：${tasks[0].name}`, exact: true })).toBeFocused();
  await taskCard(page, tasks[1].name).getByRole('button', { name: `${tasks[1].name}开始专注`, exact: true }).click();
  await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
  const focus = await page.request.get('/api/focus', { headers }); expect((await focus.json()).active_session.task_id).toBe(tasks[1].id);
});

test('deleting and undoing a selected task restores its slot, and clear affects only the plan', async ({ page }) => {
  const { tasks, headers } = await seed(page, 2); await choose(page, tasks.map(task => task.name));
  await taskCard(page, tasks[0].name).getByRole('button', { name: `任务操作：${tasks[0].name}`, exact: true }).click();
  await page.getByRole('menuitem', { name: `删除${tasks[0].name}`, exact: true }).click();
  await expect(taskCard(page, tasks[0].name)).toHaveCount(0);
  await page.locator('[data-sonner-toast]').filter({ hasText: '任务已删除' }).getByRole('button', { name: '撤销', exact: true }).click();
  await expect(taskCard(page, tasks[0].name)).toBeVisible();
  expect((await saved(page, headers)).today_plan.task_ids).toEqual(tasks.map(task => task.id));
  await page.getByRole('button', { name: '调整今日计划', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '今天最重要的事', exact: true });
  for (const task of tasks) await dialog.getByRole('checkbox', { name: new RegExp(task.name) }).uncheck();
  await dialog.getByRole('button', { name: '清空计划', exact: true }).click();
  await expect(page.getByRole('button', { name: '选择今日任务', exact: true })).toBeVisible();
  expect((await saved(page, headers)).tasks).toHaveLength(2); expect((await saved(page, headers)).today_plan.task_ids).toEqual([]);
});

test('today reorder remains scoped while its save is pending and never changes global positions', async ({ page }) => {
  const { tasks, headers } = await seed(page, 3); await choose(page, tasks.map(task => task.name));
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/day-plan', async route => { if (route.request().method() === 'PUT') await gate; await route.continue(); });
  try {
    const handle = taskCard(page, tasks[0].name).getByRole('button', { name: `拖动排序${tasks[0].name}`, exact: true });
    await handle.focus(); await page.keyboard.press('Space');
    await expect(handle).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('status')).toContainText(`droppable area ${tasks[0].id}`);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('status')).toContainText(`droppable area ${tasks[1].id}`);
    await page.keyboard.press('Space');
    await expect.poll(() => page.locator('article.task-card h3').allTextContents()).toEqual([tasks[1].name, tasks[0].name, tasks[2].name]);
    await page.getByRole('group', { name: '筛选任务', exact: true }).getByRole('button', { name: '全部', exact: true }).click();
    await expect.poll(() => page.locator('article.task-card h3').allTextContents()).toEqual(tasks.map(task => task.name));
  } finally { release(); }
  await expect.poll(async () => (await saved(page, headers)).today_plan.task_ids).toEqual([tasks[1].id, tasks[0].id, tasks[2].id]);
  expect((await saved(page, headers)).tasks.map((task: { id: string }) => task.id)).toEqual(tasks.map(task => task.id));
});

test('an open draft is discarded when the business date changes without writing to the new day', async ({ page }) => {
  const { tasks, headers } = await seed(page, 2); await choose(page, [tasks[0].name]);
  await page.getByRole('button', { name: '调整今日计划', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '今天最重要的事', exact: true });
  await dialog.getByRole('checkbox', { name: new RegExp(tasks[1].name) }).check();
  let writes = 0; page.on('request', request => { if (request.method() === 'PUT' && new URL(request.url()).pathname === '/api/day-plan') writes++; });
  await page.route('**/api/state', async route => {
    const response = await route.fetch(); const data = await response.json();
    const date = new Date(`${data.today}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + 1); const next = date.toISOString().slice(0, 10);
    await route.fulfill({ response, json: { ...data, today: next, today_plan: { date: next, task_ids: [] } } });
  });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(dialog).toBeHidden(); expect(writes).toBe(0);
  expect((await saved(page, headers)).today_plan.task_ids).toEqual([tasks[0].id]);
});

test('completed retained choices remain reversible and revalidate after another tab removes them', async ({ page }) => {
  const { tasks, headers } = await seed(page, 2); await choose(page, tasks.map(task => task.name));
  await taskCard(page, tasks[0].name).getByRole('button', { name: `${tasks[0].name}增加1个`, exact: true }).click();
  await expect(page.locator('.today-plan-done')).toBeVisible();
  await page.getByRole('button', { name: '调整今日计划', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '今天最重要的事', exact: true });
  const completed = dialog.getByRole('checkbox', { name: new RegExp(tasks[0].name) });
  await completed.uncheck(); await expect(completed).toBeEnabled(); await completed.check();
  const current = await saved(page, headers);
  expect((await page.request.put('/api/day-plan', { headers, data: { date: current.today, task_ids: [tasks[1].id] } })).ok()).toBeTruthy();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(dialog.getByRole('button', { name: '保存计划', exact: true })).toBeDisabled();
  await completed.click(); await expect(completed).toHaveCount(0);
  await dialog.getByRole('button', { name: '保存计划', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect((await saved(page, headers)).today_plan.task_ids).toEqual([tasks[1].id]);
});

test('an open draft preserves a selected task across deletion and undo in another tab', async ({ page }) => {
  const { tasks, headers } = await seed(page, 2); await choose(page, tasks.map(task => task.name));
  await page.getByRole('button', { name: '调整今日计划', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '今天最重要的事', exact: true });
  const deleted = await page.request.delete(`/api/tasks/${tasks[0].id}`, { headers }); expect(deleted.ok()).toBeTruthy();
  const { undo_token } = await deleted.json();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(dialog).toContainText('任务已删除');
  await expect(dialog.getByRole('button', { name: '保存计划', exact: true })).toBeDisabled();
  expect((await page.request.post('/api/tasks/undo', { headers, data: { token: undo_token } })).ok()).toBeTruthy();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(dialog.getByRole('checkbox', { name: new RegExp(tasks[0].name) })).toBeChecked();
  await expect(dialog.getByRole('button', { name: '保存计划', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: '保存计划', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect((await saved(page, headers)).today_plan.task_ids).toEqual(tasks.map(task => task.id));
});

for (const timing of ['confirmed', 'pending'] as const) {
  test(`a selected course returns keyboard focus when closed after ${timing} completion`, async ({ page }) => {
    const { tasks, headers } = await seed(page, 1), name = uniqueName('今日课程');
    const response = await page.request.post('/api/tasks', { headers, data: { name, course_items: [{ name: 'Lesson A' }, { name: 'Lesson B' }], daily_minimum: 1 } });
    expect(response.ok()).toBeTruthy(); await page.reload(); await choose(page, [tasks[0].name, name]);
    const drawer = await openCourse(page, name);
    await drawer.locator('[data-course-item]').nth(0).click();
    await expect(drawer.locator('.course-drawer-progress strong')).toHaveText('1 / 2 节');
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    if (timing === 'pending') await page.route('**/api/tasks/*/course', async route => { await gate; await route.continue(); });
    try {
      await drawer.locator('[data-course-item]').nth(1).click();
      await expect(drawer.getByRole('checkbox', { name: 'Lesson B', exact: true })).toBeChecked();
      if (timing === 'confirmed') await expect(drawer.locator('.course-drawer-progress')).toContainText('课程已完成');
      await page.keyboard.press('Escape'); await expect(drawer).toBeHidden();
      if (timing === 'pending') await expect(taskCard(page, name).getByRole('button', { name: `${name}继续学习`, exact: true })).toBeFocused();
      release();
      await expect(taskCard(page, name).getByRole('button', { name: `${name}查看课程`, exact: true })).toBeFocused();
    } finally { release(); }
  });
}
