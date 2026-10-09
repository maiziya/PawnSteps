import { expect, test } from '@playwright/test';
import { navigate, openWorkspace, expectNoHorizontalOverflow } from './helpers';

async function state(page: import('@playwright/test').Page) {
  const guest = await page.evaluate(() => localStorage.getItem('pawnsteps-guest-id')!);
  const response = await page.request.get('/api/focus', { headers: { 'X-Guest-Id': guest } });
  expect(response.ok()).toBeTruthy(); return response.json();
}

async function prepare(page: import('@playwright/test').Page, fallback = false) {
  if (fallback) await page.addInitScript(() => Object.defineProperty(Element.prototype, 'requestFullscreen', { configurable: true, value: undefined }));
  await openWorkspace(page); await navigate(page, '专注计时');
  await expect(page.getByRole('button', { name: '开始专注', exact: true })).toBeEnabled();
}

test('fullscreen entry and exit preserve running and paused sessions and restore dashboard controls', async ({ page }) => {
  await prepare(page);
  await page.getByRole('button', { name: '开始专注', exact: true }).click();
  await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
  const id = (await state(page)).active_session.id;
  await page.getByRole('button', { name: '全屏专注', exact: true }).click();
  const root = page.locator('.focus-page.is-fullscreen');
  await expect(root).toBeVisible(); await expect(page.locator('.workspace-header')).toBeHidden();
  const box = (await root.boundingBox())!;
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  expect(box.x).toBe(0); expect(box.y).toBe(0); expect(box.width).toBe(viewport.width); expect(box.height).toBe(viewport.height);
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  expect((await state(page)).active_session.id).toBe(id);
  expect((await state(page)).active_session.status).toBe('paused');
  await page.getByRole('button', { name: '退出全屏', exact: true }).click();
  await expect(root).toHaveCount(0); await expect(page.locator('.workspace-header')).toBeVisible();
  await expect(page.getByRole('button', { name: '全屏专注', exact: true })).toBeFocused();
  await page.getByRole('button', { name: '全屏专注', exact: true }).click();
  await expect(root).toBeVisible(); await page.keyboard.press('Escape');
  await expect(root).toHaveCount(0);
  expect((await state(page)).active_session.id).toBe(id);
  await expectNoHorizontalOverflow(page);
});

test('settings and end confirmation remain usable during fullscreen and CSS fallback Escape closes dialogs first', async ({ page }) => {
  await prepare(page, true);
  await page.getByRole('button', { name: '全屏专注', exact: true }).click();
  await page.getByRole('button', { name: '专注设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '专注节奏' });
  await expect(settings).toBeVisible(); await page.keyboard.press('Escape');
  await expect(settings).toBeHidden(); await expect(page.locator('.focus-page.is-fullscreen')).toBeVisible();
  await page.getByRole('button', { name: '开始专注', exact: true }).click();
  await page.getByRole('button', { name: '结束本轮', exact: true }).click();
  await page.getByRole('button', { name: '确认结束', exact: true }).click();
  await expect(page.getByRole('region', { name: '确认专注成果' })).toBeVisible();
  await page.getByRole('button', { name: '只保存时长', exact: true }).click();
  await expect(page.getByRole('button', { name: '开始专注', exact: true })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.locator('.focus-page.is-fullscreen')).toHaveCount(0);
});

test('native fullscreen keeps modal portals visible and browser exit returns to the normal view', async ({ page }) => {
  await prepare(page);
  await page.getByRole('button', { name: '全屏专注', exact: true }).click();
  await expect(page.getByRole('button', { name: '退出全屏', exact: true })).toBeEnabled();
  const native = await page.evaluate(() => document.fullscreenElement === document.documentElement);
  await page.getByRole('button', { name: '专注设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '专注节奏' });
  await expect(settings).toBeVisible(); await settings.getByLabel('专注时长', { exact: false }).fill('20');
  await settings.getByRole('button', { name: '保存设置', exact: true }).click(); await expect(settings).toBeHidden();
  if (native) await page.evaluate(() => document.exitFullscreen());
  else await page.getByRole('button', { name: '退出全屏', exact: true }).click();
  await expect(page.locator('.focus-page.is-fullscreen')).toHaveCount(0);
  await expect(page.getByRole('timer')).toHaveText('20:00');
});

test('rejected fullscreen requests fall back gracefully and leaving the view restores scrolling', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Element.prototype, 'requestFullscreen', { configurable: true, value: () => Promise.reject(new DOMException('Denied', 'NotAllowedError')) });
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
  });
  await prepare(page); await page.getByRole('button', { name: '全屏专注', exact: true }).click();
  await expect(page.locator('.focus-page.is-fullscreen')).toBeVisible();
  await expect(page.getByRole('button', { name: '退出全屏', exact: true })).toBeEnabled();
  await page.evaluate(() => { location.hash = 'review'; });
  await expect(page.getByRole('heading', { name: '每周回顾', level: 1 })).toBeVisible();
  expect(await page.evaluate(() => document.body.dataset.focusFullscreen)).toBeUndefined();
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
  await expect(page.locator('.workspace-header')).toBeVisible();
});

test('fullscreen toggles preserve confirmation drafts and course picker portals', async ({ page }) => {
  await prepare(page, true);
  const guest = await page.evaluate(() => localStorage.getItem('pawnsteps-guest-id')!);
  const created = await page.request.post('/api/tasks', { headers: { 'X-Guest-Id': guest }, data: { name: 'Fullscreen course', course_items: [{ name: 'Lessons/' }, { name: 'Lesson A' }, { name: 'Lesson B' }] } });
  expect(created.ok()).toBeTruthy();
  const task = (await created.json()).tasks.find((item: { name: string }) => item.name === 'Fullscreen course');
  await page.reload(); await navigate(page, '专注计时'); await page.locator('#focus-task').selectOption(task.id);
  await page.getByRole('button', { name: '开始专注', exact: true }).click();
  await expect.poll(async () => (await state(page)).active_session?.elapsed_seconds || 0).toBeGreaterThanOrEqual(1);
  await page.getByRole('button', { name: '全屏专注', exact: true }).click();
  await page.getByRole('button', { name: '结束本轮', exact: true }).click();
  await page.getByRole('button', { name: '确认结束', exact: true }).click();
  await page.getByRole('button', { name: '选择完成的课程', exact: true }).click();
  const picker = page.getByRole('dialog', { name: '本轮完成的课程' });
  await expect(picker).toBeVisible(); await picker.locator('[data-course-item="1"]').click();
  await picker.getByRole('button', { name: '确认选择', exact: true }).click();
  await expect(page.getByRole('button', { name: '已选 1 节', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '退出全屏', exact: true }).click();
  await expect(page.getByRole('button', { name: '已选 1 节', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '全屏专注', exact: true }).click();
  await expect(page.getByRole('button', { name: '已选 1 节', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '记录并确认', exact: true }).click();
  await expect(page.getByRole('button', { name: '开始专注', exact: true })).toBeVisible();
  const saved = await page.request.get('/api/state', { headers: { 'X-Guest-Id': guest } });
  expect((await saved.json()).tasks.find((item: { id: string }) => item.id === task.id).progress).toBe(1);
});

test('reward celebration remains visible in native fullscreen and navigation cleans up fullscreen ownership', async ({ page }) => {
  await prepare(page);
  const guest = await page.evaluate(() => localStorage.getItem('pawnsteps-guest-id')!);
  const headers = { 'X-Guest-Id': guest };
  const rewardResponse = await page.request.post('/api/rewards', { headers, data: { name: 'Fullscreen reward' } });
  expect(rewardResponse.ok()).toBeTruthy();
  const reward = (await rewardResponse.json()).rewards.find((item: { name: string }) => item.name === 'Fullscreen reward');
  const taskResponse = await page.request.post('/api/tasks', { headers, data: { name: 'Fullscreen goal', target: 1, unit: '个', reward_id: reward.id } });
  expect(taskResponse.ok()).toBeTruthy();
  const task = (await taskResponse.json()).tasks.find((item: { name: string }) => item.name === 'Fullscreen goal');
  await page.reload(); await navigate(page, '专注计时'); await page.locator('#focus-task').selectOption(task.id);
  await page.getByRole('button', { name: '开始专注', exact: true }).click();
  await expect.poll(async () => (await state(page)).active_session?.elapsed_seconds || 0).toBeGreaterThanOrEqual(1);
  await page.getByRole('button', { name: '全屏专注', exact: true }).click();
  await page.getByRole('button', { name: '结束本轮', exact: true }).click();
  await page.getByRole('button', { name: '确认结束', exact: true }).click();
  await page.getByLabel('本轮实际完成量', { exact: true }).fill('1');
  await page.getByRole('button', { name: '记录并确认', exact: true }).click();
  const celebration = page.getByRole('dialog', { name: '一个心愿，解锁了。' });
  await expect(celebration).toBeVisible(); await expect(celebration).toContainText('Fullscreen reward');
  await celebration.getByRole('button', { name: '收下这份奖励', exact: true }).click();
  await expect(page.getByRole('heading', { name: '我的奖励架', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.body.dataset.focusFullscreen)).toBeUndefined();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBeTruthy();
  await expect(page.locator('.workspace-header')).toBeVisible();
});
