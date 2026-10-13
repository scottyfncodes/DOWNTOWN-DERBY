import { describe, expect, it } from 'vitest';
import { DESTRUCTIBLE_ROWS, PITCH, estimateCells, generateLayout, planCity, toBuildingSpec } from '../src/logic/citylayout';
import { Structure } from '../src/logic/structure';

describe('city plan', () => {
  it('is deterministic and splits lots into destructible and backdrop', () => {
    const a = planCity();
    const b = planCity();
    expect(a.destructible.length).toBe(b.destructible.length);
    expect(a.destructible.length).toBeGreaterThanOrEqual(20);
    expect(a.destructible.length).toBeLessThanOrEqual(60);
    expect(a.backdrop.length).toBeGreaterThan(0);
    expect(a.all.length).toBe(a.destructible.length + a.backdrop.length);
    for (const spec of a.destructible) {
      expect(spec.z).toBeGreaterThan(-(76 + DESTRUCTIBLE_ROWS * PITCH));
      expect(spec.floors).toBeGreaterThanOrEqual(2);
      expect(spec.nx).toBeGreaterThanOrEqual(2);
      expect(spec.nz).toBeGreaterThanOrEqual(2);
    }
  });

  it('keeps the destructible city within a mobile budget of cells', () => {
    const plan = planCity();
    const total = plan.destructible.reduce((a, s) => a + estimateCells(s), 0);
    expect(total).toBeLessThan(7600);
    const built = plan.destructible.reduce((a, s) => a + new Structure(s).cells.length, 0);
    expect(built).toBe(total);
  });

  it('offers a mix of materials and both demolishable low-rises and tall towers', () => {
    const plan = planCity();
    const styles = new Set(plan.destructible.map((s) => s.style));
    expect(styles.size).toBeGreaterThanOrEqual(3);
    expect(plan.destructible.some((s) => s.floors <= 6 && !s.core)).toBe(true);
    expect(plan.destructible.some((s) => s.floors >= 12 && s.core)).toBe(true);
  });

  it('snaps heights to whole floors and leaves a street gap in front of the first row', () => {
    const b = generateLayout().find((x) => x.row === 0)!;
    const spec = toBuildingSpec(b, 0);
    expect(spec.h).toBeCloseTo(spec.floors * (spec.h / spec.floors));
    expect(Math.abs(spec.h - b.h)).toBeLessThan(3);
    const nearest = Math.max(...generateLayout().map((x) => x.z + x.d / 2));
    expect(nearest).toBeLessThan(-44);
  });
});
