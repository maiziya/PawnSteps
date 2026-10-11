import { expect, test, type Page } from '@playwright/test';
import { openWorkspace, persistedState, uniqueName, expectNoHorizontalOverflow } from './helpers';

async function mockNotifications(page: Page, permission: NotificationPermission = 'default') {
  await page.addInitScript(value => {
    const state = { permission: value, requests: 0, notifications: [] as { title: string; options: NotificationOptions; onclick: null | (() => void); onclose: null | (() => void); close: () => void }[] };
    Object.defineProperty(window, '__notificationTest', { value: state });
    class FakeNotification {
      static get permission() { return state.permission; }
      static async requestPermission() { state.requests++; state.permission = 'granted'; return 'granted'; }
      onclick: null | (() => void) = null;
      onclose: null | (() => void) = null;
      constructor(public title: string, public options: NotificationOptions) { state.notifications.push(this); }
      close() { this.onclose?.(); }
    }
    Object.defineProperty(window, 'Notification', { configurable: true, value: FakeNotification });
  }, permission);
}
const notificationCount = (page: Page) => page.evaluate(() => (window as unknown as { __notificationTest: { notifications: unknown[] } }).__notificationTest.notifications.length);
async function openReminder(page: Page) {
  await page.getByRole('button', { name: '每日提醒', exact: true }).click();
  return page.getByRole('dialog', { name: '每日提醒', exact: true });
}
async function morningRoutes(page: Page, morning: boolean) {
  await page.route('**/api/reminders', async route => {
    const response = await route.fetch();
    const state = await response.json();
    await route.fulfill({ response, json: { ...state, due: morning, server_now: `${state.date}T${morning ? '10' : '09'}:00:00+08:00` } });
  });
}

test('notification permission is requested only by enable; settings persist and the test notification is silent', async ({ page }, testInfo) => {
  await mockNotifications(page);
  await morningRoutes(page, false);
  await openWorkspace(page);
  const dialog = await openReminder(page);
  await expect(dialog.getByRole('button', { name: '测试通知', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => (window as unknown as { __notificationTest: { requests: number } }).__notificationTest.requests)).toBe(0);
  await dialog.getByRole('button', { name: '开启提醒', exact: true }).click();
  await expect(dialog).toContainText('已开启 · 当前浏览器');
  await dialog.getByRole('button', { name: '测试通知', exact: true }).click();
  expect(await notificationCount(page)).toBe(1);
  expect(await page.evaluate(() => (window as unknown as { __notificationTest: { notifications: { options: NotificationOptions }[] } }).__notificationTest.notifications[0].options.silent)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('reminder-light.png') });
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '切换暗色模式', exact: true }).click();
  await openReminder(page);
  await page.screenshot({ path: testInfo.outputPath('reminder-dark.png') });
  await page.setViewportSize({ width: 320, height: 740 });
  await expectNoHorizontalOverflow(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.reload();
  const restored = await openReminder(page);
  await expect(restored.getByRole('button', { name: '关闭提醒', exact: true })).toBeVisible();
  await restored.getByRole('button', { name: '关闭提醒', exact: true }).click();
  await expect(restored.getByRole('button', { name: '开启提醒', exact: true })).toBeVisible();
});

test('denied permission gives useful guidance and never prompts or emits a notification', async ({ page }) => {
  await mockNotifications(page, 'denied');
  await openWorkspace(page);
  const dialog = await openReminder(page);
  await expect(dialog).toContainText('通知被浏览器拦截');
  await expect(dialog.getByRole('button', { name: '开启提醒', exact: true })).toBeDisabled();
  expect(await notificationCount(page)).toBe(0);
});

test('unsupported browsers show a disabled control rather than an error', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'Notification', { value: undefined }));
  await openWorkspace(page);
  const dialog = await openReminder(page);
  await expect(dialog).toContainText('请使用支持通知的浏览器');
  await expect(dialog.getByRole('button', { name: '开启提醒', exact: true })).toBeDisabled();
});

test('morning delivery happens once, opens tasks and is disabled for a different guest', async ({ page }) => {
  await mockNotifications(page, 'granted');
  await morningRoutes(page, true);
  await openWorkspace(page);
  const guest = await page.evaluate(() => localStorage.getItem('pawnsteps-guest-id')!);
  const name = uniqueName('晨间阅读');
  const create = await page.request.post('/api/tasks', { headers: { 'X-Guest-Id': guest }, data: { name, target: 100 } });
  expect(create.ok()).toBe(true);
  const snapshot = await persistedState(page);
  let claims = 0, acknowledgements = 0;
  await page.route('**/api/reminders/claim', async route => {
    claims++;
    await route.fulfill({ json: { ...snapshot, reminder: { time: '10:00', timezone: 'Asia/Shanghai', server_now: `${snapshot.today}T10:00:00+08:00`, date: snapshot.today, due: true, claimed: true, token: '00000000-0000-4000-8000-000000000001', title: 'PawnSteps · 今天也向前一步', body: `今天还有 1 项任务待推进：${name}。`, task_count: 1, url: '/#tasks' } } });
  });
  await page.route('**/api/reminders/ack', async route => { acknowledgements++; await route.fulfill({ json: snapshot }); });
  const dialog = await openReminder(page);
  await dialog.getByRole('button', { name: '开启提醒', exact: true }).click();
  await expect.poll(() => notificationCount(page)).toBe(1);
  expect(claims).toBe(1);
  await expect.poll(() => acknowledgements).toBe(1);
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await page.evaluate(() => {
    location.hash = 'calendar';
    (window as unknown as { __notificationTest: { notifications: { onclick: () => void }[] } }).__notificationTest.notifications[0].onclick();
  });
  await expect(page).toHaveURL(/#tasks$/);
  await page.reload();
  await page.getByRole('button', { name: '刷新进度', exact: true }).waitFor();
  expect(await notificationCount(page)).toBe(0);
  expect(claims).toBe(1);
  await page.evaluate(() => localStorage.setItem('pawnsteps-guest-id', crypto.randomUUID()));
  await page.reload();
  const other = await openReminder(page);
  await expect(other.getByRole('button', { name: '开启提醒', exact: true })).toBeVisible();
  expect(await notificationCount(page)).toBe(0);
});
