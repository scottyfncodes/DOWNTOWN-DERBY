import type { ContactQuality, ImpactEvent, MaterialKind, ScoreLine, ShotSummary } from './types';

export const MATERIAL_VALUE: Record<MaterialKind, number> = {
  glass: 150,
  sign: 320,
  billboard: 650,
  hvac: 260,
  crate: 70,
  barrel: 110,
  car: 380,
  streetlight: 220,
  watertower: 900,
  awning: 130,
  plank: 60,
  scaffold: 90,
  antenna: 240,
  concrete: 12,
  ground: 8,
  roof: 10,
  cage: 0,
};

export const MATERIAL_LABEL: Record<MaterialKind, string> = {
  glass: 'Glass',
  sign: 'Sign',
  billboard: 'Billboard',
  hvac: 'HVAC Unit',
  crate: 'Crate',
  barrel: 'Barrel',
  car: 'Car',
  streetlight: 'Streetlight',
  watertower: 'Water Tower',
  awning: 'Awning',
  plank: 'Plank',
  scaffold: 'Scaffold',
  antenna: 'Antenna',
  concrete: 'Wall',
  ground: 'Street',
  roof: 'Rooftop',
  cage: 'Cage',
};

/** Materials that count as "damage" (not just a bounce). */
export const DAMAGE_MATERIALS = new Set<MaterialKind>([
  'glass', 'sign', 'billboard', 'hvac', 'crate', 'barrel', 'car', 'streetlight', 'watertower', 'awning', 'plank', 'scaffold', 'antenna',
]);

export const COMBO_GRACE = 1.7; // seconds between scoring impacts before the chain ends
export const COMBO_STEPS = [1, 1.5, 2, 2.5, 3, 3.5, 4]; // multiplier by chain index
export const MAX_COMBO = COMBO_STEPS[COMBO_STEPS.length - 1];
export const MAX_EVENTS_PER_OBJECT = 3;
export const MAX_OBJECT_POINTS_FACTOR = 2.4; // per object per shot, as multiple of its base value
export const SECONDARY_FACTOR = 0.55;
export const SECONDARY_MIN_SPEED = 3.5;
export const DIRECT_MIN_SPEED = 2.0;
export const DISTANCE_POINTS_PER_METER = 1.5;
export const DESTROY_BONUS_FACTOR = 0.6;
export const BONUS_TARGET_MULT = 2;

export interface ScoringOptions {
  impactMultiplier?: number; // from bat/ball
}

export function speedFactor(speed: number): number {
  return Math.max(0.5, Math.min(2, 0.5 + speed / 45));
}

export function comboMultiplier(chainIndex: number): number {
  return COMBO_STEPS[Math.min(COMBO_STEPS.length - 1, Math.max(0, chainIndex))];
}

/**
 * Tracks one shot's chain of impacts. Deterministic given the same events.
 * Guards: duplicate pair keys per short window, per-object caps, static bounce dedupe.
 */
export class ShotScorer {
  readonly lines: ScoreLine[] = [];
  score = 0;
  chainIndex = -1;
  bestCombo = 1;
  chainCount = 0;
  lastScoreTime = -Infinity;
  private objectEvents = new Map<string, number>();
  private objectPoints = new Map<string, number>();
  private recentPairs = new Map<string, number>();
  private staticBounces = 0;
  readonly materialsHit = new Set<MaterialKind>();
  readonly objectsDamaged = new Set<string>();
  glassBroken = 0;
  private impactMultiplier: number;
  ended = false;

  constructor(opts: ScoringOptions = {}) {
    this.impactMultiplier = opts.impactMultiplier ?? 1;
  }

  /** Current live combo multiplier (1 when no chain is active). */
  get combo(): number {
    return this.chainIndex < 0 ? 1 : comboMultiplier(this.chainIndex);
  }

  isChainAlive(now: number): boolean {
    return this.chainIndex >= 0 && now - this.lastScoreTime <= COMBO_GRACE;
  }

  /** Call every frame; ends the chain after the grace period. Returns true when the chain just ended. */
  tick(now: number): boolean {
    if (this.chainIndex >= 0 && now - this.lastScoreTime > COMBO_GRACE) {
      this.chainIndex = -1;
      return true;
    }
    return false;
  }

  /** Processes an impact. Returns the score line awarded (or null when ignored). */
  impact(ev: ImpactEvent, pairKey?: string): ScoreLine | null {
    if (this.ended) return null;
    const base = MATERIAL_VALUE[ev.material] ?? 0;
    if (base <= 0) return null;
    const isDamage = DAMAGE_MATERIALS.has(ev.material);

    if (!isDamage) {
      // Static surfaces: only the ball's first couple of bounces matter, and never chain.
      if (!ev.direct) return null;
      if (ev.speed < 6) return null;
      this.staticBounces++;
      if (this.staticBounces > 2) return null;
      const pts = Math.round(base * speedFactor(ev.speed));
      this.score += pts;
      const line: ScoreLine = { label: MATERIAL_LABEL[ev.material], points: pts, kind: 'impact', material: ev.material, position: ev.position };
      this.lines.push(line);
      return line;
    }

    const minSpeed = ev.direct ? DIRECT_MIN_SPEED : SECONDARY_MIN_SPEED;
    if (ev.speed < minSpeed) return null;

    // Duplicate-pair guard: the same two bodies grinding together only score once per window.
    if (pairKey) {
      const last = this.recentPairs.get(pairKey);
      if (last !== undefined && ev.time - last < 0.6) return null;
      this.recentPairs.set(pairKey, ev.time);
    }
    const count = this.objectEvents.get(ev.objectId) ?? 0;
    if (count >= MAX_EVENTS_PER_OBJECT) return null;
    const cap = base * MAX_OBJECT_POINTS_FACTOR;
    const already = this.objectPoints.get(ev.objectId) ?? 0;
    if (already >= cap) return null;

    // Build the chain.
    if (this.isChainAlive(ev.time)) this.chainIndex++;
    else this.chainIndex = 0;
    this.lastScoreTime = ev.time;
    this.chainCount++;
    const mult = comboMultiplier(this.chainIndex);
    this.bestCombo = Math.max(this.bestCombo, mult);

    let raw = base * speedFactor(ev.speed);
    if (!ev.direct) raw *= SECONDARY_FACTOR;
    else raw *= this.impactMultiplier;
    if (ev.destroyed) raw += base * DESTROY_BONUS_FACTOR;
    if (ev.bonusTarget) raw *= BONUS_TARGET_MULT;
    raw = Math.min(raw, cap - already);
    const pts = Math.round(raw * mult);

    this.objectEvents.set(ev.objectId, count + 1);
    this.objectPoints.set(ev.objectId, already + raw);
    this.objectsDamaged.add(ev.objectId);
    this.materialsHit.add(ev.material);
    if (ev.material === 'glass' && ev.destroyed) this.glassBroken++;
    this.score += pts;

    const labelBase = ev.destroyed ? destroyedLabel(ev.material) : MATERIAL_LABEL[ev.material];
    const label = ev.direct ? labelBase : `${labelBase} (chain)`;
    const line: ScoreLine = {
      label: ev.bonusTarget ? `★ ${label}` : label,
      points: pts,
      kind: 'impact',
      material: ev.material,
      position: ev.position,
      combo: mult,
    };
    this.lines.push(line);
    return line;
  }

  /** Finalizes the shot: distance, contact and chain bonuses. */
  finish(distance: number, quality: ContactQuality): ShotSummary {
    this.ended = true;
    const bonus: ScoreLine[] = [];
    const dist = Math.max(0, Math.round(distance));
    if (dist > 0 && quality !== 'MISS') {
      const pts = Math.round(dist * DISTANCE_POINTS_PER_METER);
      bonus.push({ label: `${dist}m carry`, points: pts, kind: 'distance' });
    }
    if (quality === 'PERFECT') bonus.push({ label: 'Perfect contact', points: 250, kind: 'contact' });
    const unique = this.materialsHit.size;
    if (unique >= 2) bonus.push({ label: `${unique} target types`, points: (unique - 1) * 120, kind: 'bonus' });
    if (this.chainCount >= 10) bonus.push({ label: 'CATASTROPHE', points: 2500, kind: 'chain' });
    else if (this.chainCount >= 6) bonus.push({ label: 'Chain reaction', points: 900, kind: 'chain' });
    else if (this.chainCount >= 3) bonus.push({ label: 'Rally', points: 250, kind: 'chain' });
    if (this.bestCombo >= MAX_COMBO) bonus.push({ label: 'Max combo', points: 600, kind: 'combo' });
    for (const b of bonus) {
      this.score += b.points;
      this.lines.push(b);
    }
    return {
      score: this.score,
      distance: dist,
      quality,
      objectsDamaged: this.objectsDamaged.size,
      chainCount: this.chainCount,
      bestCombo: this.bestCombo,
      glassBroken: this.glassBroken,
      lines: this.lines.slice(),
      uniqueMaterials: unique,
    };
  }
}

function destroyedLabel(m: MaterialKind): string {
  switch (m) {
    case 'glass':
      return 'Glass shattered';
    case 'sign':
      return 'Sign torn down';
    case 'billboard':
      return 'Billboard toppled';
    case 'hvac':
      return 'HVAC wrecked';
    case 'crate':
      return 'Crate smashed';
    case 'barrel':
      return 'Barrel launched';
    case 'car':
      return 'Car totaled';
    case 'streetlight':
      return 'Streetlight felled';
    case 'watertower':
      return 'Water tower down';
    case 'awning':
      return 'Awning ripped';
    case 'antenna':
      return 'Antenna snapped';
    default:
      return `${MATERIAL_LABEL[m]} destroyed`;
  }
}

export function creditsForRound(total: number, bestCombo: number, perfectContacts: number): number {
  return Math.round(total / 40) + Math.round(bestCombo * 25) + perfectContacts * 15;
}
