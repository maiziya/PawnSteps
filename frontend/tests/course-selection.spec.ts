import { expect, test } from '@playwright/test';
import { openWorkspace, openCourse, persistedState, taskCard, uniqueName, expectNoHorizontalOverflow } from './helpers';

async function importCourse(page: import('@playwright/test').Page, name: string, text: string) {
  await page.getByRole('button', { name: '添加任务', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '从一个小目标开始', exact: true });
  await dialog.getByRole('button', { name: /^课程学习/ }).click();
  await dialog.getByLabel('任务名称', { exact: true }).fill(name);
  await dialog.locator('input[type="file"][accept]').setInputFiles({ name: 'course.md', mimeType: 'text/markdown', buffer: Buffer.from(text) });
  await dialog.getByRole('button', { name: '创建任务', exact: true }).click();
  await expect(dialog).toBeHidden();
  return openCourse(page, name);
}

test('course imports hide trailing numeric metadata while preserving meaningful pipes and item counts', async ({ page }) => {
  await openWorkspace(page);
  const name = uniqueName('标题清理');
  const drawer = await importCourse(page, name, '### Basics\n- 01 行尾插入 | 1\n- 02 行首插入|1\n- Shell | Pipeline\n- `value | 1`\n- Literal \\| 1\n');
  await expect(drawer.getByRole('checkbox', { name: '01 行尾插入', exact: true })).toBeVisible();
  await expect(drawer.getByRole('checkbox', { name: '02 行首插入', exact: true })).toBeVisible();
  await expect(drawer.getByRole('checkbox', { name: 'Shell | Pipeline', exact: true })).toBeVisible();
  await expect(drawer.getByRole('checkbox', { name: '`value | 1`', exact: true })).toBeVisible();
  await expect(drawer.getByRole('checkbox', { name: 'Literal | 1', exact: true })).toBeVisible();
  expect((await persistedState(page)).tasks.find(task => task.name === name)?.target).toBe(5);
});

test('mouse selection can start on a lesson, work backwards, and explicitly clear a mixed selection', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await openWorkspace(page);
  const name = uniqueName('双向框选');
  const drawer = await importCourse(page, name, '### Lessons\n- Lesson A\n- Lesson B\n- Lesson C\n- Lesson D\n');
  const labels = drawer.locator('[data-course-item]');
  const initialItemColor = await labels.first().evaluate(el => getComputedStyle(el).backgroundColor);
  const initialGroupColor = await drawer.locator('.course-group-heading').evaluate(el => getComputedStyle(el).backgroundColor);
  async function selectRows(reverse: boolean, clear = false) {
    const first = (await labels.nth(0).boundingBox())!;
    const last = (await labels.nth(3).boundingBox())!;
    const from = reverse ? { x: last.x + last.width - 4, y: last.y + last.height - 4 } : { x: first.x + 35, y: first.y + 12 };
    const to = reverse ? { x: first.x + 4, y: first.y + 4 } : { x: last.x + last.width - 4, y: last.y + last.height - 4 };
    if (clear) await page.keyboard.down('Shift');
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 10 });
    await expect(drawer.locator('[data-course-item].outline')).toHaveCount(4);
    await page.mouse.up();
    if (clear) await page.keyboard.up('Shift');
  }
  await selectRows(false);
  await expect.poll(async () => (await persistedState(page)).tasks.find(task => task.name === name)?.progress).toBe(4);
  await expect.poll(() => labels.first().evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe(initialItemColor);
  await expect.poll(() => drawer.locator('.course-group-heading').evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe(initialGroupColor);
  await expect(drawer.locator('.course-group.is-complete')).toHaveCount(1);
  await selectRows(true);
  await expect.poll(async () => (await persistedState(page)).tasks.find(task => task.name === name)?.progress).toBe(0);
  await page.mouse.move(100, 100);
  await expect.poll(() => labels.first().evaluate(el => getComputedStyle(el).backgroundColor)).toBe(initialItemColor);
  await expect.poll(() => drawer.locator('.course-group-heading').evaluate(el => getComputedStyle(el).backgroundColor)).toBe(initialGroupColor);
  await labels.nth(0).click();
  await expect.poll(async () => (await persistedState(page)).tasks.find(task => task.name === name)?.progress).toBe(1);
  await selectRows(false, true);
  await expect.poll(async () => (await persistedState(page)).tasks.find(task => task.name === name)?.progress).toBe(0);
  await expect(drawer.getByRole('checkbox', { checked: true })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});


test('existing course titles are cleaned in the view without rewriting stored names or completion', async ({ page }) => {
  await openWorkspace(page);
  const name = uniqueName('已有课程');
  const headers = { 'X-Guest-Id': await page.evaluate(() => localStorage.getItem('pawnsteps-guest-id')!) };
  const created = await page.request.post('/api/tasks', { headers, data: {
    name, course_items: [{ name: '原章节/', done: false }, { name: '已有课程一 | 1', done: false }, { name: '已有课程二 |1', done: false }],
  } });
  expect(created.ok()).toBe(true);
  const state = await created.json();
  const id = state.tasks.find((task: { name: string }) => task.name === name).id;
  expect((await page.request.post(`/api/tasks/${id}/course`, { headers, data: { indices: [1], done: true } })).ok()).toBe(true);
  await page.reload();
  const drawer = await openCourse(page, name);
  await expect(drawer.getByRole('checkbox', { name: '已有课程一', exact: true })).toBeChecked();
  await expect(drawer.getByRole('checkbox', { name: '已有课程二', exact: true })).not.toBeChecked();
  await expect(drawer.locator('[data-course-item="1"]')).toHaveAttribute('data-completed', 'true');
  const task = (await persistedState(page)).tasks.find(item => item.id === id)!;
  expect(task.progress).toBe(1);
  expect(task.course_items![1].name).toBe('已有课程一 | 1');
});

test('mouse selection scrolls through a long chapter and Escape cancels without committing', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 720 });
  await openWorkspace(page);
  const name = uniqueName('滚动框选');
  const drawer = await importCourse(page, name, '### Long chapter\n' + Array.from({ length: 60 }, (_, index) => `- Lesson ${index + 1}`).join('\n'));
  const scroller = drawer.locator('.course-drawer-body');
  const labels = drawer.locator('[data-course-item]');
  const first = (await labels.first().boundingBox())!;
  const second = (await labels.nth(1).boundingBox())!;
  const bounds = (await scroller.boundingBox())!;
  const visibleBefore = await labels.evaluateAll((elements, bottom) => elements.filter(el => el.getBoundingClientRect().bottom <= bottom).length, bounds.y + bounds.height);
  await page.mouse.move(first.x + 35, first.y + 12);
  await page.mouse.down();
  await page.mouse.move(second.x + second.width - 4, bounds.y + bounds.height - 4, { steps: 12 });
  await expect.poll(() => scroller.evaluate(el => el.scrollTop)).toBeGreaterThan(160);
  await expect(drawer.locator('.course-selection-box')).toBeVisible();
  await page.mouse.up();
  await expect.poll(async () => (await persistedState(page)).tasks.find(task => task.name === name)?.progress || 0).toBeGreaterThan(visibleBefore);
  const completed = (await persistedState(page)).tasks.find(task => task.name === name)!.progress;
  await scroller.evaluate(el => { el.scrollTop = 0; });
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const start = (await labels.first().boundingBox())!;
  const end = (await labels.nth(3).boundingBox())!;
  await page.mouse.move(start.x + 35, start.y + 12);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width - 4, end.y + end.height - 4, { steps: 8 });
  await expect(drawer.locator('.course-selection-box')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(drawer).toBeVisible();
  await expect(drawer.locator('.course-selection-box')).toHaveCount(0);
  expect((await persistedState(page)).tasks.find(task => task.name === name)!.progress).toBe(completed);
});

test('a fast drag that exits the course area before its first move still completes and clears the selection', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await openWorkspace(page);
  const name = uniqueName('快速跨边界框选');
  const drawer = await importCourse(page, name, '### Lessons\n- Lesson A\n- Lesson B\n- Lesson C\n- Lesson D\n');
  const labels = drawer.locator('[data-course-item]');
  for (const expected of [4, 0]) {
    const first = (await labels.first().boundingBox())!;
    const bounds = (await drawer.locator('.course-items').boundingBox())!;
    await page.mouse.move(first.x + 35, first.y + 10);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width + 8, bounds.y + bounds.height + 16, { steps: 1 });
    await page.mouse.up();
    await expect.poll(async () => (await persistedState(page)).tasks.find(task => task.name === name)?.progress).toBe(expected);
    await expect(drawer.getByRole('checkbox', { checked: true })).toHaveCount(expected);
    await expect(drawer.locator('.course-selection-box')).toHaveCount(0);
  }
});

test('release coordinates determine a fast selection even without an intermediate pointer move', async ({ page }) => {
  await openWorkspace(page);
  const name = uniqueName('松手终点框选');
  const drawer = await importCourse(page, name, '### Lessons\n- Lesson A\n- Lesson B\n- Lesson C\n- Lesson D\n');
  await drawer.locator('.course-items').evaluate(root => {
    const labels = root.querySelectorAll<HTMLElement>('[data-course-item]');
    const first = labels[0].getBoundingClientRect();
    const last = labels[3].getBoundingClientRect();
    labels[0].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 41, pointerType: 'mouse', button: 0, buttons: 1, clientX: first.left + 35, clientY: first.top + 10 }));
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 41, pointerType: 'mouse', button: 0, buttons: 0, clientX: last.right - 4, clientY: last.bottom - 4 }));
  });
  await expect(drawer.getByRole('checkbox', { checked: true })).toHaveCount(4);
  expect((await persistedState(page)).tasks.find(task => task.name === name)?.progress).toBe(4);
  await expect(drawer.locator('.course-selection-box')).toHaveCount(0);
  await drawer.locator('[data-course-item]').first().click();
  await expect(drawer.getByRole('checkbox', { checked: true })).toHaveCount(3);
});

test('rapid repeated selections preview immediately and preserve the final intent while saving', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await openWorkspace(page);
  const name = uniqueName('连续快速框选');
  const drawer = await importCourse(page, name, '### Lessons\n- Lesson A\n- Lesson B\n- Lesson C\n- Lesson D\n');
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const requests: { indices: number[]; done: boolean }[] = [];
  await page.route('**/api/tasks/*/course', async route => {
    requests.push(route.request().postDataJSON());
    if (requests.length === 1) await gate;
    await route.continue();
  });
  const labels = drawer.locator('[data-course-item]');
  async function drag() {
    const first = (await labels.first().boundingBox())!;
    const last = (await labels.last().boundingBox())!;
    await page.mouse.move(first.x + 35, first.y + 10);
    await page.mouse.down();
    await page.mouse.move(last.x + last.width - 4, last.y + last.height - 4, { steps: 1 });
    await page.mouse.up();
  }
  try {
    await drag();
    await expect.poll(() => requests.length).toBe(1);
    await expect(drawer.getByRole('checkbox', { checked: true })).toHaveCount(4, { timeout: 1500 });
    await drag();
    await expect(drawer.getByRole('checkbox', { checked: true })).toHaveCount(0, { timeout: 1500 });
  } finally { release(); }
  await expect.poll(() => requests.length).toBe(2);
  expect(requests.map(request => request.done)).toEqual([true, false]);
  await expect.poll(async () => (await persistedState(page)).tasks.find(task => task.name === name)?.progress).toBe(0);
  await expect(drawer.getByRole('checkbox', { checked: true })).toHaveCount(0);
});

for (const overlap of [false, true]) test(`a failed save preserves later ${overlap ? 'overlapping' : 'disjoint'} selection intent`, async ({ page }) => {
  await openWorkspace(page);
  const name = uniqueName('框选失败回退');
  const drawer = await importCourse(page, name, '### Lessons\n- Lesson A\n- Lesson B\n- Lesson C\n');
  let releaseFirst!: () => void;
  let releaseSecond!: () => void;
  const first = new Promise<void>(resolve => { releaseFirst = resolve; });
  const second = new Promise<void>(resolve => { releaseSecond = resolve; });
  let requests = 0;
  await page.route('**/api/tasks/*/course', async route => {
    requests++;
    if (requests === 1) {
      await first;
      await route.fulfill({ status: 500, json: { detail: 'Save failed' } });
    } else {
      await second;
      await route.continue();
    }
  });
  const labels = drawer.locator('[data-course-item]');
  try {
    await labels.nth(0).click();
    await expect(drawer.getByRole('checkbox', { name: 'Lesson A', exact: true })).toBeChecked();
    if (overlap) await drawer.getByRole('button', { name: '完成Lessons全部条目', exact: true }).click();
    else await labels.nth(1).click();
    await expect(drawer.getByRole('checkbox', { name: 'Lesson B', exact: true })).toBeChecked();
    releaseFirst();
    await expect.poll(() => requests).toBe(2);
    await expect(drawer.getByRole('checkbox', { name: 'Lesson A', exact: true })).toBeChecked({ checked: overlap });
    await expect(drawer.getByRole('checkbox', { name: 'Lesson B', exact: true })).toBeChecked();
    await expect(page.locator('[data-sonner-toast]')).toContainText('Save failed');
  } finally { releaseFirst(); releaseSecond(); }
  await expect.poll(async () => (await persistedState(page)).tasks.find(task => task.name === name)?.progress).toBe(overlap ? 3 : 1);
  await expect(drawer.getByRole('checkbox', { checked: true })).toHaveCount(overlap ? 3 : 1);
});

test('a fast marquee can start in the drawer gutter beside a course row', async ({ page }) => {
  await openWorkspace(page);
  const name = uniqueName('边缘空白框选');
  const drawer = await importCourse(page, name, '### Lessons\n- Lesson A\n- Lesson B\n- Lesson C\n- Lesson D\n');
  const first = (await drawer.locator('[data-course-item]').first().boundingBox())!;
  const last = (await drawer.locator('[data-course-item]').last().boundingBox())!;
  const body = (await drawer.locator('.course-drawer-body').boundingBox())!;
  await page.mouse.move(body.x + 8, first.y + 8);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width - 3, last.y + last.height - 3, { steps: 1 });
  await page.mouse.up();
  await expect(drawer.getByRole('checkbox', { checked: true })).toHaveCount(4);
  await expect.poll(async () => (await persistedState(page)).tasks.find(task => task.name === name)?.progress).toBe(4);
});

test('repeated one-move gestures work from checkbox, text, and gutter without waiting for saves', async ({ page }) => {
  await openWorkspace(page);
  const name = uniqueName('快速起点矩阵');
  const drawer = await importCourse(page, name, '### Lessons\n- Lesson A\n- Lesson B\n- Lesson C\n- Lesson D\n');
  const labels = drawer.locator('[data-course-item]');
  let requests = 0;
  page.on('request', request => { if (request.method() === 'POST' && /\/api\/tasks\/[^/]+\/course$/.test(request.url())) requests++; });
  for (let index = 0; index < 12; index++) {
    const first = (await labels.first().boundingBox())!;
    const last = (await labels.last().boundingBox())!;
    const body = (await drawer.locator('.course-drawer-body').boundingBox())!;
    const x = index % 3 === 0 ? first.x + 16 : index % 3 === 1 ? first.x + 45 : body.x + 8;
    await page.mouse.move(x, first.y + 12);
    await page.mouse.down();
    await page.mouse.move(last.x + last.width - 3, last.y + last.height - 3, { steps: 1 });
    await page.mouse.up();
    await expect(drawer.getByRole('checkbox', { checked: true })).toHaveCount(index % 2 === 0 ? 4 : 0);
  }
  await expect.poll(() => requests).toBe(12);
  await expect.poll(async () => (await persistedState(page)).tasks.find(task => task.name === name)?.progress).toBe(0);
});

test('a highlighted selection survives pointer capture loss until the mouse is released', async ({ page }) => {
  await openWorkspace(page);
  const name = uniqueName('捕获丢失仍提交');
  const drawer = await importCourse(page, name, '### Lessons\n- Lesson A\n- Lesson B\n- Lesson C\n- Lesson D\n');
  const root = drawer.locator('.course-items');
  const first = (await drawer.locator('[data-course-item]').first().boundingBox())!;
  const last = (await drawer.locator('[data-course-item]').last().boundingBox())!;
  await root.evaluate(element => element.addEventListener('gotpointercapture', event => {
    element.setAttribute('data-test-pointer', String((event as PointerEvent).pointerId));
  }));
  await page.mouse.move(first.x + 35, first.y + 10);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width - 4, last.y + last.height - 4, { steps: 2 });
  await expect(drawer.locator('[data-course-item].outline')).toHaveCount(4);
  await root.evaluate(element => element.releasePointerCapture(Number(element.getAttribute('data-test-pointer'))));
  await page.mouse.move(last.x + last.width - 3, last.y + last.height - 3);
  await page.mouse.up();
  await expect(drawer.getByRole('checkbox', { checked: true })).toHaveCount(4);
  await expect.poll(async () => (await persistedState(page)).tasks.find(task => task.name === name)?.progress).toBe(4);
});
