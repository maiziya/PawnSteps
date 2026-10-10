import { expect, type Page } from '@playwright/test';
import { openWorkspace, taskCard, uniqueName } from './helpers';
import type { MutationResponse, Task } from '../lib/types';

export async function seedArchives(page: Page, count = 1, archived = false) {
  await openWorkspace(page);
  const headers = { 'X-Guest-Id': await page.evaluate(() => localStorage.getItem('pawnsteps-guest-id')!) };
  const tasks: Task[] = [];
  for (let index = 0; index < count; index++) {
    const name = uniqueName(index === 0 ? '阅读并整理今天的学习笔记与收获' : `归档目标${index + 1}`);
    const created = await page.request.post('/api/tasks', { headers, data: { name, target: 20, unit: '页', daily_goal: 5, daily_minimum: 2 } });
    expect(created.status()).toBe(201);
    const task = (await created.json() as MutationResponse).tasks.find(task => task.name === name)!;
    tasks.push(task);
    if (archived) expect((await page.request.post(`/api/tasks/${task.id}/archive`, { headers })).ok()).toBeTruthy();
  }
  await page.reload();
  return { headers, tasks };
}

export async function archiveCard(page: Page, task: Task) {
  await taskCard(page, task.name).getByRole('button', { name: `任务操作：${task.name}`, exact: true }).click();
  await page.getByRole('menuitem', { name: `归档${task.name}`, exact: true }).click();
  await expect(taskCard(page, task.name)).toHaveCount(0);
}

export function archivedRow(page: Page, task: Task) {
  return page.getByRole('article', { name: `归档任务 ${task.name}`, exact: true });
}

export async function cleanupArchiveGuest(page: Page) {
  const guest = await page.evaluate(() => localStorage.getItem('pawnsteps-guest-id')).catch(() => null);
  if (!guest) return;
  const headers = { 'X-Guest-Id': guest };
  const response = await page.request.get('/api/state', { headers });
  if (!response.ok()) return;
  const state: MutationResponse = await response.json();
  for (const task of [...state.tasks, ...(state.archived_tasks || [])]) {
    await page.request.delete(`/api/tasks/${task.id}`, { headers });
  }
}
