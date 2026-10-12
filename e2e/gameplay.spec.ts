import { test, expect, type Page } from '@playwright/test';

test.use({ deviceScaleFactor: 1 });

const SHOT_DIR = process.env.SHOT_DIR ?? 'test-results';

async function state(page: Page): Promise<string> {
  return page.evaluate(() => (window as unknown as { __derby: { round: { state: string } } }).__derby.round.state);
}
async function waitForState(page: Page, s: string, timeout = 90_000) {
  await page.waitForFunction((target) => (window as unknown as { __derby: { round: { state: string } } }).__derby.round.state === target, s, { timeout });
}
async function roundInfo(page: Page) {
  return page.evaluate(() => {
    const g = (window as unknown as { __derby: { round: { ballsUsed: number; total: number; shots: { score: number; objectsDamaged: number; chainCount: number; bestCombo: number; distance: number; quality: string }[] } } }).__derby;
    return { ballsUsed: g.round.ballsUsed, total: g.round.total, shots: g.round.shots };
  });
}

async function swing(page: Page, holdMs: number, yaw: number, loft: number) {
  await waitForState(page, 'AIMING');
  await page.evaluate(({ yaw, loft }) => {
    const g = (window as unknown as { __derby: { aim: { yaw: number; loft: number } } }).__derby;
    g.aim.yaw = yaw;
    g.aim.loft = loft;
  }, { yaw, loft });
  const btn = page.locator('#swing-btn');
  const box = (await btn.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(holdMs);
  await page.mouse.up();
  await waitForState(page, 'SHOT_RESULTS', 120_000);
}

test('plays a full ten-ball round, restarts, and plays again', async ({ page }) => {
  test.setTimeout(1_200_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/');
  await expect(page.locator('#play-btn')).toBeVisible({ timeout: 60_000 });
  await page.locator('#play-btn').click({ force: true });
  await waitForState(page, 'AIMING');
  await expect(page.locator('#hud')).toHaveClass(/visible/);
  await expect(page.locator('#balls-value')).toContainText('1');

  // Sweet spot is at 0.78 of a 0.75s sweep → ~585ms. Vary timing and aim across the round.
  const plan = [
    { hold: 585, yaw: 0, loft: 18 },
    { hold: 585, yaw: -0.25, loft: 26 },
    { hold: 585, yaw: 0.2, loft: 12 },
    { hold: 585, yaw: 0.35, loft: 30 },
    { hold: 640, yaw: -0.4, loft: 22 },
    { hold: 500, yaw: 0.1, loft: 36 },
    { hold: 585, yaw: -0.1, loft: 10 },
    { hold: 585, yaw: 0.45, loft: 20 },
    { hold: 200, yaw: 0, loft: 24 }, // mistimed
    { hold: 585, yaw: -0.3, loft: 40 },
  ];
  for (let i = 0; i < plan.length; i++) {
    const p = plan[i];
    const before = await roundInfo(page);
    expect(before.ballsUsed).toBe(i);
    await swing(page, p.hold, p.yaw, p.loft);
    if (i === 0) await page.screenshot({ path: `${SHOT_DIR}/shot-card.png` });
    const after = await roundInfo(page);
    expect(after.ballsUsed).toBe(i + 1);
    expect(after.shots.length).toBe(i + 1);
    expect(after.total).toBe(after.shots.reduce((a, s) => a + s.score, 0));
    await expect(page.locator('#shot-card')).toHaveClass(/visible/);
    console.log(`shot ${i + 1}: ${after.shots[i].quality} score=${after.shots[i].score} dist=${after.shots[i].distance} objs=${after.shots[i].objectsDamaged} chain=${after.shots[i].chainCount} combo=${after.shots[i].bestCombo}`);
    await page.waitForTimeout(600);
    await page.locator('#shot-card').click();
    if (i < plan.length - 1) await waitForState(page, 'AIMING');
  }
  await waitForState(page, 'ROUND_COMPLETE');
  const info = await roundInfo(page);
  expect(info.ballsUsed).toBe(10);
  await expect(page.locator('#results')).toHaveClass(/visible/);
  await expect(page.locator('#results-total')).toHaveText(info.total.toLocaleString('en-US'));
  await page.screenshot({ path: `${SHOT_DIR}/results.png` });
  expect(info.shots.some((s) => s.objectsDamaged > 0)).toBe(true);
  expect(info.total).toBeGreaterThan(0);

  // Restart without reload.
  await page.locator('#play-again-btn').click({ force: true });
  await waitForState(page, 'AIMING');
  const fresh = await roundInfo(page);
  expect(fresh.ballsUsed).toBe(0);
  expect(fresh.total).toBe(0);
  await expect(page.locator('#score-value')).toHaveText('0');
  await swing(page, 585, 0, 20);
  const second = await roundInfo(page);
  expect(second.ballsUsed).toBe(1);
  expect(errors, errors.join('\n')).toEqual([]);
});
