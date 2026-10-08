import { expect, type Page } from '@playwright/test';
import type { MutationResponse } from '../lib/types';

export function uniqueName(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export async function openWorkspace(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '今天，也向前一步。' })).toBeVisible();
  await expect(page.getByRole('button', { name: '刷新进度', exact: true })).toBeEnabled();
  await expect(page.locator('.error-banner')).toHaveCount(0);
}

export async function navigate(page: Page, name: string) {
  const mobile = (page.viewportSize()?.width || 1440) < 768;
  await page.getByRole('navigation', { name: mobile ? '移动导航' : '主导航', exact: true }).getByRole('button', { name, exact: false }).click();
}

export function taskCard(page: Page, name: string) {
  return page.locator('article.task-card').filter({ has: page.getByRole('heading', { name, exact: true }) });
}

export async function createTask(page: Page, name: string, options: { kind?: 'normal' | 'daily' | 'plan'; target?: number; quota?: number; reward?: string; plan?: string } = {}) {
  await page.getByRole('button', { name: '添加任务', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '从一个小目标开始' });
  if (options.kind === 'daily') await dialog.getByRole('button', { name: /^每日打卡/ }).click();
  if (options.kind === 'plan') await dialog.getByRole('button', { name: /^天数计划/ }).click();
  await dialog.getByLabel('任务名称', { exact: true }).fill(name);
  if (options.target) await dialog.locator('#task-target').fill(String(options.target));
  if (options.quota) await dialog.getByLabel('每日配额', { exact: true }).fill(String(options.quota));
  if (options.plan) await dialog.getByLabel('每天的配额', { exact: true }).fill(options.plan);
  if (options.reward) await dialog.getByLabel('完成后的奖励', { exact: true }).selectOption({ label: options.reward });
  await dialog.getByRole('button', { name: '创建任务', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(taskCard(page, name)).toBeVisible();
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
  const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client + 1);
}
