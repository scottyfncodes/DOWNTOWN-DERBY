import { test, expect, type Page } from '@playwright/test';

test.use({ deviceScaleFactor: 1 });

const SHOT_DIR = process.env.SHOT_DIR ?? 'test-results';

interface ShotInfo {
  score: number;
  objectsDamaged: number;
  chainCount: number;
  bestCombo: number;
  distance: number;
  quality: string;
  sectionsDestroyed: number;
  buildingsDamaged: number;
  buildingsCollapsed: number;
  chainCollapses: number;
  detonated: boolean;
}

/** Headless containers have no GPU: render sparsely and step the simulation at a fixed rate so the loop runs near real time. */
async function headlessMode(page: Page) {
  await page.evaluate(() => {
    const g = (window as unknown as { __derby: { debug: { renderEvery: number; fixedDt: number | null } } }).__derby;
    g.debug.renderEvery = 12;
    g.debug.fixedDt = 1 / 60;
  });
}

async function waitForState(page: Page, s: string, timeout = 90_000) {
  await page.waitForFunction((target) => (window as unknown as { __derby: { round: { state: string } } }).__derby.round.state === target, s, { timeout });
}
async function roundInfo(page: Page) {
  return page.evaluate(() => {
    const g = (window as unknown as { __derby: { round: { ballsUsed: number; total: number; shots: ShotInfo[] } } }).__derby;
    return { ballsUsed: g.round.ballsUsed, total: g.round.total, shots: g.round.shots };
  });
}

/**
 * Plays one pitch. `swingOffset` is seconds relative to the perfect tap (0 = perfect, large positive = late whiff);
 * `detonateAfter` is seconds after ignition to detonate (null = let the fuse decide).
 */
async function playPitch(page: Page, swingOffset: number, yaw: number, loft: number, detonateAfter: number | null) {
  await waitForState(page, 'AIMING');
  await page.evaluate(
    ({ yaw, loft, swingOffset, detonateAfter }) => {
      const g = (window as unknown as { __derby: { aim: { yaw: number; loft: number }; debug: { autoSwing: number | null; autoDetonate: number | null } } }).__derby;
      g.aim.yaw = yaw;
      g.aim.loft = loft;
      g.debug.autoSwing = swingOffset;
      g.debug.autoDetonate = detonateAfter;
    },
    { yaw, loft, swingOffset, detonateAfter },
  );
  await waitForState(page, 'PITCHING', 30_000);
  await expect(page.locator('#pitch-pill')).toHaveClass(/visible/);
  await waitForState(page, 'SHOT_RESULTS', 150_000);
}

test('a visible pitcher throws, the batter swings, rockets detonate and buildings come down over a full round', async ({ page }) => {
  test.setTimeout(1_500_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/');
  await expect(page.locator('#play-btn')).toBeVisible({ timeout: 60_000 });
  await headlessMode(page);
  await page.locator('#play-btn').click({ force: true });
  await waitForState(page, 'AIMING');
  await expect(page.locator('#hud')).toHaveClass(/visible/);
  await expect(page.locator('#balls-value')).toContainText('1');
  await expect(page.locator('#swing-btn')).toBeVisible();

  // The destructible city exists and is pristine.
  const cityBefore = await page.evaluate(() => (window as unknown as { __derby: { structures: { stats: () => { damaged: number; collapsed: number; broken: number }; structures: unknown[] } } }).__derby.structures.stats());
  expect(cityBefore.broken).toBe(0);

  const plan: { swing: number; yaw: number; loft: number; det: number | null }[] = [
    { swing: 0, yaw: 0, loft: -4, det: 1.0 }, // perfect line drive, detonate inside the first rows
    { swing: 0.02, yaw: -0.2, loft: 2, det: 0.45 }, // early detonation
    { swing: 0, yaw: 0.15, loft: -8, det: null }, // let the fuse run
    { swing: -0.09, yaw: 0, loft: 6, det: 1.6 }, // solid
    { swing: 0, yaw: 0.3, loft: 0, det: 1.3 },
    { swing: 0.2, yaw: 0, loft: 12, det: null }, // poor: no rocket
    { swing: 0, yaw: -0.3, loft: -6, det: 0.9 },
    { swing: 0.45, yaw: 0, loft: 10, det: null }, // whiff (late by more than the miss threshold)
    { swing: 0, yaw: 0.05, loft: -2, det: 1.4 },
    { swing: -0.02, yaw: -0.1, loft: 4, det: 2.0 },
  ];
  for (let i = 0; i < plan.length; i++) {
    const p = plan[i];
    const before = await roundInfo(page);
    expect(before.ballsUsed).toBe(i);
    await playPitch(page, p.swing, p.yaw, p.loft, p.det);
    if (i === 0) await page.screenshot({ path: `${SHOT_DIR}/shot-card.png` });
    const after = await roundInfo(page);
    expect(after.ballsUsed).toBe(i + 1);
    expect(after.shots.length).toBe(i + 1);
    expect(after.total).toBe(after.shots.reduce((a, s) => a + s.score, 0));
    await expect(page.locator('#shot-card')).toHaveClass(/visible/);
    const s = after.shots[i];
    console.log(`shot ${i + 1}: ${s.quality} score=${s.score} sections=${s.sectionsDestroyed} buildings=${s.buildingsDamaged} collapsed=${s.buildingsCollapsed} chain=${s.chainCollapses} detonated=${s.detonated} dist=${s.distance}`);
    if (p.swing === 0.45) expect(s.quality).toBe('MISS');
    if (p.swing === 0) expect(s.quality).toBe('PERFECT');
    if (p.swing === 0.2) expect(['POOR', 'WEAK']).toContain(s.quality);
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
  // Real demolition happened: sections broke, rockets detonated, and the city's world state changed.
  expect(info.shots.some((s) => s.sectionsDestroyed > 0)).toBe(true);
  expect(info.shots.some((s) => s.detonated)).toBe(true);
  expect(info.shots.filter((s) => s.quality === 'PERFECT' || s.quality === 'SOLID').every((s) => s.detonated)).toBe(true);
  expect(info.shots.filter((s) => s.quality === 'POOR' || s.quality === 'WEAK' || s.quality === 'MISS').every((s) => !s.detonated)).toBe(true);
  expect(info.total).toBeGreaterThan(0);
  const cityAfter = await page.evaluate(() => (window as unknown as { __derby: { structures: { stats: () => { damaged: number; collapsed: number; broken: number } } } }).__derby.structures.stats());
  expect(cityAfter.broken).toBeGreaterThan(0);
  expect(cityAfter.damaged).toBeGreaterThan(0);
  console.log('city after round:', JSON.stringify(cityAfter));

  // Restart without reload: the world resets and the loop runs again.
  await page.locator('#play-again-btn').click({ force: true });
  await waitForState(page, 'AIMING');
  const fresh = await roundInfo(page);
  expect(fresh.ballsUsed).toBe(0);
  expect(fresh.total).toBe(0);
  await expect(page.locator('#score-value')).toHaveText('0');
  const cityReset = await page.evaluate(() => (window as unknown as { __derby: { structures: { stats: () => { damaged: number; collapsed: number; broken: number } } } }).__derby.structures.stats());
  expect(cityReset.broken).toBe(0);
  expect(cityReset.collapsed).toBe(0);
  await playPitch(page, 0, 0, -2, 1.0);
  const second = await roundInfo(page);
  expect(second.ballsUsed).toBe(1);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('a taken pitch costs nothing and the pitcher throws again; DETONATE appears only for a lit rocket', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('/');
  await expect(page.locator('#play-btn')).toBeVisible({ timeout: 60_000 });
  await headlessMode(page);
  await page.locator('#play-btn').click({ force: true });
  await waitForState(page, 'AIMING');
  await expect(page.locator('#detonate-btn')).toBeHidden();
  await waitForState(page, 'PITCHING', 30_000);
  // Do not swing: the pitch goes by.
  await waitForState(page, 'AIMING', 30_000);
  const info = await roundInfo(page);
  expect(info.ballsUsed).toBe(0);
  // Now a real swing with a long fuse: the detonate button must show up during flight.
  await page.evaluate(() => {
    const g = (window as unknown as { __derby: { aim: { yaw: number; loft: number }; debug: { autoSwing: number | null; autoDetonate: number | null } } }).__derby;
    g.aim.loft = 2;
    g.debug.autoSwing = 0;
    g.debug.autoDetonate = null;
  });
  await waitForState(page, 'PITCHING', 30_000);
  await waitForState(page, 'BALL_IN_FLIGHT', 30_000);
  await expect(page.locator('#detonate-btn')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('#detonate-btn')).toHaveClass(/lit/, { timeout: 20_000 });
  await page.screenshot({ path: `${SHOT_DIR}/rocket.png` });
  // Player taps DETONATE.
  const box = (await page.locator('#detonate-btn').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  await expect(page.locator('#detonate-btn')).toBeHidden({ timeout: 5_000 });
  await page.screenshot({ path: `${SHOT_DIR}/blast.png` });
  await waitForState(page, 'SHOT_RESULTS', 120_000);
  const after = await roundInfo(page);
  expect(after.ballsUsed).toBe(1);
  expect(after.shots[0].detonated).toBe(true);
});
