import { expect, test, type Page } from '@playwright/test';
import { createTask, navigate, openRecords, openWorkspace, persistedState, showCompletedTasks, taskCard, uniqueName } from './helpers';
import type { MutationResponse } from '../lib/types';

async function quickAdd(page: Page, name: string, amount: number, unit = '页') {
  const response = page.waitForResponse(result => result.request().method() === 'POST' && /\/api\/tasks\/[^/]+\/(records|decrement)$/.test(new URL(result.url()).pathname));
  await taskCard(page, name).getByRole('button', { name: `${name}${amount < 0 ? '减少' : '增加'}${Math.abs(amount)}${unit}`, exact: true }).click();
  const saved = await response;
  expect(saved.status()).toBe(amount < 0 ? 200 : 201);
  return await saved.json() as MutationResponse;
}

async function addLinkedReward(page: Page, name: string) {
  await navigate(page, '心愿奖励');
  await page.getByRole('button', { name: '添加奖励', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '添加一个小期待', exact: true });
  await dialog.getByLabel('奖励名称', { exact: true }).fill(name);
  await dialog.getByRole('button', { name: '添加奖励', exact: true }).click();
  await expect(dialog).toBeHidden();
  await navigate(page, '我的任务');
}

test('card increments save separate records without opening a dialog and survive reload', async ({ page }) => {
  await openWorkspace(page);
  const name = uniqueName('卡片记录阅读');
  await createTask(page, name, { target: 50, unit: '页' });
  const card = taskCard(page, name);
  const bar = card.getByRole('progressbar', { name: `${name}总进度`, exact: true });
  const records: { id: string; amount: number }[] = [];
  let total = 0;
  for (const amount of [1, 5, 1]) {
    const state = await quickAdd(page, name, amount);
    records.push(state.record!);
    total += amount;
    await expect(bar).toHaveAttribute('aria-valuenow', String(total));
    await expect(card.getByLabel(`${name}已完成量`, { exact: true })).toContainText(String(total));
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  expect(records.map(record => record.amount)).toEqual([1, 5, 1]);
  expect(new Set(records.map(record => record.id)).size).toBe(3);
  await page.reload();
  await expect(bar).toHaveAttribute('aria-valuenow', '7');
  const task = (await persistedState(page)).tasks.find(item => item.name === name)!;
  expect(task.progress).toBe(7);
  expect(task.today_amount).toBe(7);
  expect(task.record_count).toBe(3);
  const history = await openRecords(page, name);
  await expect(history.getByRole('article')).toHaveCount(3);
  for (const record of records) await expect(history.getByRole('article', { name: `进度记录 ${record.id}`, exact: true })).toBeVisible();
});

test('daily and active plan bars show today’s quota while daily completion counts only once', async ({ page }) => {
  await openWorkspace(page);
  const name = uniqueName('每日阅读配额');
  await createTask(page, name, { kind: 'daily', target: 3, quota: 10, unit: '页' });
  const card = taskCard(page, name);
  const bar = card.getByRole('progressbar', { name: `${name}今日进度`, exact: true });
  await expect(bar).toHaveAttribute('aria-valuemax', '10');
  let state = await quickAdd(page, name, 5);
  await expect(bar).toHaveAttribute('aria-valuenow', '5');
  expect(state.tasks.find(task => task.name === name)?.progress).toBe(0);
  expect(state.tasks.find(task => task.name === name)?.daily_done).toBe(false);
  state = await quickAdd(page, name, 5);
  await expect(bar).toHaveAttribute('aria-valuenow', '10');
  await expect(card.getByLabel(`${name}已完成量`, { exact: true })).toHaveText('今日 10 / 10 页');
  expect(state.tasks.find(task => task.name === name)?.progress).toBe(1);
  expect(state.stats.streak).toBe(1);
  state = await quickAdd(page, name, 5);
  await expect(bar).toHaveAttribute('aria-valuenow', '10');
  expect(state.tasks.find(task => task.name === name)?.today_amount).toBe(15);
  expect(state.tasks.find(task => task.name === name)?.progress).toBe(1);
  expect(state.tasks.find(task => task.name === name)?.record_count).toBe(3);
  await page.reload();
  await expect(bar).toHaveAttribute('aria-valuenow', '10');
  await expect(card.getByLabel(`${name}已完成量`, { exact: true })).toHaveText('今日 15 / 10 页');

  const planName = uniqueName('按计划阅读');
  await createTask(page, planName, { kind: 'plan', plan: '10, 5', unit: '页' });
  const planBar = taskCard(page, planName).getByRole('progressbar', { name: `${planName}今日进度`, exact: true });
  await expect(planBar).toHaveAttribute('aria-valuemax', '10');
  state = await quickAdd(page, planName, 5);
  await expect(planBar).toHaveAttribute('aria-valuenow', '5');
  expect(state.tasks.find(task => task.name === planName)?.progress).toBe(5);
  expect(state.tasks.find(task => task.name === planName)?.target).toBe(15);
});

test('pending increments preview once, failed saves roll back, and retry keeps its id before completion feedback folds', async ({ page }) => {
  await openWorkspace(page);
  const rewardName = uniqueName('完成后的电影');
  await addLinkedReward(page, rewardName);
  const name = uniqueName('有反馈的五页阅读');
  await createTask(page, name, { target: 5, unit: '页', reward: rewardName });
  const card = taskCard(page, name);
  const bar = card.getByRole('progressbar', { name: `${name}总进度`, exact: true });
  const button = card.getByRole('button', { name: `${name}增加5页`, exact: true });
  const requests: { amount: number; request_id: string }[] = [];
  let releaseFailure!: () => void;
  const pendingFailure = new Promise<void>(resolve => { releaseFailure = resolve; });
  await page.route('**/api/tasks/*/records', async route => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    requests.push(route.request().postDataJSON());
    if (requests.length === 1) {
      await pendingFailure;
      await route.fulfill({ status: 500, json: { detail: '暂时无法保存，请重试' } });
    } else await route.continue();
  });
  await button.click();
  try {
    await expect.poll(() => requests.length).toBe(1);
    await expect(bar).toHaveAttribute('aria-valuenow', '5');
    for (const amount of [1, 5]) await expect(card.getByRole('button', { name: `${name}增加${amount}页`, exact: true })).toBeDisabled();
    await button.click({ force: true });
    expect(requests).toHaveLength(1);
    const unchanged = (await persistedState(page)).tasks.find(task => task.name === name)!;
    expect(unchanged.progress).toBe(0);
    expect(unchanged.record_count).toBe(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  } finally { releaseFailure(); }
  await expect(bar).toHaveAttribute('aria-valuenow', '0');
  await expect(button).toBeEnabled();
  expect((await persistedState(page)).stats.xp).toBe(0);

  const saved = await quickAdd(page, name, 5);
  expect(requests).toHaveLength(2);
  expect(requests[0].request_id).toBeTruthy();
  expect(requests[1].request_id).toBe(requests[0].request_id);
  expect(saved.tasks.find(task => task.name === name)?.record_count).toBe(1);
  expect(saved.stats.xp).toBe(100);
  await expect(card).toBeVisible();
  await expect(bar).toHaveAttribute('aria-valuenow', '5');
  const celebration = page.getByRole('dialog', { name: '一个心愿，解锁了。', exact: true });
  await expect(celebration).toBeHidden();
  await expect(card).toBeHidden();
  await expect(celebration).toBeVisible();
  await expect(celebration).toContainText(rewardName);
  await expect(page.getByRole('button', { name: '已完成任务', exact: true, includeHidden: true })).toHaveAttribute('aria-expanded', 'false');
});

test('an unconfirmed committed increment can be retried after refresh without duplicating it or reopening the completed task', async ({ page }) => {
  await openWorkspace(page);
  const name = uniqueName('确认已保存的阅读');
  await createTask(page, name, { target: 5, unit: '页' });
  const card = taskCard(page, name);
  const bar = card.getByRole('progressbar', { name: `${name}总进度`, exact: true });
  const requests: { amount: number; request_id: string }[] = [];
  let committedRecordId = '';
  let releaseConfirmation!: () => void;
  const pendingConfirmation = new Promise<void>(resolve => { releaseConfirmation = resolve; });
  await page.route('**/api/tasks/*/records', async route => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    requests.push(route.request().postDataJSON());
    if (requests.length === 1) {
      const committed = await route.fetch();
      const state: MutationResponse = await committed.json();
      committedRecordId = state.record!.id;
      await route.fulfill({ status: 500, json: { detail: '保存结果未收到，请重试确认' } });
    } else {
      await pendingConfirmation;
      await route.continue();
    }
  });
  await card.getByRole('button', { name: `${name}增加5页`, exact: true }).click();
  await expect(card.getByRole('button', { name: `${name}增加5页`, exact: true })).toHaveClass(/is-retry/);
  await expect(bar).toHaveAttribute('aria-valuenow', '0');
  const committedTask = (await persistedState(page)).tasks.find(task => task.name === name)!;
  expect(committedTask.is_done).toBe(true);
  expect(committedTask.progress).toBe(5);
  expect(committedTask.record_count).toBe(1);

  await page.getByRole('button', { name: '刷新进度', exact: true }).click();
  await expect(card).toBeHidden();
  await showCompletedTasks(page);
  const completedRegion = page.getByRole('region', { name: '已完成任务列表', exact: true });
  await expect(completedRegion.getByRole('heading', { name, exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: `${name}增加1页`, exact: true })).toHaveCount(0);
  await expect(card.getByRole('button', { name: `${name}增加10页`, exact: true })).toHaveCount(0);
  const retry = card.getByRole('button', { name: `${name}重试确认`, exact: true });
  await expect(retry).toBeEnabled();
  const response = page.waitForResponse(result => result.request().method() === 'POST' && /\/api\/tasks\/[^/]+\/records$/.test(new URL(result.url()).pathname));
  await retry.click();
  try {
    await expect.poll(() => requests.length).toBe(2);
    expect(requests[1].request_id).toBe(requests[0].request_id);
    await expect(completedRegion.getByRole('heading', { name, exact: true })).toBeVisible();
    await expect(bar).toHaveAttribute('aria-valuenow', '5');
    await expect(card.getByLabel(`${name}已完成量`, { exact: true })).toHaveText('今日 5 / 1 页');
  } finally { releaseConfirmation(); }
  const saved = await response;
  expect(saved.status()).toBe(201);
  const result: MutationResponse = await saved.json();
  expect(result.record!.id).toBe(committedRecordId);
  expect(result.tasks.find(task => task.name === name)?.record_count).toBe(1);
  expect(result.tasks.find(task => task.name === name)?.today_amount).toBe(5);
  await expect(completedRegion.getByRole('heading', { name, exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: `${name}增加5页`, exact: true })).toHaveCount(0);
  const finalTask = (await persistedState(page)).tasks.find(task => task.name === name)!;
  expect(finalTask.progress).toBe(5);
  expect(finalTask.record_count).toBe(1);
});

test('minus one corrects the latest quantity, reopens a daily check-in, and stops at zero without a completion undo notice', async ({ page }) => {
  await openWorkspace(page);
  const name = uniqueName('修正最近的阅读量');
  await createTask(page, name, { target: 20, quota: 10, unit: '页' });
  const card = taskCard(page, name);
  const minus = card.getByRole('button', { name: `${name}减少1页`, exact: true });
  await expect(minus).toBeDisabled();
  await expect(card.getByRole('button', { name: `${name}增加10页`, exact: true })).toHaveCount(0);
  const first = (await quickAdd(page, name, 1)).record!;
  const latest = (await quickAdd(page, name, 5)).record!;
  const corrected = await quickAdd(page, name, -1);
  expect(corrected.record!.id).toBe(latest.id);
  expect(corrected.record!.amount).toBe(4);
  expect(corrected.tasks.find(task => task.name === name)?.progress).toBe(5);
  expect(corrected.tasks.find(task => task.name === name)?.record_count).toBe(2);
  await expect(card.getByRole('progressbar', { name: `${name}总进度`, exact: true })).toHaveAttribute('aria-valuenow', '5');
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toHaveCount(0);
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
  const history = await openRecords(page, name);
  await expect(history.getByRole('article', { name: `进度记录 ${first.id}`, exact: true })).toContainText('1 页');
  await expect(history.getByRole('article', { name: `进度记录 ${latest.id}`, exact: true })).toContainText('4 页');
  await page.keyboard.press('Escape');

  const dailyName = uniqueName('修正今天的达标');
  await createTask(page, dailyName, { kind: 'daily', target: 3, quota: 1, unit: '页' });
  const daily = taskCard(page, dailyName);
  const completed = await quickAdd(page, dailyName, 1);
  expect(completed.tasks.find(task => task.name === dailyName)?.daily_done).toBe(true);
  expect(completed.tasks.find(task => task.name === dailyName)?.progress).toBe(1);
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toHaveCount(0);
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
  const undone = await quickAdd(page, dailyName, -1);
  expect(undone.record!.id).toBe(completed.record!.id);
  expect(undone.record!.deleted_at).toBeTruthy();
  expect(undone.tasks.find(task => task.name === dailyName)?.daily_done).toBe(false);
  expect(undone.tasks.find(task => task.name === dailyName)?.progress).toBe(0);
  expect(undone.tasks.find(task => task.name === dailyName)?.today_amount).toBe(0);
  expect(undone.stats.streak).toBe(0);
  await expect(daily.getByRole('progressbar', { name: `${dailyName}今日进度`, exact: true })).toHaveAttribute('aria-valuenow', '0');
  await expect(daily.getByRole('button', { name: `${dailyName}减少1页`, exact: true })).toBeDisabled();
  await page.reload();
  await expect(daily.getByRole('button', { name: `${dailyName}减少1页`, exact: true })).toBeDisabled();
});

test('completion undo from the reward dialog revokes only the finishing record and preserves earlier work', async ({ page }) => {
  await openWorkspace(page);
  const rewardName = uniqueName('六页阅读后的奖励');
  await addLinkedReward(page, rewardName);
  const name = uniqueName('可撤销的最后一次完成');
  await createTask(page, name, { target: 6, unit: '页', reward: rewardName });
  const first = (await quickAdd(page, name, 1)).record!;
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toHaveCount(0);
  const finished = await quickAdd(page, name, 5);
  const finishingRecord = finished.record!;
  expect(finished.stats.xp).toBe(100);
  await expect(page.getByText(`已完成「${name}」`, { exact: true })).toBeVisible();
  const celebration = page.getByRole('dialog', { name: '一个心愿，解锁了。', exact: true });
  await expect(celebration).toBeVisible();
  await expect(celebration).toContainText(rewardName);
  const revoked = page.waitForResponse(response => response.request().method() === 'DELETE' && new URL(response.url()).pathname.endsWith(`/records/${finishingRecord.id}`));
  await celebration.getByRole('button', { name: '撤销', exact: true }).click();
  const response = await revoked;
  expect(response.status()).toBe(200);
  const result: MutationResponse = await response.json();
  expect(result.record!.id).toBe(finishingRecord.id);
  expect(result.record!.deleted_at).toBeTruthy();
  expect(result.tasks.find(task => task.name === name)?.progress).toBe(1);
  expect(result.tasks.find(task => task.name === name)?.record_count).toBe(1);
  expect(result.stats.xp).toBe(0);
  await expect(celebration).toBeHidden();
  const card = taskCard(page, name);
  await expect(card).toBeVisible();
  await expect(card.getByRole('progressbar', { name: `${name}总进度`, exact: true })).toHaveAttribute('aria-valuenow', '1');
  await expect(card.getByRole('button', { name: `${name}查看记录`, exact: true })).toBeFocused();
  const history = await openRecords(page, name);
  await expect(history.getByRole('article')).toHaveCount(1);
  await expect(history.getByRole('article', { name: `进度记录 ${first.id}`, exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.reload();
  const task = (await persistedState(page)).tasks.find(task => task.name === name)!;
  expect(task.is_done).toBe(false);
  expect(task.progress).toBe(1);
  expect(task.record_count).toBe(1);
});

test('completed cards hide step controls and restore them after completion undo', async ({ page }) => {
  await openWorkspace(page);
  const name = uniqueName('完成后只查看进度');
  await createTask(page, name, { target: 5, unit: '页' });
  const card = taskCard(page, name);
  const finished = await quickAdd(page, name, 5);
  expect(finished.tasks.find(task => task.name === name)?.is_done).toBe(true);
  await expect(card.locator('.compact-stepper')).toHaveCount(0);
  await showCompletedTasks(page);
  await expect(card).toHaveCount(1);
  await expect(card).toBeVisible();
  await expect(card.locator('.compact-quick-button')).toHaveCount(0);
  await expect(card.getByRole('button', { name: `${name}查看记录`, exact: true })).toBeVisible();
  await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '5');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(card.getByRole('button', { name: `${name}增加1页`, exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: `${name}增加5页`, exact: true })).toBeEnabled();
  await expect(card.getByRole('button', { name: `${name}减少1页`, exact: true })).toBeDisabled();
  await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
});
