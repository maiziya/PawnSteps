import { expect, test, type Page } from '@playwright/test';
import { navigate, openCourse, openWorkspace, persistedState, taskCard, uniqueName } from './helpers';

async function courseForm(page: Page, name: string) {
  await page.getByRole('button', { name: '添加任务', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '从一个小目标开始', exact: true });
  await dialog.getByRole('button', { name: '课程学习', exact: true }).click();
  await dialog.getByLabel('任务名称', { exact: true }).fill(name);
  await dialog.locator('input[type="file"][accept]').setInputFiles({
    name: 'course.md', mimeType: 'text/markdown',
    buffer: Buffer.from('### Lessons\n' + Array.from({ length: 6 }, (_, i) => `- Lesson ${i + 1}`).join('\n')),
  });
  return dialog;
}

test('course daily minimum and goal persist, qualify a check-in, and can be disabled', async ({ page }) => {
  await openWorkspace(page);
  const name = uniqueName('课程每日计划');
  const form = await courseForm(page, name);
  await expect(form.getByRole('checkbox', { name: '每日学习计划', exact: true })).toBeChecked();
  await form.getByLabel('最小完成量', { exact: true }).fill('2');
  await form.getByLabel('每日目标量', { exact: true }).fill('3');
  await form.getByRole('button', { name: '创建任务', exact: true }).click();
  await expect(form).toBeHidden();
  const drawer = await openCourse(page, name);
  await expect(drawer.locator('.course-daily-summary')).toHaveText('今日 0 / 3 节');
  await drawer.locator('[data-course-item]').nth(0).click();
  await expect(drawer.locator('.course-daily-summary')).toHaveText('今日 1 / 3 节');
  expect((await persistedState(page)).stats.streak).toBe(0);
  await drawer.locator('[data-course-item]').nth(1).click();
  await expect(drawer.locator('.course-daily-summary')).toHaveText('今日 2 / 3 节 · 已达标');
  const state = await persistedState(page);
  const task = state.tasks.find(item => item.name === name)!;
  expect({ target: task.target, progress: task.progress, minimum: task.daily_minimum, goal: task.daily_goal }).toEqual({ target: 6, progress: 2, minimum: 2, goal: 3 });
  expect(state.stats.streak).toBe(1);
  await drawer.getByRole('button', { name: '返回任务列表', exact: true }).click();
  await navigate(page, '打卡日历');
  await expect(page.locator('.calendar-day-detail')).toContainText('完成 2 / 2 节 · 已达标');
  await navigate(page, '我的步履');
  await taskCard(page, name).getByRole('button', { name: `任务操作：${name}`, exact: true }).click();
  await page.getByRole('menuitem', { name: `编辑${name}`, exact: true }).click();
  const edit = page.getByRole('dialog', { name: '调整你的目标', exact: true });
  await expect(edit.getByLabel('每日目标量', { exact: true })).toHaveValue('3');
  await edit.getByLabel('最小完成量', { exact: true }).fill('');
  await edit.getByRole('checkbox', { name: '每日学习计划', exact: true }).uncheck();
  await edit.getByRole('button', { name: '保存调整', exact: true }).click();
  await expect(edit).toBeHidden();
  const disabled = (await persistedState(page)).tasks.find(item => item.id === task.id)!;
  expect(disabled.progress).toBe(2);
  expect(disabled.daily_minimum).toBe(0);
  expect(disabled.daily_goal).toBeNull();
});

test('opening a long course locates the next lesson without moving during completion', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 720 });
  await openWorkspace(page);
  const name = uniqueName('继续长课程');
  const headers = { 'X-Guest-Id': await page.evaluate(() => localStorage.getItem('pawnsteps-guest-id')!) };
  const items = ['A', 'B', 'C'].flatMap(group => [{ name: `${group}/` }, ...Array.from({ length: 40 }, (_, i) => ({ name: `${group}${i + 1}` }))]);
  const nextIndex = items.findIndex(item => item.name === 'B35');
  const created = await page.request.post('/api/tasks', { headers, data: { name, course_items: items, daily_minimum: 1, daily_goal: 3 } });
  expect(created.ok()).toBeTruthy();
  const task = (await created.json()).tasks.find((item: { name: string }) => item.name === name);
  const marked = await page.request.post(`/api/tasks/${task.id}/course`, { headers, data: { indices: items.flatMap((item, index) => index < nextIndex && !item.name.endsWith('/') ? [index] : []), done: true } });
  expect(marked.ok()).toBeTruthy();
  await page.reload();
  const drawer = await openCourse(page, name);
  const scroller = drawer.locator('.course-drawer-body');
  const next = drawer.locator(`[data-course-item="${nextIndex}"]`);
  await expect(next).toBeInViewport({ ratio: 1 });
  expect(await scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  const before = await scroller.evaluate(element => element.scrollTop);
  await next.click();
  await expect(next).toHaveAttribute('data-completed', 'true');
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(before);
  await scroller.evaluate(element => { element.scrollTop = 0; });
  await drawer.getByRole('button', { name: /^B\s/ }).click();
  await drawer.getByRole('button', { name: '定位下一节', exact: true }).press('Enter');
  await expect(drawer.getByRole('checkbox', { name: 'B36', exact: true })).toBeFocused();
  await expect(drawer.locator(`[data-course-item="${nextIndex + 1}"]`)).toBeInViewport({ ratio: 1 });
});

test('course creation with a daily plan fits a small phone screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await openWorkspace(page);
  const form = await courseForm(page, uniqueName('手机课程计划'));
  await expect(form.getByLabel('最小完成量', { exact: true })).toBeVisible();
  await expect(form.getByLabel('每日目标量', { exact: true })).toHaveValue('3');
  const size = await form.evaluate(element => ({ height: element.clientHeight, content: element.scrollHeight, width: element.clientWidth, contentWidth: element.scrollWidth }));
  expect(size.content).toBeLessThanOrEqual(size.height);
  expect(size.contentWidth).toBeLessThanOrEqual(size.width);
  await form.screenshot({ path: '/tmp/pawnsteps-course-plan-form.png' });
});
