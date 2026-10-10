import { expect, test, type Page } from '@playwright/test';
import { expectNoHorizontalOverflow, openWorkspace, persistedState, taskCard, uniqueName } from './helpers';
import type { MutationResponse, Task } from '../lib/types';

test.use({ reducedMotion: 'no-preference' });
async function seed(page: Page, fields: Record<string, unknown> = {}) {
  await openWorkspace(page);
  const headers = { 'X-Guest-Id': await page.evaluate(() => localStorage.getItem('pawnsteps-guest-id')!) };
  const name = uniqueName('一页一页，读完这本书');
  const response = await page.request.post('/api/tasks', { headers, data: { name, target: 20, unit: '页', ...fields } });
  expect(response.status()).toBe(201);
  const task = (await response.json() as MutationResponse).tasks.find(task => task.name === name)!;
  await page.reload();
  await expect(taskCard(page, name)).toBeVisible();
  return task;
}
async function step(page: Page, task: Task, amount: number) {
  const response = page.waitForResponse(response => /\/api\/tasks\/[^/]+\/(records|decrement)$/.test(new URL(response.url()).pathname) && response.request().method() === 'POST');
  await taskCard(page, task.name).getByRole('button', { name: `${task.name}${amount < 0 ? '减少' : '增加'}${Math.abs(amount)}${task.unit}`, exact: true }).click();
  expect((await response).ok()).toBeTruthy();
}

test('confirmed steps animate new work; decrement has distinct feedback and reload never replays it', async ({ page }, testInfo) => {
  const task = await seed(page);
  const card = taskCard(page, task.name), meter = card.locator('.task-progress');
  await step(page, task, 5);
  await expect(meter).toHaveAttribute('data-feedback', 'step');
  await expect(meter.getByRole('status')).toHaveText('+5 页');
  await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '5');
  await expect(meter.locator('.task-progress-particles')).toHaveAttribute('data-kind', 'step');
  await expect(meter.locator('.task-progress-particles')).toHaveAttribute('aria-hidden', 'true');
  await expect.poll(async () => {
    const fill = (await meter.locator('.task-progress-fill').boundingBox())!;
    const track = (await meter.locator('.task-progress-track').boundingBox())!;
    return fill.width / track.width;
  }).toBeCloseTo(.25, 2);
  await expect(meter.locator('.task-progress-change')).toHaveCount(0);
  expect(await meter.locator('.task-progress-fill').evaluate(el => getComputedStyle(el).transitionDuration)).toContain('0.6s');
  await page.screenshot({ path: testInfo.outputPath('step-confirmed.png') });
  await step(page, task, -1);
  await expect(meter).toHaveAttribute('data-feedback', 'decrement');
  await expect(meter.getByRole('status')).toHaveText('−1 页');
  await expect(meter.locator('.task-progress-particles')).toHaveCount(0);
  await expect(meter.locator('.task-progress-fill')).toHaveAttribute('style', 'width: 20%;');
  expect((await persistedState(page)).tasks[0].progress).toBe(4);
  await page.reload();
  await expect(meter).toHaveAttribute('data-feedback', 'idle');
  await expect(meter.getByRole('status')).toHaveCount(0);
  await expect(meter.locator('.task-progress-particles')).toHaveCount(0);
  await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '4');
  await expect(meter.locator('.task-progress-change')).toHaveCount(0);
});

test('patterned progress stays proportional across screens and pointer actions never record progress', async ({ page }) => {
  const task = await seed(page, { target: 50 });
  const card = taskCard(page, task.name), meter = card.locator('.task-progress');
  await expect(meter).toHaveAttribute('data-design', 'pattern');
  await step(page, task, 1);
  await expect(meter.locator('.task-progress-fill')).toHaveAttribute('style', 'width: 2%;');
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(meter.locator('.task-progress-fill')).toHaveAttribute('style', 'width: 2%;');
  const rail = card.getByRole('progressbar');
  await rail.click({ position: { x: 80, y: 8 } });
  const box = (await rail.boundingBox())!;
  await page.mouse.move(box.x + 15, box.y + 8);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 10, box.y + 8, { steps: 4 });
  await page.mouse.up();
  await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
  expect((await persistedState(page)).tasks[0].record_count).toBe(1);
});

test('pending completion never celebrates; failure rolls back and confirmed completion offers animated feedback and undo', async ({ page }, testInfo) => {
  const task = await seed(page, { target: 5 });
  const card = taskCard(page, task.name), meter = card.locator('.task-progress');
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  await page.route('**/api/tasks/*/records', async route => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    if (++calls === 1) { await hold; await route.fulfill({ status: 503, json: { detail: '测试保存失败' } }); }
    else await route.continue();
  });
  await card.getByRole('button', { name: `${task.name}增加5页`, exact: true }).click();
  try {
    await expect(meter).toHaveAttribute('data-feedback', 'pending');
    await expect(meter.getByRole('status')).toHaveText('保存中');
    await expect(card).not.toHaveClass(/is-celebrating/);
    await expect(meter).not.toHaveClass(/is-met/);
    await expect(page.locator('.task-completion-toast')).toHaveCount(0);
    await expect(meter.locator('.task-progress-particles')).toHaveCount(0);
  } finally { release(); }
  await expect(meter).toHaveAttribute('data-feedback', 'failed');
  await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  await expect(meter.getByRole('status')).toHaveText('待确认 · 可重试');
  await expect(meter.locator('.task-progress-particles')).toHaveCount(0);
  await step(page, task, 5);
  await expect(card).toHaveClass(/is-celebrating/);
  await expect(meter).toHaveAttribute('data-feedback', 'complete');
  await expect(meter.getByRole('status')).toHaveText('目标完成');
  await expect(meter.locator('.task-progress-particles')).toHaveAttribute('data-kind', 'complete');
  const completed = page.locator('.task-completion-toast').filter({ hasText: `已完成「${task.name}」` });
  await expect(completed.locator('.completion-mark.is-celebrating')).toHaveCount(1);
  await expect(completed).toContainText('+100 XP');
  await page.screenshot({ path: testInfo.outputPath('completion-feedback.png') });
  await completed.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  await expect(card).not.toHaveClass(/is-celebrating/);
  await expect(card.locator('.task-progress-particles')).toHaveCount(0);
  expect((await persistedState(page)).stats.xp).toBe(0);
  const revoked = page.locator('[data-sonner-toast]').filter({ hasText: '已撤回最后一笔记录' });
  await expect(revoked).toBeVisible();
  expect(await revoked.innerText()).not.toContain('+100 XP');
});

test('minimum and goal stay distinct; extra work updates the counter without repeating the daily achievement', async ({ page }, testInfo) => {
  const task = await seed(page, { target: 3, daily_quota: 3, daily_goal: 8 });
  const card = taskCard(page, task.name), meter = card.locator('.task-progress');
  await expect(meter.locator('.task-progress-minimum')).toHaveAttribute('title', '最小完成量 3 页');
  await step(page, task, 5);
  await expect(meter).toHaveAttribute('data-feedback', 'daily');
  await expect(meter).toHaveClass(/is-met/);
  await expect(meter.getByRole('status')).toHaveText('今日达标');
  await expect(meter.locator('.task-progress-particles')).toHaveAttribute('data-kind', 'daily');
  await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '5');
  await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuemax', '8');
  await page.screenshot({ path: testInfo.outputPath('daily-minimum-met.png') });
  await step(page, task, 5);
  await expect(meter).toHaveAttribute('data-feedback', 'step');
  await expect(meter.getByRole('status')).toHaveText('+5 页');
  await expect(meter.locator('.task-progress-particles')).toHaveAttribute('data-kind', 'step');
  await expect(meter.locator('.task-progress-counter')).toHaveAttribute('aria-label', '10 / 8 页');
  expect((await persistedState(page)).tasks[0].progress).toBe(1);
  await expect(page.locator('.task-completion-toast')).toHaveCount(0);
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });
  test('keeps confirmation and completion feedback while removing movement', async ({ page }) => {
    const task = await seed(page, { target: 1 });
    await step(page, task, 1);
    const card = taskCard(page, task.name);
    await expect(card.locator('.task-progress')).toHaveAttribute('data-motion', 'reduced');
    await expect(card.locator('.task-progress').getByRole('status')).toHaveText('目标完成');
    await expect(card.locator('.task-progress-particles')).toHaveCount(0);
    const animations = await card.locator('.task-progress, .completion-mark').evaluateAll(elements => elements.flatMap(element => element.getAnimations({ subtree: true })).filter(animation => animation.playState === 'running').length);
    expect(animations).toBe(0);
    await expect(page.locator('.task-completion-toast').getByRole('button', { name: '撤销', exact: true })).toBeVisible();
  });
});

test('completion particles fit a narrow phone and disappear after feedback expires', async ({ page }) => {
  const task = await seed(page, { target: 1 });
  await page.setViewportSize({ width: 320, height: 812 });
  await step(page, task, 1);
  const particles = taskCard(page, task.name).locator('.task-progress-particles');
  await expect(particles).toHaveAttribute('data-kind', 'complete');
  expect(await particles.evaluate(el => getComputedStyle(el).pointerEvents)).toBe('none');
  await particles.evaluate(el => {
    for (const animation of el.getAnimations({ subtree: true })) {
      animation.pause();
      animation.currentTime = 400;
    }
  });
  await expectNoHorizontalOverflow(page);
  await expect(page.locator('.task-progress-particles')).toHaveCount(0);
  expect((await persistedState(page)).stats.xp).toBe(100);
});

test('course checklist completion uses the same feedback and does not celebrate a loaded completed course', async ({ page }) => {
  const task = await seed(page, { course_items: [{ name: '章节/', done: false }, { name: '第一节', done: false }, { name: '第二节', done: false }] });
  await taskCard(page, task.name).getByRole('button', { name: `${task.name}继续学习`, exact: true }).click();
  const drawer = page.getByRole('dialog', { name: task.name, exact: true });
  await drawer.locator('[data-course-item="1"]').click();
  await expect(drawer.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
  await expect(drawer.locator('.task-progress').getByRole('status')).toHaveText('+1 节');
  await drawer.locator('[data-course-item="2"]').click();
  await expect(drawer.locator('.task-progress')).toHaveAttribute('data-feedback', 'complete');
  await expect(drawer.locator('.task-progress').getByRole('status')).toHaveText('目标完成');
  expect((await persistedState(page)).stats.xp).toBe(100);
  await expect(drawer.locator('.task-progress-sweep')).toHaveCount(1);
  await page.reload();
  await page.getByRole('button', { name: '已完成', exact: true }).click();
  await expect(taskCard(page, task.name).locator('.task-progress')).toHaveAttribute('data-feedback', 'idle');
  await expect(page.locator('.task-completion-toast')).toHaveCount(0);
});

test('expanding a completed goal retains actual work and never presents the recalculated total as a new step', async ({ page }) => {
  const task = await seed(page, { target: 3 });
  await step(page, task, 5);
  await page.getByRole('button', { name: '已完成', exact: true }).click();
  const card = taskCard(page, task.name);
  await expect(card).toHaveCount(1);
  await expect(card.locator('.task-progress')).toHaveAttribute('data-feedback', 'idle');
  await card.getByRole('button', { name: `任务操作：${task.name}`, exact: true }).click();
  await page.getByRole('menuitem', { name: `编辑${task.name}`, exact: true }).click();
  const form = page.getByRole('dialog');
  await form.locator('#task-target').fill('8');
  await form.getByRole('button', { name: '保存调整', exact: true }).click();
  await expect(form).toBeHidden();
  await page.getByRole('button', { name: '全部', exact: true }).click();
  await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '5');
  await expect(card.locator('.task-progress')).toHaveAttribute('data-feedback', 'idle');
  await expect(card.locator('.task-progress').getByRole('status')).toHaveCount(0);
  expect((await persistedState(page)).tasks[0].record_count).toBe(1);
});
