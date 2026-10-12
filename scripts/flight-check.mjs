// Dev tool: plays four shots against the preview build and captures flight screenshots.
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
await page.evaluate(() => document.getElementById('play-btn').click());
const st = () => page.evaluate(() => window.__derby.round.state);
const waitState = (s, t = 120000) => page.waitForFunction((s) => window.__derby.round.state === s, s, { timeout: t });
const plan = [
  { yaw: 0, loft: 14, hold: 585 },
  { yaw: -0.3, loft: 22, hold: 585 },
  { yaw: 0.25, loft: 8, hold: 585 },
  { yaw: 0.1, loft: 32, hold: 620 },
];
for (let i = 0; i < plan.length; i++) {
  await waitState('AIMING');
  await page.evaluate((p) => { window.__derby.aim.yaw = p.yaw; window.__derby.aim.loft = p.loft; }, plan[i]);
  await page.waitForTimeout(800);
  if (i === 0) await page.screenshot({ path: `${dir}/aim.png` });
  const box = await page.locator('#swing-btn').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(plan[i].hold);
  await page.mouse.up();
  const t0 = Date.now();
  let k = 0;
  while ((await st()) !== 'SHOT_RESULTS' && Date.now() - t0 < 240000) {
    await page.waitForTimeout(700);
    if (k % 5 === 0) console.log('  t', ((Date.now() - t0) / 1000).toFixed(1), await page.evaluate(() => { const g = window.__derby; const b = g.ball; return `${g.round.state} pos=${b.pos.x.toFixed(0)},${b.pos.y.toFixed(0)},${b.pos.z.toFixed(0)} v=${b.vel.length().toFixed(1)} ft=${b.flightTime.toFixed(1)} rest=${b.restTimer.toFixed(1)} awake=${g.props.awakeCount()}`; }));
    if (i < 2 && k < 5) await page.screenshot({ path: `${dir}/flight-${i}-${k}.png` });
    k++;
  }
  const info = await page.evaluate(() => { const s = window.__derby.round.shots.at(-1); return { ...s, lines: s.lines.map((l) => `${l.label}:${l.points}`).join(', ') }; });
  console.log(`shot ${i + 1}:`, info.quality, 'score', info.score, 'dist', info.distance, 'objs', info.objectsDamaged, 'chain', info.chainCount, 'combo', info.bestCombo, '|', info.lines);
  await page.waitForTimeout(600);
  await page.evaluate(() => document.getElementById('shot-card').click());
}
await browser.close();
