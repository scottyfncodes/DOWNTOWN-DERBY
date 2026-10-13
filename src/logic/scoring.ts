import type { ContactQuality, ImpactEvent, MaterialKind, ScoreLine, ShotSummary, Vec3 } from './types';
import type { CellMaterial } from './structure';

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
  brick: 12,
  steel: 12,
  slab: 10,
  column: 12,
  rubble: 0,
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
  brick: 'Brick wall',
  steel: 'Steel panel',
  slab: 'Floor',
  column: 'Column',
  rubble: 'Rubble',
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
export const MAX_SECONDARY_PER_OBJECT = 1; // an object only "chains" once per shot
export const MAX_OBJECT_POINTS_FACTOR = 2.4; // per object per shot, as multiple of its base value
export const SECONDARY_FACTOR = 0.55;
export const SECONDARY_MIN_SPEED = 6;
/** Materials that only score when the ball itself hits them (never via chain reactions). */
export const DIRECT_ONLY_MATERIALS = new Set<MaterialKind>(['scaffold', 'plank']);
export const DIRECT_MIN_SPEED = 2.0;
export const DISTANCE_POINTS_PER_METER = 0.5;
export const DESTROY_BONUS_FACTOR = 0.6;
export const BONUS_TARGET_MULT = 2;

// ---- Demolition scoring ----
/** Points for destroying one building section, by material. */
export const SECTION_VALUE: Record<CellMaterial, number> = {
  glass: 40,
  brick: 80,
  concrete: 120,
  steel: 100,
  slab: 90,
  column: 180,
};
/** Section hits ride the combo, but only this far: collapses, not skins, should dominate a shot. */
export const SECTION_COMBO_CAP = 2.5;
export const SECTION_LABEL: Record<CellMaterial, string> = {
  glass: 'Glass panel',
  brick: 'Brick wall',
  concrete: 'Concrete wall',
  steel: 'Steel panel',
  slab: 'Floor slab',
  column: 'Support column',
};
/** Fraction of the section value awarded for cracking (not breaking) a section. */
export const CRACK_FACTOR = 0.15;
/** Debris (secondary) damage to structure scores at this fraction. */
export const SECONDARY_SECTION_FACTOR = 0.6;
export const COLLAPSE_BASE = 4000;
export const COLLAPSE_PER_FLOOR = 400;
export const TOTAL_DEMOLITION_BONUS = 3000;
export const CHAIN_COLLAPSE_MULT = 2;
export const DETONATION_BASE = 150;
export const DETONATION_PER_SECTION = 25;
export const DETONATION_SECTION_CAP = 24;
export const INTERIOR_BLAST_BONUS = 500;
export const MULTI_BUILDING_BLAST_BONUS = 350;
export const SPREAD_BONUS_PER_BUILDING = 250;

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
  private secondaryEvents = new Map<string, number>();
  private objectPoints = new Map<string, number>();
  private recentPairs = new Map<string, number>();
  private staticBounces = 0;
  readonly materialsHit = new Set<MaterialKind>();
  readonly objectsDamaged = new Set<string>();
  glassBroken = 0;
  private impactMultiplier: number;
  ended = false;
  // Demolition tracking
  readonly buildingsDamaged = new Set<number>();
  readonly buildingsCollapsed = new Set<number>();
  sectionsDestroyed = 0;
  chainCollapses = 0;
  collapseEvents = 0;
  detonated = false;
  private crackedCells = new Set<string>();
  private brokenCells = new Set<string>();

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
    if (!ev.direct && DIRECT_ONLY_MATERIALS.has(ev.material)) return null;
    if (!ev.direct && (this.secondaryEvents.get(ev.objectId) ?? 0) >= MAX_SECONDARY_PER_OBJECT) return null;

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
    if (!ev.direct) this.secondaryEvents.set(ev.objectId, (this.secondaryEvents.get(ev.objectId) ?? 0) + 1);
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

  private chain(time: number): number {
    if (this.isChainAlive(time)) this.chainIndex++;
    else this.chainIndex = 0;
    this.lastScoreTime = time;
    this.chainCount++;
    const mult = comboMultiplier(this.chainIndex);
    this.bestCombo = Math.max(this.bestCombo, mult);
    return mult;
  }

  /**
   * A building section took damage. Cracking scores once per cell, breaking once per cell. Breaking a section extends the
   * combo chain; debris (indirect) damage scores less. Returns the awarded line or null.
   */
  structureHit(building: number, cellId: number, material: CellMaterial, outcome: 'cracked' | 'broken', direct: boolean, time: number, position?: Vec3): ScoreLine | null {
    if (this.ended) return null;
    const key = `${building}:${cellId}`;
    const base = SECTION_VALUE[material];
    this.buildingsDamaged.add(building);
    if (outcome === 'cracked') {
      if (this.crackedCells.has(key) || this.brokenCells.has(key)) return null;
      this.crackedCells.add(key);
      const pts = Math.round(base * CRACK_FACTOR * (direct ? 1 : SECONDARY_SECTION_FACTOR));
      this.score += pts;
      const line: ScoreLine = { label: `${SECTION_LABEL[material]} cracked`, points: pts, kind: 'structure', position };
      this.lines.push(line);
      return line;
    }
    if (this.brokenCells.has(key)) return null;
    this.brokenCells.add(key);
    this.sectionsDestroyed++;
    if (material === 'glass') this.glassBroken++;
    const mult = Math.min(SECTION_COMBO_CAP, this.chain(time));
    const raw = base * (direct ? this.impactMultiplier : SECONDARY_SECTION_FACTOR);
    const pts = Math.round(raw * mult);
    this.score += pts;
    const line: ScoreLine = { label: direct ? SECTION_LABEL[material] : `${SECTION_LABEL[material]} (debris)`, points: pts, kind: 'structure', position, combo: mult };
    this.lines.push(line);
    return line;
  }

  /** A floor failed. `chain` = the collapse was caused by debris from another collapse. */
  collapse(building: number, floorsDropped: number, total: boolean, chain: boolean, time: number, position?: Vec3): ScoreLine {
    this.collapseEvents++;
    this.buildingsCollapsed.add(building);
    this.buildingsDamaged.add(building);
    if (chain) this.chainCollapses++;
    this.lastScoreTime = time;
    let pts = COLLAPSE_BASE + COLLAPSE_PER_FLOOR * Math.max(1, floorsDropped);
    if (total) pts += TOTAL_DEMOLITION_BONUS;
    if (chain) pts *= CHAIN_COLLAPSE_MULT;
    pts = Math.round(pts);
    this.score += pts;
    const label = chain ? 'CHAIN COLLAPSE' : total ? 'BUILDING DEMOLISHED' : `${floorsDropped} floor${floorsDropped === 1 ? '' : 's'} collapsed`;
    const line: ScoreLine = { label, points: pts, kind: 'collapse', position };
    this.lines.push(line);
    return line;
  }

  /**
   * The rocket went off. `sections` = cells damaged by the blast, `buildings` = distinct buildings touched,
   * `interior` = the blast point was inside a building footprint.
   */
  detonation(sections: number, buildings: number, interior: boolean, time: number, position?: Vec3): ScoreLine | null {
    if (this.ended || this.detonated) return null;
    this.detonated = true;
    this.lastScoreTime = time;
    let pts = DETONATION_BASE + DETONATION_PER_SECTION * Math.min(DETONATION_SECTION_CAP, sections);
    let label = 'Detonation';
    if (interior) {
      pts += INTERIOR_BLAST_BONUS;
      label = 'INTERIOR BLAST';
    }
    if (buildings >= 2) {
      pts += MULTI_BUILDING_BLAST_BONUS;
      if (!interior) label = 'Multi-strike blast';
    }
    this.score += pts;
    const line: ScoreLine = { label, points: pts, kind: 'detonation', position };
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
    if (this.chainCount >= 14) bonus.push({ label: 'CATASTROPHE', points: 1500, kind: 'chain' });
    else if (this.chainCount >= 6) bonus.push({ label: 'Chain reaction', points: 600, kind: 'chain' });
    else if (this.chainCount >= 3) bonus.push({ label: 'Rally', points: 250, kind: 'chain' });
    if (this.bestCombo >= MAX_COMBO) bonus.push({ label: 'Max combo', points: 600, kind: 'combo' });
    if (this.buildingsDamaged.size >= 2) bonus.push({ label: `${this.buildingsDamaged.size} buildings hit`, points: (this.buildingsDamaged.size - 1) * SPREAD_BONUS_PER_BUILDING, kind: 'bonus' });
    if (this.sectionsDestroyed >= 40) bonus.push({ label: 'WRECKING CREW', points: 1500, kind: 'bonus' });
    else if (this.sectionsDestroyed >= 15) bonus.push({ label: 'Demolition derby', points: 600, kind: 'bonus' });
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
      sectionsDestroyed: this.sectionsDestroyed,
      buildingsDamaged: this.buildingsDamaged.size,
      buildingsCollapsed: this.buildingsCollapsed.size,
      chainCollapses: this.chainCollapses,
      detonated: this.detonated,
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

export function creditsForRound(total: number, bestCombo: number, perfectContacts: number, buildingsCollapsed = 0): number {
  return Math.round(total / 90) + Math.round(bestCombo * 25) + perfectContacts * 15 + buildingsCollapsed * 60;
}
