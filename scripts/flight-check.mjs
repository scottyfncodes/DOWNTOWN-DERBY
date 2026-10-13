// Dev tool: plays a few pitches against the preview build and captures screenshots of the pitch, flight, rocket and blast.
// usage: node scripts/flight-check.mjs <output-dir>  (requires `npm run preview` on :4173)
import { chromium, devices } from '@playwright/test';
const dir = process.argv[2];
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ ...devices['iPhone 14 Pro'], deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e));
page.on('console', (m) => { if (m.type() === 'error' || (m.type() === 'warning' && !m.text().includes('PCFSoft'))) console.log('CONSOLE', m.type(), m.text()); });
await page.goto('http://127.0.0.1:4173/');
await page.waitForSelector('#play-btn', { timeout: 60000 });
await page.screenshot({ path: `${dir}/title.png` });
await page.evaluate(() => { window.__derby.debug.renderEvery = 12; window.__derby.debug.fixedDt = 1 / 60; window.__derby.debug.pitchSeed = 7; document.getElementById('play-btn').click(); });
const st = () => page.evaluate(() => window.__derby.round.state);
const waitState = (s, t = 120000) => page.waitForFunction((s) => window.__derby.round.state === s, s, { timeout: t });
// Aim at the front face of a chosen building: smallest low-rise (for a collapse) and the nearest tall tower.
const targets = await page.evaluate(() => {
  const g = window.__derby;
  const specs = g.structures.structures.map((s) => s.spec);
  // 2D line-of-fire test from the plate to a building's front-face centre against every other standing footprint.
  const clear = (b) => {
    const x0 = 0, z0 = -13.5, x1 = b.x, z1 = b.z + b.d / 2 + 1;
    for (const o of specs) {
      if (o === b) continue;
      let tmin = 0, tmax = 1, ok = true;
      for (const [p0, p1, lo, hi] of [[x0, x1, o.x - o.w / 2, o.x + o.w / 2], [z0, z1, o.z - o.d / 2, o.z + o.d / 2]]) {
        const d = p1 - p0;
        if (Math.abs(d) < 1e-6) { if (p0 < lo || p0 > hi) { ok = false; break; } continue; }
        let t1 = (lo - p0) / d, t2 = (hi - p0) / d;
        if (t1 > t2) [t1, t2] = [t2, t1];
        tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
        if (tmin > tmax) { ok = false; break; }
      }
      if (ok) return false;
    }
    return true;
  };
  const low = specs.filter((s) => !s.core && clear(s)).sort((a, b) => a.w * a.d - b.w * b.d)[0] ?? specs.filter((s) => !s.core)[0];
  const tall = specs.filter((s) => s.floors >= 8 && clear(s)).sort((a, b) => b.z - a.z)[0] ?? specs.filter((s) => s.floors >= 8)[0];
  return { low, tall, lowClear: clear(low) };
});
const aimAt = (b, frac) => {
  const x0 = 0, y0 = 47, z0 = -13.5;
  const tx = b.x, ty = b.h * frac, tz = b.z + b.d / 2 + 1;
  const yaw = Math.atan2(tx - x0, -(tz - z0));
  const dist = Math.hypot(tx - x0, tz - z0);
  let best = 0, bestErr = 1e9;
  for (let l = -14; l <= 30; l += 0.5) {
    const lr = (l * Math.PI) / 180, v = 70;
    const t = dist / (v * Math.cos(lr));
    const y = y0 + v * Math.sin(lr) * t - 0.5 * 11.5 * t * t * 0.55;
    const err = Math.abs(y - ty);
    if (err < bestErr) { bestErr = err; best = l; }
  }
  return { yaw, loft: best };
};
console.log('targets', JSON.stringify(targets));
const plan = [
  { ...aimAt(targets.low, 0.4), swing: 0, det: null, inside: true },
  { ...aimAt(targets.tall, 0.3), swing: 0.02, det: null, inside: true },
  { ...aimAt(targets.low, 0.3), swing: 0, det: null, inside: true },
  { ...aimAt(targets.tall, 0.6), swing: -0.05, det: null, inside: true },
];
for (let i = 0; i < plan.length; i++) {
  await waitState('AIMING');
  await page.evaluate((p) => { window.__derby.aim.yaw = p.yaw; window.__derby.aim.loft = p.loft; window.__derby.debug.autoSwing = p.swing; window.__derby.debug.autoDetonate = p.det; window.__derby.debug.autoDetonateInside = p.inside; }, plan[i]);
  console.log('plan', JSON.stringify(plan[i]));
  await page.waitForTimeout(600);
  if (i === 0) await page.screenshot({ path: `${dir}/aim.png` });
  await waitState('PITCHING', 30000);
  await page.waitForTimeout(350);
  if (i === 0) await page.screenshot({ path: `${dir}/pitch.png` });
  const t0 = Date.now();
  let k = 0;
  while ((await st()) !== 'SHOT_RESULTS' && Date.now() - t0 < 240000) {
    await page.waitForTimeout(500);
    const line = await page.evaluate(() => { const g = window.__derby; const b = g.ball; return `${g.round.state} rocket=${g.rocket.phase} charge=${g.rocket.charge.toFixed(2)} pos=${b.pos.x.toFixed(0)},${b.pos.y.toFixed(0)},${b.pos.z.toFixed(0)} v=${b.vel.length().toFixed(1)} ft=${b.flightTime.toFixed(1)} chunks=${g.structures.activeChunks} rubble=${g.structures.rubble.count} broken=${g.structures.stats().broken}`; });
    if (k % 4 === 0) console.log('  t', ((Date.now() - t0) / 1000).toFixed(1), line);
    if (i < 2 && k < 8) await page.screenshot({ path: `${dir}/flight-${i}-${k}.png` });
    if (/chunks=[1-9]/.test(line) && k % 2 === 0) await page.screenshot({ path: `${dir}/collapse-${i}-${k}.png` });
    k++;
  }
  const info = await page.evaluate(() => { const s = window.__derby.round.shots.at(-1); return { ...s, lines: s.lines.map((l) => `${l.label}:${l.points}`).join(', ') }; });
  console.log(`shot ${i + 1}:`, info.quality, 'score', info.score, 'sections', info.sectionsDestroyed, 'buildings', info.buildingsDamaged, 'collapsed', info.buildingsCollapsed, 'chain', info.chainCollapses, 'det', info.detonated, '|', info.lines);
  console.log('  blast', JSON.stringify(await page.evaluate(() => window.__derby.lastBlast)));
  await page.screenshot({ path: `${dir}/after-${i}.png` });
  await page.waitForTimeout(600);
  await page.evaluate(() => document.getElementById('shot-card').click());
}
console.log('city:', JSON.stringify(await page.evaluate(() => ({ ...window.__derby.structures.stats(), rubble: window.__derby.structures.rubble.count, buildings: window.__derby.structures.structures.length }))));
await browser.close();
