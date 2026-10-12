import { expect, test } from '@playwright/test';
import { openWorkspace, expectNoHorizontalOverflow } from './helpers';

test('template picker fits narrow screens and closes back to the draft in both themes', async ({ page }, testInfo) => {
  await openWorkspace(page);
  await page.setViewportSize({ width: 320, height: 740 });
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => document.documentElement.classList.toggle('dark', value === 'dark'), theme);
    await page.getByRole('button', { name: '添加任务', exact: true }).click();
    const form = page.getByRole('dialog', { name: '从一个小目标开始', exact: true });
    await form.getByLabel('任务名称', { exact: true }).fill('保留我的草稿');
    await form.getByRole('button', { name: '使用模板', exact: true }).click();
    const picker = page.getByRole('dialog', { name: '选择任务模板', exact: true });
    await expect(picker.getByRole('button', { name: '应用模板：阅读计划', exact: true })).toBeEnabled();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`templates-phone-${theme}.png`) });
    await picker.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(form.getByLabel('任务名称', { exact: true })).toHaveValue('保留我的草稿');
    await form.getByRole('button', { name: '取消', exact: true }).click();
  }
});
