import { expect, test, type Locator } from '@playwright/test';
import { navigate, openWorkspace, persistedState, taskCard, uniqueName } from './helpers';

async function weekdays(form: Locator, selected: number[]) {
  await form.getByLabel('执行周期', { exact: true }).selectOption('weekdays');
  const buttons = form.getByRole('group', { name: '执行星期' }).getByRole('button');
  for (let index = 0; index < 7; index++) {
    if ((await buttons.nth(index).getAttribute('aria-pressed') === 'true') !== selected.includes(index)) await buttons.nth(index).click();
  }
}

test('weekday rest tasks fold by default and frequency edits preserve today until tomorrow', async ({ page }) => {
  await openWorkspace(page);
  const today = (new Date(`${(await persistedState(page)).today}T12:00:00`).getDay() + 6) % 7;
  const name = uniqueName('休息日任务');
  await page.getByRole('button', { name: '添加任务', exact: true }).click();
  const form = page.getByRole('dialog');
  await form.getByLabel('任务名称', { exact: true }).fill(name);
  await weekdays(form, [(today + 1) % 7]);
  await form.getByRole('button', { name: '创建任务', exact: true }).click();
  await expect(form).toBeHidden();
  await expect(taskCard(page, name)).toHaveCount(0);
  await page.getByRole('textbox', { name: '搜索任务', exact: true }).fill(name);
  await expect(taskCard(page, name)).toBeVisible();
  await page.getByRole('button', { name: '今日休息的任务', exact: true }).click();
  await expect(taskCard(page, name)).toHaveCount(0);
  await page.getByRole('textbox', { name: '搜索任务', exact: true }).fill('');
  await page.getByRole('button', { name: '今日休息的任务', exact: true }).click();
  await expect(taskCard(page, name)).toContainText('今日休息');
  expect((await persistedState(page)).stats.today_total).toBe(0);
  await navigate(page, '打卡日历');
  await expect(page.locator('.calendar-day[aria-current="date"]')).toHaveClass(/is-rest/);
  await expect(page.locator('.calendar-day-detail')).toContainText('休息日，不计漏打卡');
  await navigate(page, '我的任务');
  await taskCard(page, name).getByRole('button', { name: `任务操作：${name}`, exact: true }).click();
  await page.getByRole('menuitem', { name: `编辑${name}`, exact: true }).click();
  await weekdays(form, [today]);
  await expect(form).toContainText('执行频率调整从明天生效');
  await form.getByRole('button', { name: '保存调整', exact: true }).click();
  await expect(form).toBeHidden();
  await expect(page.getByRole('button', { name: '今日休息的任务', exact: true })).toBeVisible();
  await expect(taskCard(page, name)).toBeVisible();
  expect((await persistedState(page)).stats.today_total).toBe(0);
  await page.reload();
  await page.getByRole('button', { name: '今日休息的任务', exact: true }).click();
  await taskCard(page, name).getByRole('button', { name: `任务操作：${name}`, exact: true }).click();
  await page.getByRole('menuitem', { name: `编辑${name}`, exact: true }).click();
  const days = form.getByRole('group', { name: '执行星期' }).getByRole('button');
  await expect(days.nth(today)).toHaveAttribute('aria-pressed', 'true');
  await expect(days.nth((today + 1) % 7)).toHaveAttribute('aria-pressed', 'false');
});

test('weekday shortcuts select exactly the workdays or weekend', async ({ page }) => {
  await openWorkspace(page);
  await page.getByRole('button', { name: '添加任务', exact: true }).click();
  const form = page.getByRole('dialog');
  await weekdays(form, [0]);
  const days = form.getByRole('group', { name: '执行星期' }).getByRole('button');
  for (const [label, selected] of [['周末', [5, 6]], ['工作日', [0, 1, 2, 3, 4]]] as const) {
    await form.getByRole('group', { name: '星期快捷选择' }).getByRole('button', { name: label, exact: true }).click();
    for (let index = 0; index < 7; index++) await expect(days.nth(index)).toHaveAttribute('aria-pressed', String((selected as readonly number[]).includes(index)));
  }
});

test('today picker prioritizes due tasks and allows voluntary work on a rest day', async ({ page }) => {
  await openWorkspace(page);
  const state = await persistedState(page);
  const day = (new Date(`${state.today}T12:00:00`).getDay() + 6) % 7;
  const headers = { 'X-Guest-Id': await page.evaluate(() => localStorage.getItem('pawnsteps-guest-id')!) };
  const restName = uniqueName('自愿推进'), dueName = uniqueName('今天执行');
  const restResponse = await page.request.post('/api/tasks', { headers, data: { name: restName, target: 20, daily_minimum: 2, schedule: { mode: 'weekdays', weekdays: [(day + 1) % 7] } } });
  expect(restResponse.ok()).toBeTruthy();
  const restTask = (await restResponse.json()).tasks.find((task: { name: string }) => task.name === restName);
  expect((await page.request.post('/api/tasks', { headers, data: { name: dueName, target: 20, daily_minimum: 2 } })).ok()).toBeTruthy();
  await page.reload();
  await page.getByRole('button', { name: '今日计划', exact: true }).click();
  await page.getByRole('button', { name: '选择今日任务', exact: true }).click();
  const form = page.getByRole('dialog');
  await expect(form.locator('.day-plan-option').first()).toContainText(dueName);
  const restOption = form.locator('.day-plan-option').filter({ hasText: restName });
  await expect(restOption).toContainText('今日休息，可自愿推进');
  await restOption.getByRole('checkbox').check();
  await form.getByRole('button', { name: '保存计划', exact: true }).click();
  await expect(form).toBeHidden();
  expect((await persistedState(page)).today_plan.task_ids).toEqual([restTask.id]);
});

test('weekly progress counts qualifying days rather than individual increments', async ({ page }) => {
  await openWorkspace(page);
  const name = uniqueName('每周计划');
  await page.getByRole('button', { name: '添加任务', exact: true }).click();
  const form = page.getByRole('dialog');
  await form.getByLabel('任务名称', { exact: true }).fill(name);
  await form.getByLabel('最小完成量', { exact: true }).fill('2');
  await form.getByLabel('执行周期', { exact: true }).selectOption('weekly');
  await form.getByLabel('每周达标天数', { exact: true }).selectOption('1');
  await form.getByRole('button', { name: '创建任务', exact: true }).click();
  await expect(form).toBeHidden();
  const card = taskCard(page, name);
  await card.getByRole('button', { name: `${name}增加1步`, exact: true }).click();
  await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
  await expect(card).toContainText('本周 0 / 1 天');
  await card.getByRole('button', { name: `${name}增加1步`, exact: true }).click();
  await expect(card).toContainText('本周 1 / 1 天');
  await card.getByRole('button', { name: `${name}增加1步`, exact: true }).click();
  await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '3');
  await expect(card).toContainText('本周 1 / 1 天');
  await page.reload();
  await expect(card).toContainText('本周 1 / 1 天');
});

test('flexible schedule forms stay within a small phone viewport and reject empty weekdays', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await openWorkspace(page);
  await page.getByRole('button', { name: '添加任务', exact: true }).click();
  const form = page.getByRole('dialog');
  await form.getByLabel('任务名称', { exact: true }).fill(uniqueName('手机周期'));
  await weekdays(form, []);
  await form.getByRole('button', { name: '创建任务', exact: true }).click();
  await expect(form.getByRole('alert')).toContainText('至少选择一天');
  await form.getByRole('group', { name: '执行星期' }).getByRole('button', { name: '周一', exact: true }).click();
  for (const kind of ['目标任务', '每日打卡', '课程学习']) {
    await form.getByRole('button', { name: kind, exact: true }).click();
    if (kind === '课程学习') await form.locator('input[type="file"][accept]').setInputFiles({ name: 'course.md', mimeType: 'text/markdown', buffer: Buffer.from('- A\n- B\n- C\n- D\n') });
    for (const mode of ['weekdays', 'weekly']) {
      await form.getByLabel('执行周期', { exact: true }).selectOption(mode);
      const size = await form.evaluate(element => ({ height: element.clientHeight, content: element.scrollHeight }));
      expect(size.content, `${kind} / ${mode} should fit`).toBeLessThanOrEqual(size.height);
    }
  }
  await form.screenshot({ path: '/tmp/pawnsteps-flexible-schedule-form.png' });
});

test('expanded rest tasks keep their new drag order while the save is pending', async ({ page }) => {
  await openWorkspace(page);
  const day = (new Date(`${(await persistedState(page)).today}T12:00:00`).getDay() + 6) % 7;
  const headers = { 'X-Guest-Id': await page.evaluate(() => localStorage.getItem('pawnsteps-guest-id')!) };
  const names = [uniqueName('休息排序一'), uniqueName('休息排序二')];
  for (const name of names) {
    const created = await page.request.post('/api/tasks', { headers, data: { name, target: 10, daily_minimum: 1, schedule: { mode: 'weekdays', weekdays: [(day + 1) % 7] } } });
    expect(created.ok()).toBeTruthy();
  }
  await page.reload();
  await page.getByRole('button', { name: '今日休息的任务', exact: true }).click();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let received = false;
  await page.route('**/api/tasks/reorder', async route => { received = true; await gate; await route.continue(); });
  const handle = (await taskCard(page, names[0]).getByRole('button', { name: `拖动排序${names[0]}`, exact: true }).boundingBox())!;
  const destination = (await taskCard(page, names[1]).boundingBox())!;
  const response = page.waitForResponse(result => result.url().endsWith('/api/tasks/reorder') && result.request().method() === 'POST');
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2, destination.y + destination.height - 10, { steps: 10 });
  await page.mouse.up();
  try {
    await expect.poll(() => received).toBe(true);
    await expect(page.getByRole('region', { name: '今日休息任务列表', exact: true }).getByRole('heading').first()).toHaveText(names[1]);
  } finally { release(); }
  expect((await response).ok()).toBeTruthy();
});
