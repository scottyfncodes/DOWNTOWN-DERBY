import { test, expect } from '@playwright/test';

test('loads to the title screen without runtime errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/');
  await expect(page.locator('#play-btn')).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: process.env.SHOT_DIR ? `${process.env.SHOT_DIR}/title.png` : 'test-results/title.png' });
  expect(errors, errors.join('\n')).toEqual([]);
});
