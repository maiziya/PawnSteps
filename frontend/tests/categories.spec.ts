import { expect, test } from '@playwright/test';
import { createTask, openWorkspace, persistedState, taskCard, uniqueName } from './helpers';

async function manager(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: '筛选分类', exact: true }).click();
  await page.getByRole('menuitem', { name: '管理分类', exact: true }).click();
  return page.getByRole('dialog', { name: '管理分类', exact: true });
}
async function choose(page: import('@playwright/test').Page, name: string) {
  await page.getByRole('button', { name: '筛选分类', exact: true }).click();
  await page.getByRole('menuitemradio', { name, exact: true }).click();
}

test('categories can be created, edited, ordered and deleted while task progress remains intact', async ({ page }) => {
  await openWorkspace(page);
  const name = uniqueName('分类任务');
  await createTask(page, name, { target: 20 });
  const dialog = await manager(page);
  for (const category of ['学习', '运动']) {
    await dialog.getByLabel('分类名称', { exact: true }).fill(category);
    await dialog.getByRole('button', { name: '添加', exact: true }).click();
    await expect(dialog.getByRole('button', { name: `编辑分类${category}`, exact: true })).toBeEnabled();
  }
  await dialog.getByRole('button', { name: '上移运动', exact: true }).click();
  await expect(dialog.locator('.category-row-top>span:not(.category-dot)')).toHaveText(['运动', '学习']);
  await dialog.getByRole('button', { name: '编辑分类学习', exact: true }).click();
  await dialog.getByLabel('分类名称', { exact: true }).fill('读书');
  await dialog.getByRole('button', { name: '陶土红', exact: true }).click();
  await dialog.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '编辑分类读书', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  const card = taskCard(page, name);
  await card.getByRole('button', { name: `任务操作：${name}`, exact: true }).click();
  await page.getByRole('menuitem', { name: `设置${name}分类`, exact: true }).click();
  await page.getByRole('dialog', { name: '设置分类', exact: true }).getByRole('button', { name: '读书', exact: true }).click();
  await expect(card.getByLabel('分类：读书', { exact: true })).toBeVisible();
  await card.getByRole('button', { name: `${name}增加5步`, exact: true }).click();
  await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '5');
  await choose(page, '读书');
  const reopened = await manager(page);
  await reopened.getByRole('button', { name: '删除分类读书', exact: true }).click();
  await reopened.getByRole('button', { name: '删除分类', exact: true }).click();
  await expect(reopened.getByRole('button', { name: '删除分类读书', exact: true })).toHaveCount(0);
  await reopened.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.getByRole('button', { name: '筛选分类', exact: true })).toContainText('全部分类');
  await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '5');
  expect((await persistedState(page)).tasks.find(task => task.name === name)!.category_id).toBeNull();
});

test('category filters intersect search, completed and archive tabs and preserve unrelated sorting slots', async ({ page }) => {
  await openWorkspace(page);
  const headers = { 'X-Guest-Id': await page.evaluate(() => localStorage.getItem('pawnsteps-guest-id')!) };
  const groups: string[] = [];
  for (const name of ['学习', '工作']) {
    const response = await page.request.post('/api/categories', { headers, data: { name } });
    groups.push((await response.json()).categories.find((row: { name: string }) => row.name === name).id);
  }
  const tasks: { id: string; name: string }[] = [];
  for (const [index, name] of ['读书一', '工作一', '读书二'].entries()) {
    const response = await page.request.post('/api/tasks', { headers, data: { name, target: 10, category_id: groups[index === 1 ? 1 : 0] } });
    tasks.push((await response.json()).tasks.find((row: { name: string }) => row.name === name));
  }
  await page.reload(); await choose(page, '学习');
  await expect(page.locator('article.task-card h3')).toHaveText(['读书一', '读书二']);
  const handle = taskCard(page, '读书二').getByRole('button', { name: '拖动排序读书二', exact: true });
  await handle.focus(); await handle.press('Space');
  await expect(handle).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await handle.press('ArrowUp');
  await expect(page.getByRole('status')).toContainText(`droppable area ${tasks[0].id}`);
  await handle.press('Space');
  await expect(page.locator('article.task-card h3')).toHaveText(['读书二', '读书一']);
  await expect.poll(async () => (await persistedState(page)).tasks.map(task => task.name)).toEqual(['读书二', '工作一', '读书一']);
  await page.getByRole('textbox', { name: '搜索任务', exact: true }).fill('二');
  await expect(page.locator('article.task-card h3')).toHaveText(['读书二']);
  await page.getByRole('textbox', { name: '搜索任务', exact: true }).fill('');
  await page.request.post(`/api/tasks/${tasks[0].id}/records`, { headers, data: { amount: 10 } });
  await page.request.post(`/api/tasks/${tasks[2].id}/archive`, { headers });
  await page.reload(); await choose(page, '学习');
  await page.getByRole('group', { name: '筛选任务', exact: true }).getByRole('button', { name: '已完成', exact: true }).click();
  await expect(page.locator('article.task-card h3')).toHaveText(['读书一']);
  await page.getByRole('button', { name: '归档任务', exact: true }).click();
  await expect(page.locator('.archive-row h3')).toHaveText(['读书二']);
});

test('a first task can create a category from the form without losing its draft', async ({ page }) => {
  await openWorkspace(page);
  await page.getByRole('button', { name: '添加任务', exact: true }).click();
  const form = page.getByRole('dialog', { name: '从一个小目标开始', exact: true });
  await form.getByLabel('任务名称', { exact: true }).fill('第一次分类');
  await form.locator('.task-course-options>summary').click();
  await form.getByRole('button', { name: '管理分类', exact: true }).click();
  const categories = page.getByRole('dialog', { name: '管理分类', exact: true });
  await categories.getByLabel('分类名称', { exact: true }).fill('学习');
  await categories.getByRole('button', { name: '添加', exact: true }).click();
  await expect(categories.getByRole('button', { name: '编辑分类学习', exact: true })).toBeEnabled();
  await categories.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(form.getByLabel('任务名称', { exact: true })).toHaveValue('第一次分类');
  await form.getByLabel('分类', { exact: true }).selectOption({ label: '学习' });
  await form.getByRole('button', { name: '创建任务', exact: true }).click();
  await expect(taskCard(page, '第一次分类').getByLabel('分类：学习', { exact: true })).toBeVisible();
});
