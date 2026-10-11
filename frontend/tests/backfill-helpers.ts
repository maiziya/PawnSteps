import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { expect } from '@playwright/test';
import { openWorkspace, persistedState, uniqueName } from './helpers';

export async function seedBackfill(page: import('@playwright/test').Page, course = false, fields: Record<string, unknown> = {}) {
  await openWorkspace(page);
  const guest = await page.evaluate(() => localStorage.getItem('pawnsteps-guest-id')!);
  const headers = { 'X-Guest-Id': guest };
  const name = uniqueName('补记测试');
  const response = await page.request.post('/api/tasks', { headers, data: { name, target: 10, unit: '页', daily_minimum: 2, daily_goal: 3, ...(course ? { course_items: [{ name: '基础/' }, { name: '第一节' }, { name: '第二节' }, { name: '第三节' }] } : {}), ...fields } });
  expect(response.status()).toBe(201);
  const task = (await response.json()).tasks.find((row: { name: string }) => row.name === name);
  execFileSync(path.resolve('../.venv/bin/python'), ['tests/seed_backfill_ui.py', guest, task.id], { cwd: path.resolve('../backend'), env: { ...process.env, PYTHONPATH: '.' } });
  await page.reload();
  const state = await persistedState(page);
  const yesterday = new Date(`${state.today}T12:00:00Z`); yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  return { task, headers, date: yesterday.toISOString().slice(0, 10), state };
}

