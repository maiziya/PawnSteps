import { expect, test } from '@playwright/test';
import { createTask, expectNoHorizontalOverflow, openWorkspace, persistedState, recordProgress, taskCard, uniqueName } from './helpers';

test('a laptop first screen exposes three complete tasks and keeps statistics visible while scrolling', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await openWorkspace(page);
  for (let index = 0; index < 5; index += 1) {
    await createTask(page, uniqueName(`今日目标 ${index + 1}`), { target: 10 });
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.locator('.daily-intro')).toHaveCount(0);
  const cards = page.locator('article.task-card');
  const measurements = await cards.evaluateAll(elements => elements.map(element => {
    const rect = element.getBoundingClientRect();
    const controls = [...element.querySelectorAll('[role="progressbar"], button[aria-label$="增加1步"], button[aria-label$="增加5步"], button[aria-label$="减少1步"], button[aria-label$="查看记录"]')].map(control => {
      const bounds = control.getBoundingClientRect();
      return { top: bounds.top, bottom: bounds.bottom };
    });
    return { top: rect.top, bottom: rect.bottom, height: rect.height, controls };
  }));
  expect(measurements[0].top).toBeLessThanOrEqual(280);
  expect(measurements.every(card => card.height >= 110 && card.height <= 140)).toBe(true);
  const actionable = measurements.filter(card => card.top >= 0 && card.bottom <= 768 && card.controls.length === 5 && card.controls.every(control => control.top >= 0 && control.bottom <= 768));
  expect(actionable.length).toBeGreaterThanOrEqual(3);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('compact-laptop-first-screen.png') });

  const stats = page.getByRole('region', { name: '任务统计', exact: true });
  await expect(stats).toContainText('全部目标');
  await expect(stats).toContainText('已完成');
  await expect(stats).toContainText('进行中');
  await expect(stats).toContainText('成长经验');
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await expect(stats).toBeInViewport({ ratio: 1 });
  const statsBounds = (await stats.boundingBox())!;
  expect(statsBounds.y).toBeGreaterThanOrEqual(0);
  expect(statsBounds.y + statsBounds.height).toBeLessThanOrEqual(160);
});

test('long task content remains readable on demand without widening desktop or phone layouts', async ({ page }) => {
  await openWorkspace(page);
  const name = `${uniqueName('认真完成自己的目标')}${'长期持续学习'.repeat(9)}`;
  const description = `阅读后记录实践方法 ${'DetailedLearningNotes'.repeat(7)}`;
  await createTask(page, name, { target: 10, description });
  const card = taskCard(page, name);
  await expect(card.getByText(description, { exact: true })).toBeHidden();
  await expect(card.getByRole('heading', { name, exact: true })).toHaveAttribute('title', name);
  const menu = card.getByRole('button', { name: `任务操作：${name}`, exact: true });
  await menu.focus();
  await menu.press('Enter');
  await page.getByRole('menuitem', { name: '查看说明', exact: true }).click();
  await expect(card.getByText(description, { exact: true })).toBeVisible();
  for (const width of [1366, 768, 375]) {
    await page.setViewportSize({ width, height: 812 });
    await expectNoHorizontalOverflow(page);
    const bounds = (await card.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
  }
  await menu.click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toBeHidden();
  await expect(menu).toBeFocused();
  await menu.press('Enter');
  await page.getByRole('menuitem', { name: `编辑${name}`, exact: true }).click();
  const editor = page.getByRole('dialog', { name: '调整你的目标', exact: true });
  await expect(editor).toBeVisible();
  await expect(page.getByRole('menu')).toBeHidden();
  const updatedDescription = '把今天的收获，留给明天的自己。';
  await editor.locator('#task-description').fill(updatedDescription);
  await editor.getByRole('button', { name: '保存调整', exact: true }).click();
  await expect(editor).toBeHidden();
  expect((await persistedState(page)).tasks.find(task => task.name === name)?.description).toBe(updatedDescription);
  await expect(card.getByText(updatedDescription, { exact: true })).toBeVisible();
});

test('completed tasks fold by default and can be reopened and collapsed from the keyboard', async ({ page }) => {
  await openWorkspace(page);
  const completedName = uniqueName('已完成的目标');
  const activeName = uniqueName('继续前行');
  await createTask(page, completedName, { target: 1 });
  await createTask(page, activeName, { target: 5 });
  await recordProgress(page, completedName, 1, '完成了今天的目标');
  await page.keyboard.press('Escape');
  const toggle = page.getByRole('button', { name: '已完成任务', exact: true });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(taskCard(page, completedName)).toBeHidden();
  await expect(taskCard(page, activeName)).toBeVisible();
  await toggle.focus();
  await toggle.press('Enter');
  const region = page.getByRole('region', { name: '已完成任务列表', exact: true });
  await expect(region).toBeVisible();
  await expect(taskCard(page, completedName)).toBeVisible();
  await expect(taskCard(page, completedName).getByRole('button', { name: `拖动排序${completedName}`, exact: true })).toHaveCount(0);
  await toggle.press('Space');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(region).toBeHidden();
  await expect(toggle).toBeFocused();
});

test('loading existing completed tasks does not focus their collapsed section', async ({ page }) => {
  await openWorkspace(page);
  const name = uniqueName('已完成任务不抢焦点');
  await createTask(page, name, { target: 1 });
  await recordProgress(page, name, 1);
  await page.reload();
  const toggle = page.getByRole('button', { name: '已完成任务', exact: true });
  await expect(toggle).toBeVisible();
  await expect(toggle).not.toBeFocused();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.focus();
  await page.keyboard.press('Space');
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(() => toggle.evaluate(element => element.matches(':focus-visible'))).toBe(true);
});
