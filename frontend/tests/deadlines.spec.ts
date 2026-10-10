import { expect, test } from '@playwright/test';
import { shiftDate } from '../lib/review-types';
import { expectNoHorizontalOverflow, openWorkspace, persistedState, taskCard, uniqueName } from './helpers';

test.use({ timezoneId: 'America/Los_Angeles' });

test('deadline creation, editing and clearing preserve progress and display creation dates in the app timezone', async ({ page }, testInfo) => {
  await openWorkspace(page);
  const initial = await persistedState(page);
  const future = shiftDate(initial.today, 7);
  const name = uniqueName('有期限的小目标');
  await page.getByRole('button', { name: '添加任务', exact: true }).click();
  const form = page.getByRole('dialog');
  await form.getByLabel('任务名称', { exact: true }).fill(name);
  await form.locator('.task-course-options > summary').click();
  await form.getByLabel('截止日期', { exact: true }).fill(future);
  await form.getByRole('button', { name: '创建任务', exact: true }).click();
  await expect(form).toBeHidden();
  const card = taskCard(page, name);
  await expect(card.locator('.task-deadline time')).toHaveAttribute('datetime', future);
  await page.reload();
  const state = await persistedState(page);
  const task = state.tasks.find(item => item.name === name)!;
  expect(task.deadline).toBe(future);
  await card.getByRole('button', { name: `任务操作：${name}`, exact: true }).click();
  await page.getByRole('menuitem', { name: '查看详情', exact: true }).click();
  const creation = card.locator('.compact-task-facts > div').filter({ hasText: '创建日期' }).locator('time');
  await expect(creation).toHaveAttribute('datetime', task.created_at);
  await expect(creation).toHaveText(new Intl.DateTimeFormat('zh-CN', { timeZone: state.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(task.created_at)));
  await page.screenshot({ path: testInfo.outputPath('task-creation-and-deadline.png') });
  for (const deadline of [initial.today, shiftDate(initial.today, -1)]) {
    await card.getByRole('button', { name: `任务操作：${name}`, exact: true }).click();
    await page.getByRole('menuitem', { name: `编辑${name}`, exact: true }).click();
    const settings = form.locator('.task-course-options');
    if (await settings.getAttribute('open') === null) await settings.locator('summary').click();
    await form.getByLabel('截止日期', { exact: true }).fill(deadline);
    await form.getByRole('button', { name: '保存调整', exact: true }).click();
    await expect(form).toBeHidden();
    await expect(card.locator('.task-deadline')).toContainText(deadline === initial.today ? '今天截止' : '已逾期');
  }
  await card.getByRole('button', { name: `${name}增加1步`, exact: true }).click();
  await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
  expect((await persistedState(page)).tasks.find(item => item.name === name)!.is_done).toBe(false);
  await card.getByRole('button', { name: `任务操作：${name}`, exact: true }).click();
  await page.getByRole('menuitem', { name: `编辑${name}`, exact: true }).click();
  const settings = form.locator('.task-course-options');
  if (await settings.getAttribute('open') === null) await settings.locator('summary').click();
  await form.getByRole('button', { name: '清空截止日期', exact: true }).click();
  await expect(form.getByLabel('截止日期', { exact: true })).toHaveValue('');
  await form.getByRole('button', { name: '保存调整', exact: true }).click();
  await expect(form).toBeHidden();
  await expect(card.locator('.task-deadline')).toHaveCount(0);
  expect((await persistedState(page)).tasks.find(item => item.name === name)!.deadline).toBeNull();
  for (const width of [1366, 375]) {
    await page.setViewportSize({ width, height: 812 });
    await expectNoHorizontalOverflow(page);
    await expect(creation).toBeVisible();
  }
});
