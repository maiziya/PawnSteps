import { expect, test } from '@playwright/test';
import { expectNoHorizontalOverflow, openWorkspace, persistedState, taskCard, uniqueName } from './helpers';

const onboardingTitle = '从一件想做的小事开始';
const choices = [
  { name: '创建目标任务', kind: /^目标任务/ },
  { name: '创建每日打卡', kind: /^每日打卡/ },
  { name: '创建天数计划', kind: /^天数计划/ },
  { name: '导入课程', kind: /^课程学习/ },
];

test('empty workspace keeps creation visible and keyboard choices open the right form without creating data', async ({ page }, testInfo) => {
  const writes: string[] = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/api/') && !['GET', 'HEAD'].includes(request.method())) {
      writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
    }
  });
  await openWorkspace(page);
  const onboarding = page.locator('.onboarding');
  await expect(onboarding.getByRole('heading', { name: onboardingTitle, exact: true })).toBeVisible();
  await expect(page.locator('.focus-summary')).toBeHidden();
  await expect(page.getByRole('group', { name: '筛选任务', exact: true })).toBeHidden();
  await expect(page.getByRole('textbox', { name: '搜索任务', exact: true })).toBeHidden();

  for (const viewport of [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }, { width: 375, height: 812 }]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expectNoHorizontalOverflow(page);
    await expect(page.getByRole('region', { name: '任务统计', exact: true })).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole('button', { name: '添加任务', exact: true })).toBeInViewport({ ratio: 1 });
    const navigation = page.getByRole('navigation', { name: '移动导航', exact: true });
    const lowerEdge = viewport.width < 768 ? (await navigation.boundingBox())!.y : viewport.height;
    for (const choice of choices) {
      const button = onboarding.getByRole('button', { name: choice.name, exact: true });
      await expect(button).toBeInViewport({ ratio: 1 });
      const bounds = (await button.boundingBox())!;
      expect(bounds.y + bounds.height, `${choice.name} should be usable without scrolling past navigation`).toBeLessThanOrEqual(lowerEdge);
    }
    await page.screenshot({ path: testInfo.outputPath(`empty-${viewport.width}.png`), fullPage: true });
  }

  for (const choice of choices) {
    const button = onboarding.getByRole('button', { name: choice.name, exact: true });
    await button.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: '从一个小目标开始', exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('group', { name: '任务类型', exact: true }).getByRole('button', { name: choice.kind })).toHaveAttribute('aria-pressed', 'true');
    await expect(dialog.getByRole('textbox', { name: '任务名称', exact: true })).toHaveValue('');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(onboarding).toBeVisible();
  }
  expect(writes).toEqual([]);
  expect((await persistedState(page)).tasks).toEqual([]);
});

test('creating the first task enters the workspace, unmatched filters stay distinct, and deleting the last task restores onboarding', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await openWorkspace(page);
  const name = uniqueName('第一件想做的小事');
  await page.locator('.onboarding').getByRole('button', { name: '创建目标任务', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '从一个小目标开始', exact: true });
  await dialog.getByLabel('任务名称', { exact: true }).fill(name);
  await dialog.getByRole('button', { name: '创建任务', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(taskCard(page, name)).toBeVisible();
  await expect(page.locator('.onboarding')).toHaveCount(0);
  await expect(page.locator('.focus-summary')).toBeVisible();
  const filters = page.getByRole('group', { name: '筛选任务', exact: true });
  await expect(filters).toBeVisible();
  await expect(page.getByRole('textbox', { name: '搜索任务', exact: true })).toBeVisible();
  expect((await persistedState(page)).tasks.map(task => task.name)).toEqual([name]);

  // Ordinary tasks now qualify for daily tracking by default; the course filter remains disjoint.
  await filters.getByRole('button', { name: '课程学习', exact: true }).click();
  const noMatch = page.locator('.empty-state');
  await expect(noMatch.getByRole('heading', { name: '这里暂时没有匹配的任务', exact: true })).toBeVisible();
  await expect(page.locator('.onboarding')).toHaveCount(0);
  await noMatch.getByRole('button', { name: '查看全部任务', exact: true }).click();
  await expect(taskCard(page, name)).toBeVisible();
  await page.getByRole('textbox', { name: '搜索任务', exact: true }).fill('不存在的任务名称');
  await expect(noMatch).toBeVisible();
  await expect(page.locator('.onboarding')).toHaveCount(0);
  await noMatch.getByRole('button', { name: '查看全部任务', exact: true }).click();
  await expect(taskCard(page, name)).toBeVisible();

  await taskCard(page, name).getByRole('button', { name: `任务操作：${name}`, exact: true }).click();
  await page.getByRole('menuitem', { name: `删除${name}`, exact: true }).click();
  await expect(taskCard(page, name)).toHaveCount(0);
  await expect(page.locator('.onboarding').getByRole('heading', { name: onboardingTitle, exact: true })).toBeVisible();
  await expect(page.locator('.focus-summary')).toBeHidden();
  await expect(filters).toBeHidden();
  await expect(page.getByRole('textbox', { name: '搜索任务', exact: true })).toBeHidden();
  await expect(page.getByRole('button', { name: '添加任务', exact: true })).toBeVisible();
  expect((await persistedState(page)).tasks).toEqual([]);
});

test('a failed initial load shows the error instead of onboarding and a successful retry reveals the empty workspace', async ({ page }) => {
  let failLoad = true;
  await page.route('**/api/state', async route => {
    if (failLoad) await route.fulfill({ status: 503, json: { detail: '暂时无法读取任务，请重试' } });
    else await route.continue();
  });
  await page.goto('/');
  const error = page.locator('.error-banner');
  await expect(error).toContainText('暂时无法读取任务，请重试');
  await expect(page.locator('.loading-state')).toBeHidden();
  await expect(page.locator('.onboarding')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: onboardingTitle, exact: true })).toHaveCount(0);
  failLoad = false;
  await error.getByRole('button', { name: '重试', exact: true }).click();
  await expect(error).toHaveCount(0);
  await expect(page.locator('.onboarding').getByRole('heading', { name: onboardingTitle, exact: true })).toBeVisible();
});
