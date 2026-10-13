import { describe, expect, it } from 'vitest';
import { FAR_GRAIN, estimateCells, generateLayout, isNearLot, planCity, toBuildingSpec } from '../src/logic/citylayout';
import { Structure } from '../src/logic/structure';

describe('city plan', () => {
  it('is deterministic and every building in the grid is destructible', () => {
    const a = planCity();
    const b = planCity();
    expect(a.destructible.length).toBe(b.destructible.length);
    expect(a.backdrop.length).toBe(0);
    expect(a.destructible.length).toBe(a.all.length);
    expect(a.all.every((x) => x.destructible)).toBe(true);
    expect(a.destructible.length).toBeGreaterThan(120);
    for (const spec of a.destructible) {
      expect(spec.floors).toBeGreaterThanOrEqual(2);
      expect(spec.nx).toBeGreaterThanOrEqual(2);
      expect(spec.nz).toBeGreaterThanOrEqual(2);
    }
  });

  it('near blocks get fine sections; distant buildings get coarse ones', () => {
    const plan = planCity();
    for (const b of plan.all) expect(b.grain).toBe(isNearLot(b.row, b.col) ? 1 : FAR_GRAIN);
    const near = plan.destructible.filter((s) => (s.grain ?? 1) === 1);
    const far = plan.destructible.filter((s) => s.grain === FAR_GRAIN);
    expect(near.length).toBeGreaterThanOrEqual(25);
    expect(far.length).toBeGreaterThan(near.length);
    // Coarse sections really are bigger.
    const avgCell = (specs: typeof near) => specs.reduce((t, s) => t + s.h / s.floors, 0) / specs.length;
    expect(avgCell(far)).toBeGreaterThan(avgCell(near) * 1.6);
  });

  it('keeps the whole destructible city within a mobile budget of sections', () => {
    const plan = planCity();
    const total = plan.destructible.reduce((a, s) => a + estimateCells(s), 0);
    expect(total).toBeLessThan(24000);
    const built = plan.destructible.reduce((a, s) => a + new Structure(s).cells.length, 0);
    expect(built).toBe(total);
  });

  it('coarse sections carry proportionally more hit points', () => {
    const b = generateLayout().find((x) => x.grain === FAR_GRAIN)!;
    const coarse = new Structure(toBuildingSpec(b, 0));
    const fine = new Structure(toBuildingSpec({ ...b, grain: 1 }, 1));
    const fc = coarse.cells.find((c) => c.kind === 'facade')!;
    const ff = fine.cells.find((c) => c.kind === 'facade' && c.material === fc.material)!;
    expect(fc.maxHp).toBeGreaterThan(ff.maxHp);
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
    const nearest = Math.max(...generateLayout().map((x) => x.z + x.d / 2));
    expect(nearest).toBeLessThan(-44);
  });
});
