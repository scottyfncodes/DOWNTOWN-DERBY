import type { ContactQuality } from './types';

export interface RocketSpec {
  id: string;
  name: string;
  desc: string;
  cost: number;
  /** forward acceleration while burning (m/s^2) */
  thrust: number;
  /** burn duration (s) */
  burn: number;
  /** seconds after contact before ignition */
  igniteDelay: number;
  /** fraction of gravity cancelled while burning (0 = ballistic, 1 = flies level) */
  lift: number;
  /** blast radius (m) at full charge */
  blastRadius: number;
  /** blast damage at the centre at full charge */
  blastPower: number;
  /** damage multiplier when punching through structure */
  penetration: number;
  /** seconds of coasting after burnout before self-destruct */
  coast: number;
  /** charge drained per second of flight */
  drain: number;
  tags: { label: string; dir: 'up' | 'down' | 'flat' }[];
}

export const ROCKETS: RocketSpec[] = [
  {
    id: 'sparkler',
    name: 'Sparkler Mk I',
    desc: 'Entry-level booster strapped to a baseball. Quick burn, honest blast. Tap DETONATE anytime after ignition.',
    cost: 0,
    thrust: 26,
    burn: 2.1,
    igniteDelay: 0.35,
    lift: 0.55,
    blastRadius: 21,
    blastPower: 62,
    penetration: 2.2,
    coast: 0.9,
    drain: 0.06,
    tags: [{ label: 'Balanced', dir: 'flat' }],
  },
  {
    id: 'bunker',
    name: 'Bunker Buster',
    desc: 'Hardened nose and a long, lean burn. Punches deep through concrete before you choose the moment. Tighter blast.',
    cost: 1500,
    thrust: 30,
    burn: 2.8,
    igniteDelay: 0.3,
    lift: 0.75,
    blastRadius: 16,
    blastPower: 76,
    penetration: 3.6,
    coast: 1.1,
    drain: 0.04,
    tags: [
      { label: 'Penetration +60%', dir: 'up' },
      { label: 'Burn +33%', dir: 'up' },
      { label: 'Blast radius -24%', dir: 'down' },
    ],
  },
  {
    id: 'thumper',
    name: 'Thumper',
    desc: 'A fat warhead on a short fuse. Enormous exterior blast, but it barely penetrates and burns out fast.',
    cost: 2200,
    thrust: 22,
    burn: 1.4,
    igniteDelay: 0.3,
    lift: 0.45,
    blastRadius: 31,
    blastPower: 82,
    penetration: 1.3,
    coast: 0.7,
    drain: 0.1,
    tags: [
      { label: 'Blast radius +48%', dir: 'up' },
      { label: 'Blast power +32%', dir: 'up' },
      { label: 'Burn -33%', dir: 'down' },
      { label: 'Penetration -40%', dir: 'down' },
    ],
  },
  {
    id: 'comet',
    name: 'Comet',
    desc: 'Lightweight, high-thrust, flies nearly level. Reaches the far towers; needs precise timing to count.',
    cost: 3400,
    thrust: 44,
    burn: 2.4,
    igniteDelay: 0.25,
    lift: 0.92,
    blastRadius: 20,
    blastPower: 66,
    penetration: 2.4,
    coast: 0.8,
    drain: 0.09,
    tags: [
      { label: 'Thrust +70%', dir: 'up' },
      { label: 'Level flight', dir: 'up' },
      { label: 'Charge drain +50%', dir: 'down' },
    ],
  },
];

export function getRocket(id: string): RocketSpec {
  return ROCKETS.find((r) => r.id === id) ?? ROCKETS[0];
}

/** Only clean contact lights the fuse. */
export function armsOnQuality(q: ContactQuality): boolean {
  return q === 'PERFECT' || q === 'SOLID';
}

export type RocketPhase = 'idle' | 'armed' | 'burning' | 'coasting' | 'spent';
export type RocketEvent = 'ignite' | 'burnout' | 'autodetonate' | null;

/**
 * Deterministic rocket state machine. Owns ignition timing, burn, charge (blast energy) and the self-destruct rule.
 * Physics forces are applied by the caller using `thrustNow()`.
 */
export class RocketState {
  phase: RocketPhase = 'idle';
  spec: RocketSpec;
  /** 0..1 warhead charge: drains over time and with every penetration */
  charge = 1;
  /** remaining burn seconds */
  burnLeft = 0;
  /** seconds spent coasting after burnout */
  coastTime = 0;
  /** structures penetrated so far */
  penetrations = 0;
  private armTimer = 0;
  flightTime = 0;

  constructor(spec: RocketSpec) {
    this.spec = spec;
  }

  /** Call at bat contact: arms the rocket when the contact was clean. */
  arm(quality: ContactQuality): boolean {
    if (!armsOnQuality(quality)) return false;
    this.phase = 'armed';
    this.armTimer = this.spec.igniteDelay;
    this.charge = 1;
    this.burnLeft = this.spec.burn;
    this.coastTime = 0;
    this.penetrations = 0;
    this.flightTime = 0;
    return true;
  }

  reset() {
    this.phase = 'idle';
    this.charge = 1;
    this.burnLeft = 0;
    this.coastTime = 0;
    this.penetrations = 0;
    this.armTimer = 0;
    this.flightTime = 0;
  }

  /** Advances the fuse/burn clock. Returns the discrete event that happened this tick, if any. */
  tick(dt: number): RocketEvent {
    if (this.phase === 'idle' || this.phase === 'spent') return null;
    this.flightTime += dt;
    if (this.phase === 'armed') {
      this.armTimer -= dt;
      if (this.armTimer <= 0) {
        this.phase = 'burning';
        return 'ignite';
      }
      return null;
    }
    this.charge = Math.max(0, this.charge - this.spec.drain * dt);
    if (this.phase === 'burning') {
      this.burnLeft -= dt;
      if (this.burnLeft <= 0) {
        this.burnLeft = 0;
        this.phase = 'coasting';
        return 'burnout';
      }
      return null;
    }
    // coasting
    this.coastTime += dt;
    if (this.coastTime >= this.spec.coast || this.charge <= 0.08) return 'autodetonate';
    return null;
  }

  get lit(): boolean {
    return this.phase === 'burning' || this.phase === 'coasting';
  }

  get canDetonate(): boolean {
    return this.lit;
  }

  /** Current forward acceleration (m/s^2). */
  thrustNow(): number {
    return this.phase === 'burning' ? this.spec.thrust : 0;
  }

  /** Fraction of gravity to cancel this tick. */
  liftNow(): number {
    return this.phase === 'burning' ? this.spec.lift : 0;
  }

  /** 0..1 remaining propulsion for HUD readouts. */
  get fuel(): number {
    return this.spec.burn > 0 ? this.burnLeft / this.spec.burn : 0;
  }

  /**
   * Records punching through (or bouncing off) a cell: `hpBefore` consumed against `damage` dealt. Breaking through costs a
   * slice of charge proportional to how hard it was; failing to break through costs more.
   */
  penetrate(hpBefore: number, damage: number, broke: boolean): void {
    if (!this.lit) return;
    const ratio = damage > 0 ? Math.min(1, hpBefore / damage) : 1;
    this.charge = Math.max(0, this.charge - (broke ? 0.05 + ratio * 0.12 : 0.22));
    if (broke) this.penetrations++;
  }

  /** Blast strength at the current charge: a fresh rocket hits hardest, a deep one trades power for position. */
  blastPower(): number {
    return this.spec.blastPower * (0.55 + 0.45 * this.charge);
  }

  blastRadius(): number {
    return this.spec.blastRadius * (0.75 + 0.25 * this.charge);
  }

  /** Player (or self-destruct) detonation. Returns false if there is nothing to detonate. */
  detonate(): boolean {
    if (!this.lit) return false;
    this.phase = 'spent';
    return true;
  }

  /** The rocket never lit (poor contact) or has already gone off. */
  get finished(): boolean {
    return this.phase === 'spent' || this.phase === 'idle';
  }
}

export interface BlastCellResult {
  cellId: number;
  building: number;
  damage: number;
}

/** Pure helper: blast damage for a list of candidate boxes around a point. */
export function blastDamageList(
  px: number,
  py: number,
  pz: number,
  radius: number,
  power: number,
  cells: { id: number; building: number; x: number; y: number; z: number; sx: number; sy: number; sz: number }[],
  distanceFn: (px: number, py: number, pz: number, c: { x: number; y: number; z: number; sx: number; sy: number; sz: number }) => number,
  falloff: (dist: number, radius: number, power: number) => number,
): BlastCellResult[] {
  const out: BlastCellResult[] = [];
  for (const c of cells) {
    const d = distanceFn(px, py, pz, c);
    const dmg = falloff(d, radius, power);
    if (dmg > 0.05) out.push({ cellId: c.id, building: c.building, damage: dmg });
  }
  return out;
}
