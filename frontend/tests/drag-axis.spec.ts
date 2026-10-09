import { expect, test } from '@playwright/test';
import { openWorkspace, persistedState, taskCard, uniqueName } from './helpers';

test.use({ reducedMotion: 'no-preference' });

for (const scope of ['all', 'today'] as const) {
  test(`${scope} sorting stays vertical during sideways and diagonal drags`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openWorkspace(page);
    const headers = { 'X-Guest-Id': await page.evaluate(() => localStorage.getItem('pawnsteps-guest-id')!) };
    for (let index = 0; index < 3; index++) {
      const response = await page.request.post('/api/tasks', { headers, data: { name: uniqueName(`纵向排序${index + 1}`), target: 20, daily_minimum: 1 } });
      expect(response.ok()).toBeTruthy();
    }
    const initial = await persistedState(page);
    const globalIds = initial.tasks.map(task => task.id);
    const planIds = [globalIds[2], globalIds[0], globalIds[1]];
    const planned = await page.request.put('/api/day-plan', { headers, data: { date: initial.today, task_ids: planIds } });
    expect(planned.ok()).toBeTruthy();
    await page.reload();
    if (scope === 'today') await page.getByRole('group', { name: '筛选任务', exact: true }).getByRole('button', { name: '今日计划', exact: true }).click();
    const ids = scope === 'today' ? planIds : globalIds;
    const names = ids.map(id => initial.tasks.find(task => task.id === id)!.name);
    await expect(page.locator('article.task-card h3')).toHaveText(names);
    const card = taskCard(page, names[0]);
    const handle = card.getByRole('button', { name: `拖动排序${names[0]}`, exact: true });
    const samples: { direction: string; displacement: number }[] = [];
    const frame = () => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect.poll(async () => {
      const before = (await card.boundingBox())!;
      await frame();
      const after = (await card.boundingBox())!;
      return Math.max(Math.abs(after.x - before.x), Math.abs(after.y - before.y));
    }, { message: 'The selected scope layout should settle before grabbing its first task' }).toBeLessThanOrEqual(0.25);

    for (const direction of [-1, 1]) {
      const before = (await card.boundingBox())!, grip = (await handle.boundingBox())!;
      const pointer = { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 };
      await page.mouse.move(pointer.x, pointer.y); await page.mouse.down();
      try {
        await page.mouse.move(pointer.x + direction * 12, pointer.y, { steps: 2 });
        await expect(handle).toHaveAttribute('aria-pressed', 'true');
        await page.mouse.move(pointer.x + direction * 72, pointer.y, { steps: 6 });
        await frame();
        const displacement = (await card.boundingBox())!.x - before.x;
        samples.push({ direction: direction < 0 ? 'left' : 'right', displacement });
        expect.soft(Math.abs(displacement), 'A horizontal-only drag must keep the task in its original column').toBeLessThanOrEqual(1);
      } finally { await page.mouse.up(); }
      await expect(handle).not.toHaveAttribute('aria-pressed', 'true');
      await expect.poll(async () => Math.abs((await card.boundingBox())!.x - before.x)).toBeLessThanOrEqual(1);
      await expect(page.locator('article.task-card h3')).toHaveText(names);
    }

    const before = (await card.boundingBox())!, grip = (await handle.boundingBox())!;
    const destination = (await taskCard(page, names[2]).boundingBox())!;
    const pointer = { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 };
    await page.mouse.move(pointer.x, pointer.y); await page.mouse.down();
    try {
      await page.mouse.move(pointer.x, pointer.y + 12, { steps: 2 });
      await expect(handle).toHaveAttribute('aria-pressed', 'true');
      await page.mouse.move(pointer.x + (scope === 'today' ? 72 : -72), pointer.y + destination.y - before.y, { steps: 14 });
      await frame();
      const dragged = (await card.boundingBox())!;
      samples.push({ direction: 'diagonal', displacement: dragged.x - before.x });
      expect.soft(Math.abs(dragged.x - before.x), 'A diagonal sorting gesture must keep the task in its original column').toBeLessThanOrEqual(1);
      expect(dragged.y - before.y, 'Vertical movement must remain available').toBeGreaterThan(before.height);
    } finally { await page.mouse.up(); }
    const expectedIds = [...ids.slice(1), ids[0]], expectedNames = [...names.slice(1), names[0]];
    await expect(page.locator('article.task-card h3')).toHaveText(expectedNames);
    await expect.poll(async () => {
      const state = await persistedState(page);
      return { global: state.tasks.map(task => task.id), today: state.today_plan!.task_ids };
    }).toEqual({ global: scope === 'all' ? expectedIds : globalIds, today: scope === 'today' ? expectedIds : planIds });
    await testInfo.attach('drag-axis-displacements', { body: JSON.stringify({ scope, samples }), contentType: 'application/json' });
    await page.reload();
    await expect(page.locator('article.task-card h3')).toHaveText(expectedNames);
  });
}
