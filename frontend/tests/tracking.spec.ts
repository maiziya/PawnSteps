import { expect, test } from '@playwright/test';
import path from 'node:path';
import { createTask, navigate, openWorkspace, persistedState, taskCard, uniqueName } from './helpers';

test.beforeEach(async ({ page }) => { await openWorkspace(page); });

test('ordinary progress unlocks its reward, updates XP, and deletion can be undone', async ({ page }) => {
  const rewardName = uniqueName('周末电影');
  const taskName = uniqueName('整理阅读笔记');
  await navigate(page, '心愿奖励');
  await page.getByRole('button', { name: '添加奖励', exact: true }).click();
  const rewardDialog = page.getByRole('dialog', { name: '添加一个小期待' });
  await rewardDialog.getByLabel('奖励名称', { exact: true }).fill(rewardName);
  await rewardDialog.getByRole('button', { name: '添加奖励', exact: true }).click();
  await expect(rewardDialog).toBeHidden();
  await expect(page.getByRole('heading', { name: rewardName, exact: true })).toBeVisible();
  await navigate(page, '我的步履');
  await createTask(page, taskName, { target: 2, reward: rewardName });
  await taskCard(page, taskName).getByRole('button', { name: `${taskName}增加一步`, exact: true }).click();
  await expect(taskCard(page, taskName).getByRole('slider')).toHaveValue('1');
  await expect(taskCard(page, taskName).getByRole('button', { name: `${taskName}增加一步`, exact: true })).toBeEnabled();
  await taskCard(page, taskName).getByRole('button', { name: `${taskName}增加一步`, exact: true }).click();
  const celebration = page.getByRole('dialog', { name: '一个心愿，解锁了。' });
  await expect(celebration).toContainText(rewardName);
  await celebration.getByRole('button', { name: '收下这份奖励' }).click();
  const rewardCard = page.locator('article.reward-card').filter({ has: page.getByRole('heading', { name: rewardName, exact: true }) });
  await expect(rewardCard).toContainText('已解锁');
  const state = await persistedState(page);
  expect(state.stats.xp).toBe(100);
  expect(state.tasks.find(task => task.name === taskName)?.is_done).toBe(true);
  await navigate(page, '我的步履');
  await taskCard(page, taskName).getByRole('button', { name: `删除${taskName}`, exact: true }).click();
  await expect(taskCard(page, taskName)).toHaveCount(0);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(taskCard(page, taskName)).toBeVisible();
  await page.reload();
  await expect(taskCard(page, taskName)).toBeVisible();
  expect((await persistedState(page)).stats.xp).toBe(100);
});

test('daily quota counts one day, supports undo, and restores persisted progress', async ({ page }) => {
  const name = uniqueName('每天读书');
  await createTask(page, name, { kind: 'daily', target: 7, quota: 2 });
  const slider = taskCard(page, name).getByRole('slider');
  await slider.focus();
  await slider.press('End');
  await expect(taskCard(page, name)).toContainText('今日已达标');
  await expect(taskCard(page, name)).toContainText('1 / 7 天');
  let state = await persistedState(page);
  expect(state.tasks[0].daily_progress).toBe(2);
  expect(state.tasks[0].progress).toBe(1);
  expect(state.stats.streak).toBe(1);
  await taskCard(page, name).getByRole('button', { name: '撤销达标', exact: true }).click();
  await expect(taskCard(page, name)).toContainText('0 / 7 天');
  await expect(slider).toHaveValue('0');
  await page.reload();
  await expect(taskCard(page, name)).toBeVisible();
  state = await persistedState(page);
  expect(state.tasks[0].daily_done).toBe(false);
  expect(state.stats.streak).toBe(0);
});

test('a planned rest day is marked complete while positive quotas define the total', async ({ page }) => {
  const name = uniqueName('有节奏的计划');
  await createTask(page, name, { kind: 'plan', plan: '0, 10, -1, 5' });
  await expect(taskCard(page, name)).toContainText('今天是休息日，安心休息');
  const task = (await persistedState(page)).tasks.find(task => task.name === name)!;
  expect(task.target).toBe(15);
  expect(task.progress).toBe(0);
  expect(task.daily_done).toBe(true);
  expect(task.is_done).toBe(false);
  await expect(taskCard(page, name).getByRole('slider')).toBeDisabled();
});

test('Markdown course import excludes folders and supports item and chapter completion', async ({ page }) => {
  const name = uniqueName('系统课程');
  await page.getByRole('button', { name: '添加任务', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '从一个小目标开始' });
  await dialog.getByRole('button', { name: /^课程学习/ }).click();
  await dialog.getByLabel('任务名称', { exact: true }).fill(name);
  await dialog.locator('input[type="file"][accept]').setInputFiles({ name: 'course.md', mimeType: 'text/markdown', buffer: Buffer.from('### Foundations\n- Lesson 1\n- Lesson 2\n### Practice\n* Final project\n', 'utf8') });
  await expect(dialog).toContainText('3 节课程');
  await dialog.getByRole('button', { name: '创建任务', exact: true }).click();
  const card = taskCard(page, name);
  await expect(card).toContainText('0 / 3 节');
  await card.getByText('Lesson 1', { exact: true }).click();
  await expect(card.getByRole('checkbox', { name: 'Lesson 1', exact: true })).toBeChecked();
  await expect(card).toContainText('1 / 3 节');
  await card.getByRole('button', { name: '完成Foundations全部条目', exact: true }).click();
  await expect(card).toContainText('2 / 3 节');
  await card.getByRole('button', { name: '完成Practice全部条目', exact: true }).click();
  await expect(card.filter({ hasText: '课程已完成' })).toBeVisible();
  await expect(card).toHaveCount(1);
  const state = await persistedState(page);
  const task = state.tasks.find(task => task.name === name)!;
  expect(task.target).toBe(3);
  expect(task.progress).toBe(3);
  expect(task.course_items?.filter(item => item.name.endsWith('/')).every(item => !item.done)).toBe(true);
  expect(state.stats.xp).toBe(100);
});

test('keyboard drag sorting persists unfinished task order', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1400 });
  const first = uniqueName('第一项');
  const second = uniqueName('第二项');
  await createTask(page, first, { target: 5 });
  await createTask(page, second, { target: 5 });
  const initialState = await persistedState(page);
  const firstId = initialState.tasks.find(task => task.name === first)!.id;
  const secondId = initialState.tasks.find(task => task.name === second)!.id;
  const handle = taskCard(page, first).getByRole('button', { name: `拖动排序${first}`, exact: true });
  await handle.focus();
  await page.keyboard.press('Space');
  await expect(handle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('status')).toContainText(`droppable area ${firstId}`);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('status')).toContainText(`droppable area ${secondId}`);
  await page.keyboard.press('Space');
  await expect(handle).not.toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await persistedState(page)).tasks.map(task => task.name)).toEqual([second, first]);
  await page.reload();
  await expect(page.locator('article.task-card h3')).toHaveText([second, first]);
});

test('pointer range dragging previews locally and persists only after release', async ({ page }) => {
  const name = uniqueName('拖动进度');
  await createTask(page, name, { target: 10 });
  const slider = taskCard(page, name).getByRole('slider');
  await slider.scrollIntoViewIfNeeded();
  const bounds = (await slider.boundingBox())!;
  await page.mouse.move(bounds.x + 4, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.7, bounds.y + bounds.height / 2, { steps: 10 });
  const preview = Number(await slider.inputValue());
  expect(preview).toBeGreaterThan(0);
  expect((await persistedState(page)).tasks.find(task => task.name === name)?.progress).toBe(0);
  await page.mouse.up();
  await expect.poll(async () => (await persistedState(page)).tasks.find(task => task.name === name)?.progress).toBe(preview);
  await page.reload();
  await expect(taskCard(page, name).getByRole('slider')).toHaveValue(String(preview));
});

test('directory import preserves natural order and mouse marquee toggles mixed and completed selections', async ({ page }) => {
  const name = uniqueName('文件夹课程');
  await page.getByRole('button', { name: '添加任务', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '从一个小目标开始' });
  await dialog.getByRole('button', { name: /^课程学习/ }).click();
  await dialog.getByLabel('任务名称', { exact: true }).fill(name);
  await dialog.locator('input[webkitdirectory]').setInputFiles(path.join(__dirname, 'fixtures/directory-course'));
  await expect(dialog).toContainText('3 节课程');
  await dialog.getByRole('button', { name: '创建任务', exact: true }).click();
  await expect(dialog).toBeHidden();
  const card = taskCard(page, name);
  await expect(card).toContainText('0 / 3 节');
  const state = await persistedState(page);
  expect(state.tasks[0].course_items?.map(item => item.name)).toEqual(['01 Introduction', 'Basics/', '02 Practice', '10 Recap']);
  await card.getByText('01 Introduction', { exact: true }).click();
  await expect(card).toContainText('1 / 3 节');
  await card.getByRole('button', { name: 'Basics 0/2', exact: true }).click();

  async function marquee(expectedProgress: number) {
    const course = card.locator('.course-items');
    await course.scrollIntoViewIfNeeded();
    const bounds = (await course.boundingBox())!;
    const rectangles = await course.locator('[data-course-item]').evaluateAll(elements => elements.map(element => {
      const rect = element.getBoundingClientRect();
      return { right: rect.right, bottom: rect.bottom };
    }));
    await page.mouse.move(bounds.x + 1, bounds.y + 1);
    await page.mouse.down();
    await page.mouse.move(Math.max(...rectangles.map(rect => rect.right)) + 2, Math.max(...rectangles.map(rect => rect.bottom)) + 2, { steps: 12 });
    await expect(course.locator('[data-course-item].outline')).toHaveCount(3);
    await page.mouse.up();
    await expect.poll(async () => (await persistedState(page)).tasks.find(task => task.name === name)?.progress).toBe(expectedProgress);
    await expect(card).toHaveCount(1);
  }

  await marquee(3);
  await expect(card).toContainText('课程已完成');
  // Completing a course moves it to the completed section, so reopen the second group.
  await card.getByRole('button', { name: 'Basics 2/2', exact: true }).click();
  await marquee(0);
  await expect(card).toContainText('0 / 3 节');
});
