import { expect, type Page } from '@playwright/test';
import type { MutationResponse } from '../lib/types';

export function uniqueName(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export async function openWorkspace(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '我的任务', level: 1, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '刷新进度', exact: true })).toBeEnabled();
  await expect(page.locator('.error-banner')).toHaveCount(0);
}

export async function navigate(page: Page, name: string) {
  const mobile = (page.viewportSize()?.width || 1440) < 768;
  await page.getByRole('navigation', { name: mobile ? '移动导航' : '主导航', exact: true }).getByRole('button', { name, exact: false }).click();
}

export function taskCard(page: Page, name: string) {
  return page.locator('article.task-card').filter({ has: page.getByRole('heading', { name, exact: true, includeHidden: true }) });
}

export async function createTask(page: Page, name: string, options: { kind?: 'normal' | 'daily' | 'plan'; target?: number; quota?: number; reward?: string; plan?: string; description?: string; unit?: string } = {}) {
  await page.getByRole('button', { name: '添加任务', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '从一个小目标开始' });
  if (options.kind === 'daily') await dialog.getByRole('button', { name: /^每日打卡/ }).click();
  if (options.kind === 'plan') await dialog.getByRole('button', { name: /^天数计划/ }).click();
  await dialog.getByLabel('任务名称', { exact: true }).fill(name);
  if (options.description) await dialog.locator('#task-description').fill(options.description);
  if (options.target) await dialog.locator('#task-target').fill(String(options.target));
  if (options.unit) await dialog.getByLabel('计量单位', { exact: true }).selectOption({ label: options.unit });
  if (options.quota) await dialog.getByLabel('最小完成量', { exact: true }).fill(String(options.quota));
  if (options.plan) await dialog.getByLabel('每天的配额', { exact: true }).fill(options.plan);
  if (options.reward) await dialog.getByLabel('完成后的奖励', { exact: true }).selectOption({ label: options.reward });
  await dialog.getByRole('button', { name: '创建任务', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(taskCard(page, name)).toBeVisible();
}

export async function openRecords(page: Page, name: string) {
  const card = taskCard(page, name);
  await card.getByRole('button', { name: `${name}查看记录`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `记录进度 · ${name}`, exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

export async function recordProgress(page: Page, name: string, amount: number, note = '') {
  const dialog = await openRecords(page, name);
  await dialog.getByLabel(/^本次完成量/).fill(String(amount));
  await dialog.getByLabel(/^备注/).fill(note);
  const response = page.waitForResponse(result => result.request().method() === 'POST' && /\/api\/tasks\/[^/]+\/records$/.test(new URL(result.url()).pathname));
  await dialog.getByRole('button', { name: '保存记录', exact: true }).click();
  const saved = await response;
  expect(saved.status()).toBe(201);
  const payload: MutationResponse = await saved.json();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('article', { name: `进度记录 ${payload.record!.id}`, exact: true }).getByRole('button', { name: '编辑记录', exact: true })).toBeEnabled();
  return dialog;
}

export async function showCompletedTasks(page: Page) {
  const toggle = page.getByRole('button', { name: '已完成任务', exact: true });
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  await expect(page.getByRole('region', { name: '已完成任务列表', exact: true })).toBeVisible();
}

export async function openCourse(page: Page, name: string) {
  await taskCard(page, name).getByRole('button', { name: `${name}继续学习`, exact: true }).click();
  const drawer = page.getByRole('dialog', { name, exact: true });
  await expect(drawer).toBeVisible();
  return drawer;
}

export async function persistedState(page: Page): Promise<MutationResponse> {
  const headers = await page.evaluate(() => {
    const token = localStorage.getItem('pawnsteps-token');
    return { 'X-Guest-Id': localStorage.getItem('pawnsteps-guest-id') || '', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  });
  const response = await page.request.get('/api/state', { headers });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

export async function expectNoHorizontalOverflow(page: Page) {
  await expect.poll(async () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), {
    message: 'Responsive content should fit the viewport after layout transitions settle',
  }).toBeLessThanOrEqual(1);
}
