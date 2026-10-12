import { describe, expect, it } from 'vitest';
import { computeLaunch, evaluateContact, meterPosition, previewTrajectory, qualityFromError, sweetWidthFor } from '../src/logic/batting';
import { BATS, BALLS, getBat, getBall } from '../src/logic/equipment';

const bat = getBat('balanced');
const ball = getBall('standard');
const aim = { yaw: 0, loft: 24, spin: { side: 0, lift: 0 } };

describe('timing meter', () => {
  it('ping-pongs between 0 and 1', () => {
    expect(meterPosition(0, 2)).toBeCloseTo(0);
    expect(meterPosition(0.5, 2)).toBeCloseTo(0.5);
    expect(meterPosition(1, 2)).toBeCloseTo(1);
    expect(meterPosition(1.5, 2)).toBeCloseTo(0.5);
    expect(meterPosition(2, 2)).toBeCloseTo(0);
  });
});

describe('contact quality', () => {
  it('buckets by normalized error', () => {
    expect(qualityFromError(0)).toBe('PERFECT');
    expect(qualityFromError(1)).toBe('PERFECT');
    expect(qualityFromError(2)).toBe('SOLID');
    expect(qualityFromError(3.5)).toBe('POOR');
    expect(qualityFromError(6)).toBe('WEAK');
    expect(qualityFromError(9)).toBe('MISS');
  });

  it('rewards exact timing with full power and no aim error', () => {
    const c = evaluateContact({ value: 0.8, sweet: 0.8, sweetWidth: 0.16 }, bat);
    expect(c.quality).toBe('PERFECT');
    expect(c.power).toBe(1);
    expect(c.yawError).toBe(0);
  });

  it('early contact pulls left, late contact pushes right', () => {
    const early = evaluateContact({ value: 0.55, sweet: 0.8, sweetWidth: 0.16 }, bat);
    const late = evaluateContact({ value: 1.0, sweet: 0.8, sweetWidth: 0.16 }, bat);
    expect(early.yawError).toBeLessThan(0);
    expect(late.yawError).toBeGreaterThan(0);
    expect(early.quality).not.toBe('PERFECT');
  });

  it('precision bat widens the timing window', () => {
    const w1 = sweetWidthFor(getBat('balanced'));
    const w2 = sweetWidthFor(getBat('precision'));
    const w3 = sweetWidthFor(getBat('titan'));
    expect(w2).toBeGreaterThan(w1);
    expect(w3).toBeLessThan(w1);
    const timing = { value: 0.86, sweet: 0.8 };
    expect(evaluateContact({ ...timing, sweetWidth: w2 }, getBat('precision')).quality).toBe('PERFECT');
    expect(evaluateContact({ ...timing, sweetWidth: w3 }, getBat('titan')).quality).not.toBe('PERFECT');
  });
});

describe('launch', () => {
  it('sends the ball toward -Z with upward loft', () => {
    const c = evaluateContact({ value: 0.8, sweet: 0.8, sweetWidth: 0.16 }, bat);
    const l = computeLaunch({ aim, contact: c, bat, ball });
    expect(l.velocity.z).toBeLessThan(0);
    expect(l.velocity.y).toBeGreaterThan(0);
    expect(l.speed).toBeGreaterThan(50);
  });

  it('scales with contact power and equipment', () => {
    const perfect = evaluateContact({ value: 0.8, sweet: 0.8, sweetWidth: 0.16 }, bat);
    const poor = evaluateContact({ value: 0.5, sweet: 0.8, sweetWidth: 0.16 }, bat);
    const lp = computeLaunch({ aim, contact: perfect, bat, ball });
    const lq = computeLaunch({ aim, contact: poor, bat, ball });
    expect(lq.speed).toBeLessThan(lp.speed);
    const slug = computeLaunch({ aim, contact: perfect, bat: getBat('slugger'), ball });
    expect(slug.speed).toBeGreaterThan(lp.speed);
    const wreck = computeLaunch({ aim, contact: perfect, bat, ball: getBall('wrecker') });
    expect(wreck.speed).toBeLessThan(lp.speed);
  });

  it('a whiff barely moves the ball', () => {
    const c = evaluateContact({ value: 0.05, sweet: 0.8, sweetWidth: 0.16 }, bat);
    expect(c.quality).toBe('MISS');
    const l = computeLaunch({ aim, contact: c, bat, ball });
    expect(l.speed).toBeLessThan(8);
  });

  it('yaw aim turns the shot', () => {
    const c = evaluateContact({ value: 0.8, sweet: 0.8, sweetWidth: 0.16 }, bat);
    const left = computeLaunch({ aim: { ...aim, yaw: -0.4 }, contact: c, bat, ball });
    const right = computeLaunch({ aim: { ...aim, yaw: 0.4 }, contact: c, bat, ball });
    expect(left.velocity.x).toBeLessThan(0);
    expect(right.velocity.x).toBeGreaterThan(0);
  });

  it('curve ball multiplies spin', () => {
    const c = evaluateContact({ value: 0.8, sweet: 0.8, sweetWidth: 0.16 }, bat);
    const a = computeLaunch({ aim: { ...aim, spin: { side: 1, lift: 0 } }, contact: c, bat, ball });
    const b = computeLaunch({ aim: { ...aim, spin: { side: 1, lift: 0 } }, contact: c, bat, ball: getBall('curve') });
    expect(Math.abs(b.spin.y)).toBeGreaterThan(Math.abs(a.spin.y) * 2);
  });

  it('preview trajectory arcs under gravity', () => {
    const pts = previewTrajectory({ x: 0, y: 70, z: 0 }, { x: 0, y: 30, z: -60 }, 9.81, 30, 0.1);
    expect(pts[0].y).toBe(70);
    expect(pts[10].y).toBeGreaterThan(70);
    expect(pts[29].z).toBeLessThan(-100);
  });
});

describe('equipment catalog', () => {
  it('every variant differs meaningfully from the default', () => {
    for (const b of BATS.slice(1)) {
      expect(b.power !== 1 || b.timingWindow !== 1 || b.spread !== 1).toBe(true);
    }
    for (const b of BALLS.slice(1)) {
      expect(b.speed !== 1 || b.restitution !== 0.52 || b.mass !== 1 || b.curve !== 1).toBe(true);
    }
  });
});
