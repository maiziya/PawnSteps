import { expect, test } from '@playwright/test';
import { createTask, openWorkspace, persistedState, taskCard, uniqueName } from './helpers';

test.use({ reducedMotion: 'no-preference' });

for (const outcome of ['success', 'failure'] as const) {
  test(`pointer release keeps the dropped order while saving and handles ${outcome}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openWorkspace(page);
    const names = [uniqueName('拖拽第一项'), uniqueName('拖拽第二项'), uniqueName('拖拽第三项')];
    for (const name of names) await createTask(page, name, { target: 10 });
    const expected = [names[1], names[2], names[0]];
    const handle = taskCard(page, names[0]).getByRole('button', { name: `拖动排序${names[0]}`, exact: true });
    const handleBounds = (await handle.boundingBox())!;
    const firstBounds = (await taskCard(page, names[0]).boundingBox())!;
    const destination = (await taskCard(page, names[2]).boundingBox())!;
    let received = false;
    let releaseResponse!: () => void;
    const responseGate = new Promise<void>(resolve => { releaseResponse = resolve; });
    await page.route('**/api/tasks/reorder', async route => {
      received = true;
      await responseGate;
      if (outcome === 'failure') await route.fulfill({ status: 500, json: { detail: '排序暂时无法保存' } });
      else await route.continue();
    });
    await page.mouse.move(handleBounds.x + handleBounds.width / 2, handleBounds.y + handleBounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBounds.x + handleBounds.width / 2, handleBounds.y + handleBounds.height / 2 + 12, { steps: 2 });
    await expect(handle).toHaveAttribute('aria-pressed', 'true');
    await page.mouse.move(handleBounds.x + handleBounds.width / 2, handleBounds.y + handleBounds.height / 2 + destination.y - firstBounds.y, { steps: 14 });
    const response = page.waitForResponse(result => new URL(result.url()).pathname === '/api/tasks/reorder' && result.request().method() === 'POST');
    await page.mouse.up();
    try {
      await expect.poll(() => received).toBe(true);
      const frames = await page.evaluate(async (draggedName: string) => {
        const samples: { elapsed: number; order: string[]; draggedY: number }[] = [];
        const start = performance.now();
        do {
          await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
          const cards = [...document.querySelectorAll<HTMLElement>('article.task-card')];
          samples.push({
            elapsed: Math.round(performance.now() - start),
            order: cards.map(card => card.querySelector('h3')!.textContent!),
            draggedY: Math.round(cards.find(card => card.querySelector('h3')?.textContent === draggedName)!.getBoundingClientRect().y),
          });
        } while (performance.now() - start < 450);
        return samples;
      }, names[0]);
      await testInfo.attach('drag-release-frames', { body: JSON.stringify({ originalY: firstBounds.y, droppedY: destination.y, frames }, null, 2), contentType: 'application/json' });
      console.log(JSON.stringify({ outcome, originalY: firstBounds.y, droppedY: destination.y, firstFrame: frames[0], lastFrame: frames.at(-1), minDraggedY: Math.min(...frames.map(frame => frame.draggedY)) }));
      expect.soft(frames[0].order, 'The dropped order must be committed locally before the server responds').toEqual(expected);
      expect.soft(frames.every(frame => frame.order.join('|') === expected.join('|')), 'The DOM order must remain stable throughout the pending response').toBe(true);
      expect.soft(Math.min(...frames.map(frame => frame.draggedY)), 'The dragged card must not animate back to its original slot while saving').toBeGreaterThanOrEqual(destination.y - 24);
    } finally { releaseResponse(); }
    expect((await response).status()).toBe(outcome === 'success' ? 200 : 500);
    await expect(page.locator('article.task-card h3')).toHaveText(outcome === 'success' ? expected : names);
    const afterResponse = await page.evaluate(async draggedName => {
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const cards = [...document.querySelectorAll<HTMLElement>('article.task-card')];
      return { order: cards.map(card => card.querySelector('h3')!.textContent!), draggedY: Math.round(cards.find(card => card.querySelector('h3')?.textContent === draggedName)!.getBoundingClientRect().y) };
    }, names[0]);
    await testInfo.attach('drag-after-response', { body: JSON.stringify(afterResponse, null, 2), contentType: 'application/json' });
    console.log(JSON.stringify({ outcome, afterResponse }));
    await expect.poll(async () => (await persistedState(page)).tasks.map(task => task.name)).toEqual(outcome === 'success' ? expected : names);
    await page.reload();
    await expect(page.locator('article.task-card h3')).toHaveText(outcome === 'success' ? expected : names);
  });
}
