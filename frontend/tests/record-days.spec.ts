import { expect, test } from '@playwright/test';
import { createTask, openRecords, openWorkspace, persistedState, taskCard, uniqueName } from './helpers';

test('repeated steps show one collapsed day and corrections update that day without replacing earlier work', async ({ page }) => {
  await openWorkspace(page);
  const name = uniqueName('按天阅读记录');
  await createTask(page, name, { target: 100, unit: '页' });
  const card = taskCard(page, name);
  for (const amount of [1, 5, 1]) {
    await card.getByRole('button', { name: `${name}增加${amount}页`, exact: true }).click();
    await expect(card.getByRole('button', { name: `${name}增加1页`, exact: true })).toBeEnabled();
  }
  const requests: string[] = [];
  page.on('request', request => { if (request.method() === 'GET' && new URL(request.url()).pathname.endsWith('/records')) requests.push(request.url()); });
  const dialog = await openRecords(page, name);
  await expect(dialog.locator('.record-day')).toHaveCount(1);
  await expect(dialog.locator('.record-day-summary')).toContainText('7 页');
  await expect(dialog.locator('.record-history-heading')).toContainText('1 天记录');
  await expect(dialog.getByRole('article')).toHaveCount(0);
  expect(requests).toHaveLength(0);
  await dialog.getByLabel('本次完成量', { exact: true }).fill('2');
  await dialog.getByLabel('备注', { exact: true }).fill('晚间阅读');
  await dialog.getByRole('button', { name: '保存记录', exact: true }).click();
  await expect(dialog.locator('.record-day-summary')).toContainText('9 页');
  await expect(dialog.locator('.record-day')).toHaveCount(1);
  await expect(dialog.getByRole('article')).toHaveCount(0);
  await dialog.getByRole('button', { name: '查看明细', exact: true }).click();
  await expect(dialog.getByRole('article')).toHaveCount(4);
  const entryLabel = (await dialog.getByRole('article').filter({ hasText: '晚间阅读' }).getAttribute('aria-label'))!;
  const entry = dialog.getByRole('article', { name: entryLabel, exact: true });
  await entry.getByRole('button', { name: '编辑记录', exact: true }).click();
  await entry.getByLabel('修改完成量', { exact: true }).fill('3');
  await entry.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(dialog.locator('.record-day-summary')).toContainText('10 页');
  await entry.getByRole('button', { name: '撤销记录', exact: true }).click();
  await expect(dialog.locator('.record-day-summary')).toContainText('7 页');
  await expect(dialog.getByRole('article')).toHaveCount(3);
  expect((await persistedState(page)).tasks.find(task => task.name === name)!.today_amount).toBe(7);
  await dialog.getByRole('button', { name: '收起明细', exact: true }).click();
  await expect(dialog.getByRole('article')).toHaveCount(0);
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await page.reload();
  const reopened = await openRecords(page, name);
  await expect(reopened.locator('.record-day')).toHaveCount(1);
  await expect(reopened.locator('.record-day-summary')).toContainText('7 页');
  await expect(reopened.getByRole('article')).toHaveCount(0);
});

test('a long day retains its full sum while detail pagination and empty-day removal work', async ({ page }) => {
  await openWorkspace(page);
  const guest = await page.evaluate(() => localStorage.getItem('pawnsteps-guest-id')!);
  const headers = { 'X-Guest-Id': guest };
  const name = uniqueName('长记录日');
  const created = await page.request.post('/api/tasks', { headers, data: { name, target: 100, unit: '步' } });
  expect(created.status()).toBe(201);
  const task = (await created.json()).tasks.find((item: { name: string }) => item.name === name);
  for (let index = 0; index < 53; index++) {
    expect((await page.request.post(`/api/tasks/${task.id}/records`, { headers, data: { amount: 1 } })).status()).toBe(201);
  }
  await page.reload();
  const dialog = await openRecords(page, name);
  await expect(dialog.locator('.record-day')).toHaveCount(1);
  await expect(dialog.locator('.record-day-summary')).toContainText('53 步');
  await dialog.getByRole('button', { name: '查看明细', exact: true }).click();
  await expect(dialog.getByRole('article')).toHaveCount(50);
  await dialog.getByRole('button', { name: '加载更多明细', exact: true }).click();
  await expect(dialog.getByRole('article')).toHaveCount(53);
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  const listing = await page.request.get(`/api/tasks/${task.id}/records?limit=100`, { headers });
  const { records } = await listing.json();
  for (const record of records) expect((await page.request.delete(`/api/tasks/${task.id}/records/${record.id}`, { headers })).status()).toBe(200);
  await page.reload();
  const empty = await openRecords(page, name);
  await expect(empty.locator('.record-day')).toHaveCount(0);
  await expect(empty.locator('.record-history-heading')).toContainText('0 天记录');
  await expect(empty).toContainText('还没有记录');
});
