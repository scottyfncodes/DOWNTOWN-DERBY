import { describe, expect, it } from 'vitest';
import { ROCKETS, RocketState, armsOnQuality, getRocket } from '../src/logic/rocket';
import { CELL_HP, Structure, blastDamage, distanceToBox, impactDamage, penetrationRetention, type BuildingSpec } from '../src/logic/structure';

const spec = getRocket('sparkler');

function concreteBlock(id = 0): BuildingSpec {
  return { id, x: 0, z: -120, w: 30, d: 30, h: 46, style: 'concrete', floors: 10, nx: 3, nz: 3, core: true };
}

describe('rocket state machine', () => {
  it('only arms on clean contact', () => {
    expect(armsOnQuality('PERFECT')).toBe(true);
    expect(armsOnQuality('SOLID')).toBe(true);
    expect(armsOnQuality('POOR')).toBe(false);
    expect(armsOnQuality('MISS')).toBe(false);
    const r = new RocketState(spec);
    expect(r.arm('POOR')).toBe(false);
    expect(r.phase).toBe('idle');
    expect(r.canDetonate).toBe(false);
    expect(r.detonate()).toBe(false);
  });

  it('ignites after the delay, burns, coasts, then self-destructs if never detonated', () => {
    const r = new RocketState(spec);
    expect(r.arm('PERFECT')).toBe(true);
    const events: string[] = [];
    let t = 0;
    for (let i = 0; i < 600; i++) {
      const e = r.tick(1 / 60);
      t += 1 / 60;
      if (e) events.push(`${e}@${t.toFixed(2)}`);
      if (e === 'autodetonate') break;
    }
    const at = (e: string) => parseFloat(e.split('@')[1]);
    expect(events[0].startsWith('ignite@')).toBe(true);
    expect(at(events[0])).toBeCloseTo(spec.igniteDelay, 1);
    expect(events[1].startsWith('burnout@')).toBe(true);
    expect(at(events[1])).toBeCloseTo(spec.igniteDelay + spec.burn, 1);
    expect(events[2].startsWith('autodetonate@')).toBe(true);
    expect(at(events[2])).toBeCloseTo(spec.igniteDelay + spec.burn + spec.coast, 1);
    expect(r.phase).toBe('coasting');
    expect(r.detonate()).toBe(true);
    expect(r.phase).toBe('spent');
    expect(r.finished).toBe(true);
    expect(r.tick(1)).toBeNull();
  });

  it('thrust and lift apply only while burning; fuel reads down to zero', () => {
    const r = new RocketState(spec);
    r.arm('SOLID');
    expect(r.thrustNow()).toBe(0);
    for (let i = 0; i < 30; i++) r.tick(1 / 60);
    expect(r.phase).toBe('burning');
    expect(r.thrustNow()).toBe(spec.thrust);
    expect(r.liftNow()).toBe(spec.lift);
    expect(r.fuel).toBeGreaterThan(0.9);
    for (let i = 0; i < 200; i++) r.tick(1 / 60);
    expect(r.phase).toBe('coasting');
    expect(r.thrustNow()).toBe(0);
    expect(r.fuel).toBe(0);
  });

  it('the player can detonate at any moment after ignition', () => {
    const r = new RocketState(spec);
    r.arm('PERFECT');
    for (let i = 0; i < 20; i++) r.tick(1 / 60); // still armed
    expect(r.detonate()).toBe(false);
    r.tick(0.1); // ignite
    expect(r.lit).toBe(true);
    expect(r.detonate()).toBe(true);
    expect(r.phase).toBe('spent');
  });

  it('charge drains over time and with penetrations, weakening the blast', () => {
    const r = new RocketState(spec);
    r.arm('PERFECT');
    r.tick(0.4);
    const fresh = r.blastPower();
    expect(fresh).toBeCloseTo(spec.blastPower * (0.55 + 0.45 * r.charge), 5);
    r.penetrate(CELL_HP.concrete, 60, true);
    const afterOne = r.blastPower();
    expect(afterOne).toBeLessThan(fresh);
    expect(r.penetrations).toBe(1);
    r.penetrate(CELL_HP.column, 20, false); // bounced off
    expect(r.blastPower()).toBeLessThan(afterOne);
    expect(r.blastRadius()).toBeLessThan(spec.blastRadius);
    expect(r.blastRadius()).toBeGreaterThan(spec.blastRadius * 0.7);
    for (let i = 0; i < 5; i++) r.penetrate(CELL_HP.concrete, 14, true);
    expect(r.charge).toBeLessThan(0.3);
  });

  it('a drained rocket self-destructs early while coasting', () => {
    const r = new RocketState(spec);
    r.arm('PERFECT');
    r.tick(0.4);
    for (let i = 0; i < 20; i++) r.penetrate(10, 12, true);
    expect(r.charge).toBeLessThanOrEqual(0.08);
    let ev: string | null = null;
    for (let i = 0; i < 400 && ev !== 'autodetonate'; i++) ev = r.tick(1 / 60);
    expect(ev).toBe('autodetonate');
  });

  it('reset returns to idle and can be re-armed next swing', () => {
    const r = new RocketState(spec);
    r.arm('PERFECT');
    r.tick(0.5);
    r.detonate();
    r.reset();
    expect(r.phase).toBe('idle');
    expect(r.charge).toBe(1);
    expect(r.arm('SOLID')).toBe(true);
  });

  it('rocket catalog variants trade off meaningfully', () => {
    const ids = new Set(ROCKETS.map((r) => r.id));
    expect(ids.size).toBe(ROCKETS.length);
    const bunker = getRocket('bunker');
    const thumper = getRocket('thumper');
    expect(bunker.penetration).toBeGreaterThan(spec.penetration);
    expect(bunker.blastRadius).toBeLessThan(spec.blastRadius);
    expect(thumper.blastRadius).toBeGreaterThan(spec.blastRadius);
    expect(thumper.penetration).toBeLessThan(spec.penetration);
    expect(thumper.burn).toBeLessThan(spec.burn);
    expect(getRocket('nope').id).toBe('sparkler');
  });
});

describe('rocket penetration through structure (deterministic simulation)', () => {
  /** Marches a projectile along +z through a building, applying impact damage and retention per cell hit. */
  function punchThrough(s: Structure, speed: number, mass: number, penetrator: number, y: number) {
    let v = speed;
    let z = s.minZ - 1;
    const x = s.spec.x + 5; // off-centre so we miss the core
    const broken: number[] = [];
    let steps = 0;
    while (z < s.maxZ + 1 && v > 1 && steps++ < 500) {
      const hits = s.cellsNear(x, y, z, 0.35).filter((c) => c.kind !== 'slab');
      for (const c of hits) {
        const dmg = impactDamage(v, mass, penetrator);
        const hp = c.hp;
        const r = s.damage(c.id, dmg)!;
        if (r.broke) {
          broken.push(c.id);
          v *= penetrationRetention(dmg, hp);
        } else {
          v = 0;
        }
      }
      z += 0.3;
    }
    return { broken, exitSpeed: v };
  }

  it('a plain ball bounces off concrete, a rocket penetrates several walls and loses speed each time', () => {
    const plain = new Structure(concreteBlock());
    const a = punchThrough(plain, 63, 5, 1, 7);
    expect(a.broken.length).toBe(0);
    expect(a.exitSpeed).toBe(0);
    expect(plain.count('cracked')).toBeGreaterThan(0); // the hit still persists as damage

    const rocket = new Structure(concreteBlock());
    const b = punchThrough(rocket, 105, 5, spec.penetration, 7);
    expect(b.broken.length).toBeGreaterThanOrEqual(2); // front and back facade
    expect(b.exitSpeed).toBeGreaterThan(0);
    expect(b.exitSpeed).toBeLessThan(105);
    expect(rocket.count('broken')).toBe(b.broken.length);
  });

  it('a wrecking ball carries enough mass to break concrete where a league ball cannot', () => {
    const s = new Structure(concreteBlock());
    const r = punchThrough(s, 53, 16, 1, 7);
    expect(r.broken.length).toBeGreaterThanOrEqual(1);
  });

  it('where you detonate matters: short of the wall scars it, at the face breaches it, inside a tower drops floors', () => {
    const blast = (s: Structure, x: number, y: number, z: number) => {
      let n = 0;
      for (const c of s.cellsNear(x, y, z, spec.blastRadius)) {
        if (s.damage(c.id, blastDamage(distanceToBox(x, y, z, c), spec.blastRadius, spec.blastPower))?.broke) n++;
      }
      return n;
    };
    // Mid-rise concrete block: detonating 12 m short only scars it; at the face it comes down.
    const short = new Structure(concreteBlock());
    const face = new Structure(concreteBlock());
    expect(blast(short, 0, 7, short.minZ - 12)).toBeGreaterThan(0);
    expect(short.evaluate()).toBeNull();
    expect(blast(face, 0, 7, face.minZ - 0.5)).toBeGreaterThan(0);
    expect(face.evaluate()).not.toBeNull();
    // Glass skyscraper: an entry blast high up breaches the skin but the steel core holds; the same blast inside drops
    // everything above it, and lower down drops more.
    const towerSpec: BuildingSpec = { id: 2, x: -60, z: -100, w: 36, d: 36, h: 128, style: 'tower', floors: 20, nx: 4, nz: 4, core: true };
    const entry = new Structure(towerSpec);
    const high = new Structure(towerSpec);
    const low = new Structure(towerSpec);
    const brokeEntry = blast(entry, -60, 60, entry.maxZ + 0.5);
    const brokeHigh = blast(high, -60, 60, -100);
    blast(low, -60, 8, -100);
    expect(brokeEntry).toBeGreaterThan(10);
    expect(entry.evaluate()).toBeNull();
    expect(brokeHigh).toBeGreaterThan(brokeEntry);
    const highCollapse = high.evaluate()!;
    const lowCollapse = low.evaluate()!;
    expect(highCollapse).not.toBeNull();
    expect(lowCollapse).not.toBeNull();
    expect(lowCollapse.floorsDropped).toBeGreaterThan(highCollapse.floorsDropped);
  });
});
