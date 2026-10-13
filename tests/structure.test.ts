import { describe, expect, it } from 'vitest';
import { CELL_HP, UNSTABLE_MARGIN, Structure, blastDamage, chunksForCollapse, distanceToBox, impactDamage, penetrationRetention, type BuildingSpec } from '../src/logic/structure';
import { ShotScorer } from '../src/logic/scoring';

function brickLowRise(id = 0): BuildingSpec {
  return { id, x: 0, z: -100, w: 24, d: 24, h: 13.8, style: 'brick', floors: 3, nx: 3, nz: 3, core: false };
}
function concreteTower(id = 1): BuildingSpec {
  return { id, x: 60, z: -100, w: 30, d: 30, h: 46, style: 'concrete', floors: 10, nx: 3, nz: 3, core: true };
}
function glassTower(id = 2): BuildingSpec {
  return { id, x: -60, z: -100, w: 36, d: 36, h: 112, style: 'tower', floors: 20, nx: 4, nz: 4, core: true };
}

describe('impact and blast formulas', () => {
  it('impact damage grows with the square of speed and with mass', () => {
    expect(impactDamage(63, 5)).toBeCloseTo(9.92, 1);
    expect(impactDamage(63, 5)).toBeGreaterThan(impactDamage(40, 5) * 2);
    expect(impactDamage(53, 16)).toBeGreaterThan(CELL_HP.concrete);
    expect(impactDamage(100, 5, 2.2)).toBeGreaterThan(CELL_HP.concrete * 2);
  });

  it('a perfect league ball punches through glass and brick but only cracks concrete', () => {
    const dmg = impactDamage(63, 5);
    expect(dmg).toBeGreaterThan(CELL_HP.glass);
    expect(dmg).toBeGreaterThan(CELL_HP.brick);
    expect(dmg).toBeLessThan(CELL_HP.concrete);
  });

  it('penetration keeps more speed through weaker cells and none when it fails to break through', () => {
    const dmg = impactDamage(63, 5);
    expect(penetrationRetention(dmg, CELL_HP.glass)).toBeGreaterThan(penetrationRetention(dmg, CELL_HP.brick));
    expect(penetrationRetention(dmg, CELL_HP.concrete)).toBe(0);
    expect(penetrationRetention(dmg, CELL_HP.glass)).toBeLessThan(0.95);
  });

  it('blast damage falls off to zero at the radius', () => {
    expect(blastDamage(0, 15, 40)).toBe(40);
    expect(blastDamage(7.5, 15, 40)).toBeCloseTo(20);
    expect(blastDamage(15, 15, 40)).toBe(0);
    expect(blastDamage(20, 15, 40)).toBe(0);
    expect(blastDamage(3, 15, 40)).toBeGreaterThan(blastDamage(6, 15, 40));
  });

  it('distance to box is zero inside and measures to the nearest face outside', () => {
    const box = { x: 0, y: 0, z: 0, sx: 4, sy: 2, sz: 6 };
    expect(distanceToBox(0, 0, 0, box)).toBe(0);
    expect(distanceToBox(5, 0, 0, box)).toBe(3);
    expect(distanceToBox(0, 4, 0, box)).toBe(3);
    expect(distanceToBox(2 + 3, 1 + 4, 0, box)).toBe(5);
  });
});

describe('Structure layout', () => {
  it('builds perimeter cells, corners, slabs and (for mid/high-rises) a core', () => {
    const low = new Structure(brickLowRise());
    expect(low.cells.filter((c) => c.kind === 'core').length).toBe(0);
    expect(low.cells.filter((c) => c.kind === 'corner').length).toBe(12);
    expect(low.cells.filter((c) => c.kind === 'facade').length).toBe(3 * (3 + 3) * 2);
    expect(low.cells.filter((c) => c.kind === 'slab').length).toBe(3);
    const tower = new Structure(concreteTower());
    expect(tower.cells.filter((c) => c.kind === 'core').length).toBe(10);
    // facades sit on the perimeter
    for (const c of low.cells.filter((x) => x.kind === 'facade')) {
      const onX = Math.abs(Math.abs(c.x - low.spec.x) - (low.spec.w / 2 - c.sx / 2)) < 1e-6;
      const onZ = Math.abs(Math.abs(c.z - low.spec.z) - (low.spec.d / 2 - c.sz / 2)) < 1e-6;
      expect(onX || onZ).toBe(true);
    }
    expect(low.height).toBeCloseTo(13.8);
    expect(low.floorIntegrity(0)).toBe(1);
  });

  it('uses weak glass skins on towers but strong steel columns', () => {
    const t = new Structure(glassTower());
    const facade = t.cells.find((c) => c.kind === 'facade' && c.iy === 0)!;
    const corner = t.cells.find((c) => c.kind === 'corner')!;
    expect(facade.material).toBe('glass');
    expect(corner.material).toBe('steel');
    expect(corner.maxHp).toBeGreaterThan(CELL_HP.column);
    expect(facade.weight).toBeLessThan(corner.weight / 5);
  });
});

describe('damage persistence and progressive weakening', () => {
  it('cracks then breaks a cell across repeated hits, and stays broken', () => {
    const s = new Structure(brickLowRise());
    const cell = s.cells.find((c) => c.kind === 'facade')!;
    const r1 = s.damage(cell.id, 4)!;
    expect(r1.cracked).toBe(true);
    expect(r1.after).toBe('cracked');
    expect(cell.hp).toBe(3);
    expect(s.damaged).toBe(true);
    const r2 = s.damage(cell.id, 2)!;
    expect(r2.after).toBe('cracked');
    expect(r2.broke).toBe(false);
    const r3 = s.damage(cell.id, 2)!;
    expect(r3.broke).toBe(true);
    expect(cell.state).toBe('broken');
    expect(cell.hp).toBe(0);
    // further hits are absorbed by nothing
    const r4 = s.damage(cell.id, 50)!;
    expect(r4.broke).toBe(false);
    expect(r4.absorbed).toBe(0);
    expect(s.count('broken')).toBe(1);
  });

  it('reports absorbed hit points so projectiles lose the right amount of energy', () => {
    const s = new Structure(brickLowRise());
    const cell = s.cells.find((c) => c.kind === 'facade')!;
    expect(s.damage(cell.id, 10)!.absorbed).toBe(CELL_HP.brick);
    const other = s.cells.find((c) => c.kind === 'facade' && c !== cell)!;
    expect(s.damage(other.id, 3)!.absorbed).toBe(3);
  });

  it('floor integrity drops as bearing cells fail, with cracked cells counting half', () => {
    const s = new Structure(brickLowRise());
    const floor0 = s.cells.filter((c) => c.iy === 0 && c.kind === 'facade');
    s.damage(floor0[0].id, 100);
    const after1 = s.floorIntegrity(0);
    expect(after1).toBeLessThan(1);
    s.damage(floor0[1].id, 4); // cracked
    const after2 = s.floorIntegrity(0);
    expect(after2).toBeLessThan(after1);
    expect(after2).toBeGreaterThan(after1 - (floor0[1].weight / 18));
    expect(s.floorIntegrity(1)).toBe(1);
    expect(s.evaluate()).toBeNull();
  });

  it('ignores invalid cells and non-positive damage', () => {
    const s = new Structure(brickLowRise());
    expect(s.damage(9999, 10)).toBeNull();
    expect(s.damage(0, 0)).toBeNull();
    expect(s.damage(0, -5)).toBeNull();
  });
});

describe('structural collapse', () => {
  it('a low-rise collapses completely once its ground floor loses enough support', () => {
    const s = new Structure(brickLowRise());
    const bearing = s.cells.filter((c) => c.iy === 0 && c.kind !== 'slab');
    // Knock out facades one by one until it fails; it must not fail while above threshold.
    let collapse = null;
    for (const c of bearing) {
      s.damage(c.id, 100);
      collapse = s.evaluate();
      if (collapse) break;
      expect(s.floorIntegrity(0)).toBeGreaterThanOrEqual(s.threshold);
    }
    expect(collapse).not.toBeNull();
    expect(collapse!.floor).toBe(0);
    expect(collapse!.total).toBe(true);
    expect(collapse!.floorsDropped).toBe(3);
    expect(s.collapsed).toBe(true);
    expect(s.topFloor).toBe(0);
    expect(s.height).toBe(0);
    // Every cell is gone from the world model, not just hidden.
    expect(s.count('intact')).toBe(0);
    expect(s.count('cracked')).toBe(0);
    expect(s.cellsNear(0, 5, -100, 50).length).toBe(0);
    expect(collapse!.cells.length).toBeGreaterThan(0);
    expect(s.evaluate()).toBeNull();
  });

  it('a mid-floor failure drops only the floors above and leaves a shorter standing building', () => {
    const s = new Structure(concreteTower());
    const floor4 = s.cells.filter((c) => c.iy === 4 && c.kind !== 'slab');
    for (const c of floor4) s.damage(c.id, 1000);
    const collapse = s.evaluate()!;
    expect(collapse).not.toBeNull();
    expect(collapse.floor).toBe(4);
    expect(collapse.total).toBe(false);
    expect(collapse.floorsDropped).toBe(6);
    expect(s.topFloor).toBe(4);
    expect(s.height).toBeCloseTo(4 * s.floorHeight);
    expect(s.collapsed).toBe(false);
    // floors below are intact and still count
    expect(s.floorIntegrity(0)).toBe(1);
    expect(s.cells.filter((c) => c.iy >= 4 && c.state !== 'broken').length).toBe(0);
    expect(s.cells.filter((c) => c.iy < 4 && c.state === 'intact').length).toBeGreaterThan(0);
    // and it can collapse again lower down later
    for (const c of s.cells.filter((x) => x.iy === 1 && x.kind !== 'slab')) s.damage(c.id, 1000);
    const second = s.evaluate()!;
    expect(second.floor).toBe(1);
    expect(s.collapses).toBe(2);
    expect(s.topFloor).toBe(1);
  });

  it('leans toward the side that lost its support', () => {
    const s = new Structure(concreteTower());
    const spec = s.spec;
    // destroy everything on the +x side of floor 0, plus the core
    for (const c of s.cells.filter((x) => x.iy === 0 && x.kind !== 'slab' && (x.x > spec.x + 1 || x.kind === 'core'))) s.damage(c.id, 1000);
    const collapse = s.evaluate();
    expect(collapse).not.toBeNull();
    expect(collapse!.lean.x).toBeGreaterThan(0.9);
    expect(Math.abs(collapse!.lean.z)).toBeLessThan(0.3);
  });

  it('a glass tower stands when only its skin is shattered but falls when the core and columns go', () => {
    const s = new Structure(glassTower());
    for (const c of s.cells.filter((x) => x.iy === 3 && x.kind === 'facade')) s.damage(c.id, 1000);
    expect(s.evaluate()).toBeNull();
    expect(s.floorIntegrity(3)).toBeGreaterThan(s.threshold);
    const core = s.cells.find((x) => x.iy === 3 && x.kind === 'core')!;
    s.damage(core.id, 1000);
    const corners = s.cells.filter((x) => x.iy === 3 && x.kind === 'corner');
    s.damage(corners[0].id, 1000);
    s.damage(corners[1].id, 1000);
    const collapse = s.evaluate();
    expect(collapse).not.toBeNull();
    expect(collapse!.floor).toBe(3);
  });

  it('flags an unstable floor just above the threshold', () => {
    const s = new Structure(brickLowRise());
    expect(s.unstableFloor()).toBeNull();
    const bearing = s.cells.filter((c) => c.iy === 1 && c.kind === 'facade');
    let i = 0;
    while (s.floorIntegrity(1) >= s.threshold + UNSTABLE_MARGIN) s.damage(bearing[i++].id, 100);
    const f = s.floorIntegrity(1);
    expect(f).toBeGreaterThanOrEqual(s.threshold);
    expect(s.unstableFloor()).toBe(1);
    expect(s.evaluate()).toBeNull();
  });

  it('reset restores every cell and the full height', () => {
    const s = new Structure(brickLowRise());
    for (const c of s.cells) s.damage(c.id, 1000);
    s.evaluate();
    expect(s.collapsed).toBe(true);
    s.reset();
    expect(s.collapsed).toBe(false);
    expect(s.topFloor).toBe(3);
    expect(s.count('intact')).toBe(s.cells.length);
    expect(s.floorIntegrity(0)).toBe(1);
    expect(s.evaluate()).toBeNull();
  });

  it('turns a collapse into a bounded set of debris chunks that lean the right way', () => {
    const s = new Structure(glassTower());
    for (const c of s.cells.filter((x) => x.iy === 3 && x.kind !== 'slab' && (x.z > s.spec.z + 1 || x.kind === 'core'))) s.damage(c.id, 1000);
    const collapse = s.evaluate()!;
    expect(collapse).not.toBeNull();
    const chunks = chunksForCollapse(s, collapse, 36);
    expect(chunks.length).toBeGreaterThan(8);
    expect(chunks.length).toBeLessThanOrEqual(36);
    for (const ch of chunks) {
      expect(ch.y).toBeGreaterThanOrEqual(collapse.y);
      expect(ch.sx).toBeLessThanOrEqual(12);
      expect(ch.sy).toBeLessThanOrEqual(9);
    }
    const meanVz = chunks.reduce((a, c) => a + c.vz, 0) / chunks.length;
    expect(meanVz).toBeGreaterThan(2); // leans toward +z, the side that lost its support
  });
});

describe('blast interaction with the structure', () => {
  function blastAt(s: Structure, x: number, y: number, z: number, radius: number, power: number) {
    let broken = 0;
    for (const c of s.cellsNear(x, y, z, radius)) {
      const d = distanceToBox(x, y, z, c);
      const r = s.damage(c.id, blastDamage(d, radius, power));
      if (r?.broke) broken++;
    }
    return broken;
  }

  it('an exterior blast scars the facade; the same blast inside the footprint does far more and can collapse it', () => {
    const outside = new Structure(brickLowRise());
    const inside = new Structure(brickLowRise());
    const spec = outside.spec;
    const brokenOut = blastAt(outside, spec.x, 6, spec.z + spec.d / 2 + 6, 15, 42);
    const brokenIn = blastAt(inside, spec.x, 6, spec.z, 15, 42);
    expect(brokenOut).toBeGreaterThan(0);
    expect(brokenIn).toBeGreaterThan(brokenOut);
    expect(outside.evaluate()).toBeNull();
    expect(inside.evaluate()).not.toBeNull();
    expect(inside.collapsed).toBe(true);
  });

  it('damage from several simultaneous sources accumulates on the same cell exactly once per hit point', () => {
    const s = new Structure(concreteTower());
    const cell = s.cells.find((c) => c.kind === 'facade' && c.iy === 0)!;
    const a = s.damage(cell.id, 5)!;
    const b = s.damage(cell.id, 5)!;
    const c = s.damage(cell.id, 5)!;
    expect(a.absorbed + b.absorbed + c.absorbed).toBe(CELL_HP.concrete);
    expect(c.broke).toBe(true);
  });

  it('cellsNear ignores broken cells and far-away points', () => {
    const s = new Structure(brickLowRise());
    expect(s.cellsNear(500, 5, 500, 10).length).toBe(0);
    const before = s.cellsNear(s.spec.x, 5, s.spec.z + s.spec.d / 2, 4).length;
    expect(before).toBeGreaterThan(0);
    for (const c of s.cellsNear(s.spec.x, 5, s.spec.z + s.spec.d / 2, 4)) s.damage(c.id, 1000);
    expect(s.cellsNear(s.spec.x, 5, s.spec.z + s.spec.d / 2, 4).length).toBe(0);
  });
});

describe('demolition scoring', () => {
  it('scores a section once for cracking and once for breaking, extending the combo on breaks', () => {
    const sc = new ShotScorer();
    expect(sc.structureHit(0, 1, 'brick', 'cracked', true, 1)!.points).toBeGreaterThan(0);
    expect(sc.structureHit(0, 1, 'brick', 'cracked', true, 1.1)).toBeNull();
    const brk = sc.structureHit(0, 1, 'brick', 'broken', true, 1.2)!;
    expect(brk.points).toBeGreaterThan(50);
    expect(sc.structureHit(0, 1, 'brick', 'broken', true, 1.3)).toBeNull();
    sc.structureHit(0, 2, 'glass', 'broken', true, 1.4);
    expect(sc.combo).toBe(1.5);
    expect(sc.sectionsDestroyed).toBe(2);
    expect(sc.glassBroken).toBe(1);
    expect(sc.buildingsDamaged.size).toBe(1);
  });

  it('debris damage scores less than a direct hit', () => {
    const d = new ShotScorer().structureHit(0, 1, 'concrete', 'broken', true, 1)!;
    const i = new ShotScorer().structureHit(0, 1, 'concrete', 'broken', false, 1)!;
    expect(i.points).toBeLessThan(d.points);
  });

  it('a collapse is worth far more than sections, a total demolition more again, and a chain collapse doubles', () => {
    const sc = new ShotScorer();
    const partial = sc.collapse(0, 3, false, false, 2);
    const total = sc.collapse(1, 3, true, false, 2.5);
    const chain = sc.collapse(2, 3, true, true, 3);
    expect(partial.points).toBeGreaterThan(2500);
    expect(total.points).toBeGreaterThan(partial.points + 1500);
    expect(chain.points).toBe(total.points * 2);
    expect(sc.buildingsCollapsed.size).toBe(3);
    expect(sc.chainCollapses).toBe(1);
    const sum = sc.finish(100, 'SOLID');
    expect(sum.buildingsCollapsed).toBe(3);
    expect(sum.chainCollapses).toBe(1);
    expect(sum.lines.some((l) => l.label === 'CHAIN COLLAPSE')).toBe(true);
  });

  it('rewards interior and multi-building detonations once per shot', () => {
    const ext = new ShotScorer().detonation(6, 1, false, 1)!;
    const int = new ShotScorer().detonation(6, 1, true, 1)!;
    const multi = new ShotScorer().detonation(6, 3, false, 1)!;
    expect(int.points).toBeGreaterThan(ext.points + 400);
    expect(multi.points).toBeGreaterThan(ext.points);
    const sc = new ShotScorer();
    expect(sc.detonation(1, 1, false, 1)).not.toBeNull();
    expect(sc.detonation(1, 1, false, 2)).toBeNull();
    expect(sc.finish(10, 'SOLID').detonated).toBe(true);
  });

  it('spreading damage across buildings earns a bonus and demolition beats distance', () => {
    const spread = new ShotScorer();
    for (let b = 0; b < 4; b++) spread.structureHit(b, 1, 'brick', 'broken', true, 1 + b * 0.2);
    const sum = spread.finish(50, 'SOLID');
    expect(sum.buildingsDamaged).toBe(4);
    expect(sum.lines.some((l) => l.label === '4 buildings hit')).toBe(true);
    const long = new ShotScorer().finish(500, 'PERFECT');
    const demo = new ShotScorer();
    demo.collapse(0, 2, true, false, 1);
    expect(demo.finish(60, 'SOLID').score).toBeGreaterThan(long.score * 2);
  });
});
