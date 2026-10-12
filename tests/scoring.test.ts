import { describe, expect, it } from 'vitest';
import { COMBO_GRACE, MATERIAL_VALUE, MAX_COMBO, ShotScorer, comboMultiplier, creditsForRound } from '../src/logic/scoring';
import type { ImpactEvent, MaterialKind } from '../src/logic/types';

function ev(objectId: string, material: MaterialKind, time: number, extra: Partial<ImpactEvent> = {}): ImpactEvent {
  return { objectId, material, time, speed: 30, direct: true, destroyed: false, position: { x: 0, y: 0, z: 0 }, ...extra };
}

describe('ShotScorer', () => {
  it('scores a direct glass hit by material value and speed', () => {
    const s = new ShotScorer();
    const line = s.impact(ev('g1', 'glass', 1, { destroyed: true }));
    expect(line).not.toBeNull();
    expect(line!.points).toBeGreaterThan(MATERIAL_VALUE.glass);
    expect(s.glassBroken).toBe(1);
    expect(s.objectsDamaged.size).toBe(1);
  });

  it('builds a combo across successive impacts within the grace period', () => {
    const s = new ShotScorer();
    s.impact(ev('a', 'glass', 1));
    expect(s.combo).toBe(1);
    s.impact(ev('b', 'hvac', 1.5));
    expect(s.combo).toBe(1.5);
    s.impact(ev('c', 'sign', 2.2));
    expect(s.combo).toBe(2);
    expect(s.bestCombo).toBe(2);
    expect(s.chainCount).toBe(3);
  });

  it('expires the combo after the grace period', () => {
    const s = new ShotScorer();
    s.impact(ev('a', 'glass', 1));
    s.impact(ev('b', 'hvac', 1.5));
    expect(s.combo).toBe(1.5);
    expect(s.tick(1.5 + COMBO_GRACE + 0.01)).toBe(true);
    expect(s.combo).toBe(1);
    const line = s.impact(ev('c', 'sign', 5));
    expect(line!.combo).toBe(1);
  });

  it('caps the combo multiplier', () => {
    const s = new ShotScorer();
    for (let i = 0; i < 12; i++) s.impact(ev(`o${i}`, 'crate', 1 + i * 0.2));
    expect(s.combo).toBe(MAX_COMBO);
    expect(comboMultiplier(99)).toBe(MAX_COMBO);
  });

  it('prevents duplicate scoring from the same pair grinding together', () => {
    const s = new ShotScorer();
    expect(s.impact(ev('a', 'crate', 1, { direct: false }), 'a|b')).not.toBeNull();
    expect(s.impact(ev('a', 'crate', 1.1, { direct: false }), 'a|b')).toBeNull();
    expect(s.impact(ev('a', 'crate', 1.2, { direct: false }), 'a|b')).toBeNull();
    expect(s.impact(ev('a', 'crate', 2, { direct: false }), 'a|b')).not.toBeNull();
  });

  it('caps per-object contribution so nothing can be farmed', () => {
    const s = new ShotScorer();
    let awarded = 0;
    for (let i = 0; i < 20; i++) {
      const l = s.impact(ev('tower', 'watertower', 1 + i * 0.3, { speed: 60 }), `tower|x${i}`);
      if (l) awarded++;
    }
    expect(awarded).toBeLessThanOrEqual(3);
    const tot = s.lines.reduce((a, l) => a + l.points, 0);
    expect(tot).toBe(s.score);
  });

  it('secondary destruction scores less than a direct hit and needs speed', () => {
    const direct = new ShotScorer();
    const secondary = new ShotScorer();
    const d = direct.impact(ev('x', 'sign', 1, { direct: true }))!;
    const sec = secondary.impact(ev('x', 'sign', 1, { direct: false }))!;
    expect(sec.points).toBeLessThan(d.points);
    expect(secondary.impact(ev('y', 'sign', 1.2, { direct: false, speed: 1 }))).toBeNull();
  });

  it('ignores static walls after a couple of bounces and never chains them', () => {
    const s = new ShotScorer();
    expect(s.impact(ev('b1', 'concrete', 1))).not.toBeNull();
    expect(s.impact(ev('b2', 'concrete', 1.2))).not.toBeNull();
    expect(s.impact(ev('b3', 'concrete', 1.4))).toBeNull();
    expect(s.combo).toBe(1);
  });

  it('bonus target doubles and destruction adds', () => {
    const plain = new ShotScorer().impact(ev('a', 'billboard', 1))!;
    const bonus = new ShotScorer().impact(ev('a', 'billboard', 1, { bonusTarget: true }))!;
    const destroyed = new ShotScorer().impact(ev('a', 'billboard', 1, { destroyed: true }))!;
    expect(bonus.points).toBeGreaterThan(plain.points * 1.8);
    expect(destroyed.points).toBeGreaterThan(plain.points);
  });

  it('finishes with distance, contact and chain bonuses', () => {
    const s = new ShotScorer();
    for (let i = 0; i < 6; i++) s.impact(ev(`o${i}`, 'glass', 1 + i * 0.3, { destroyed: true }));
    s.impact(ev('car', 'car', 3));
    const sum = s.finish(220, 'PERFECT');
    expect(sum.distance).toBe(220);
    expect(sum.lines.some((l) => l.kind === 'distance')).toBe(true);
    expect(sum.lines.some((l) => l.kind === 'contact')).toBe(true);
    expect(sum.lines.some((l) => l.kind === 'chain')).toBe(true);
    expect(sum.uniqueMaterials).toBe(2);
    expect(sum.score).toBe(sum.lines.reduce((a, l) => a + l.points, 0));
    expect(s.impact(ev('late', 'glass', 10))).toBeNull();
  });

  it('a whiff earns no distance bonus', () => {
    const s = new ShotScorer();
    const sum = s.finish(3, 'MISS');
    expect(sum.score).toBe(0);
  });

  it('damage dominates distance', () => {
    const chain = new ShotScorer();
    for (let i = 0; i < 5; i++) chain.impact(ev(`g${i}`, 'glass', 1 + i * 0.2, { destroyed: true }));
    const chainSum = chain.finish(120, 'SOLID');
    const long = new ShotScorer().finish(400, 'SOLID');
    expect(chainSum.score).toBeGreaterThan(long.score);
  });

  it('credits grow with score', () => {
    expect(creditsForRound(0, 1, 0)).toBe(25);
    expect(creditsForRound(20000, 3, 2)).toBeGreaterThan(creditsForRound(5000, 1, 0));
  });
});
