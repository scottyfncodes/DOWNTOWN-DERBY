import type { ContactResult, Vec3 } from './types';
import type { BatSpec } from './equipment';
import type { Rng } from './rng';
import { contactFromError } from './batting';

export type PitchType = 'fastball' | 'sinker' | 'changeup' | 'slider' | 'curveball';

export interface PitchProfile {
  type: PitchType;
  label: string;
  /** flight time range (s) from release to the plate */
  time: [number, number];
  /** lateral break acceleration magnitude range (m/s^2); the sign is chosen per pitch */
  breakX: [number, number];
  /** vertical break acceleration range (m/s^2); negative = extra drop beyond gravity, positive = "rising" */
  breakY: [number, number];
  /** nominal spin (rad/s) for the visible ball rotation (x = back/top, y = side) */
  spin: Vec3;
  /** minimum pitcher level that throws this pitch */
  level: number;
  /** how "deceptive" the pitch is: late-break fraction, 0 = constant acceleration */
  lateBreak: number;
}

export const PITCH_PROFILES: Record<PitchType, PitchProfile> = {
  fastball: { type: 'fastball', label: 'Fastball', time: [0.62, 0.72], breakX: [0, 1.2], breakY: [1.5, 3.5], spin: { x: 42, y: 0, z: 0 }, level: 1, lateBreak: 0 },
  sinker: { type: 'sinker', label: 'Sinker', time: [0.68, 0.78], breakX: [0.5, 2.5], breakY: [-7, -4], spin: { x: -34, y: 6, z: 0 }, level: 1, lateBreak: 0.3 },
  changeup: { type: 'changeup', label: 'Changeup', time: [0.98, 1.12], breakX: [0, 1.5], breakY: [-4, -2], spin: { x: 16, y: 0, z: 0 }, level: 1, lateBreak: 0 },
  slider: { type: 'slider', label: 'Slider', time: [0.76, 0.86], breakX: [6, 9], breakY: [-3, -1], spin: { x: 6, y: 38, z: 0 }, level: 2, lateBreak: 0.45 },
  curveball: { type: 'curveball', label: 'Curveball', time: [0.9, 1.02], breakX: [2, 5], breakY: [-11, -8], spin: { x: -46, y: 10, z: 0 }, level: 3, lateBreak: 0.35 },
};

export const PITCH_TYPES: PitchType[] = ['fastball', 'sinker', 'changeup', 'slider', 'curveball'];

export interface Pitch {
  type: PitchType;
  label: string;
  release: Vec3;
  /** where the ball crosses the plate plane */
  target: Vec3;
  /** time from release to the plate (s) */
  duration: number;
  /** constant acceleration used for the first part of the flight (includes gravity) */
  accel: Vec3;
  /** initial velocity */
  v0: Vec3;
  /** visible spin (rad/s) */
  spin: Vec3;
  /** nominal speed (m/s) */
  speed: number;
  /** display speed (arcade mph) */
  mph: number;
  /** horizontal offset of the crossing point from the plate centre (m) */
  offsetX: number;
  /** vertical offset of the crossing point from the ideal contact height (m) */
  offsetY: number;
}

/** Seconds between the swing tap and the bat crossing the plate. */
export const SWING_DELAY = 0.08;
/** Half-width of the perfect timing window in seconds for the balanced bat. */
export const PERFECT_WINDOW = 0.055;
/** A swing this far before the ball arrives is a plain whiff. */
export const MAX_EARLY = 0.42;

/** Pitcher level 1..3 from rounds played: new players see fastballs and changeups first. */
export function pitcherLevel(roundsPlayed: number): number {
  if (roundsPlayed >= 5) return 3;
  if (roundsPlayed >= 2) return 2;
  return 1;
}

/** Weighted pitch selection. Fastballs stay common so the loop keeps its rhythm. */
export function choosePitchType(rng: Rng, level: number, previous: PitchType | null = null): PitchType {
  const pool: PitchType[] = [];
  for (const t of PITCH_TYPES) {
    const p = PITCH_PROFILES[t];
    if (p.level > level) continue;
    const weight = t === 'fastball' ? 4 : t === 'changeup' ? 2 : 3;
    for (let i = 0; i < weight; i++) pool.push(t);
  }
  let pick = rng.pick(pool);
  // Avoid three of the same in a row feeling by nudging away from the previous pitch once.
  if (previous && pick === previous && rng.chance(0.5)) pick = rng.pick(pool);
  return pick;
}

export interface PitchSetup {
  release: Vec3;
  /** plate centre at the ideal contact height */
  plate: Vec3;
  gravity: number;
  level: number;
}

/**
 * Builds a deterministic pitch: given the release point and the plate crossing point, solves the initial velocity so the
 * constant-acceleration flight (gravity + break) arrives exactly at `duration`. Location varies inside a strike zone that
 * tightens with pitcher level.
 */
export function createPitch(rng: Rng, setup: PitchSetup, type?: PitchType, previous: PitchType | null = null): Pitch {
  const t = type ?? choosePitchType(rng, setup.level, previous);
  const prof = PITCH_PROFILES[t];
  const duration = rng.range(prof.time[0], prof.time[1]) * (1 - 0.04 * (setup.level - 1));
  const side = rng.chance(0.5) ? -1 : 1;
  const bx = side * rng.range(prof.breakX[0], prof.breakX[1]);
  const by = rng.range(prof.breakY[0], prof.breakY[1]);
  const zone = 0.55 - 0.08 * (setup.level - 1);
  const offsetX = rng.range(-zone, zone);
  const offsetY = rng.range(-0.45, 0.4);
  const target: Vec3 = { x: setup.plate.x + offsetX, y: setup.plate.y + offsetY, z: setup.plate.z };
  const accel: Vec3 = { x: bx, y: -setup.gravity + by, z: 0 };
  const T = duration;
  const v0: Vec3 = {
    x: (target.x - setup.release.x - 0.5 * accel.x * T * T) / T,
    y: (target.y - setup.release.y - 0.5 * accel.y * T * T) / T,
    z: (target.z - setup.release.z - 0.5 * accel.z * T * T) / T,
  };
  const dist = Math.hypot(target.x - setup.release.x, target.y - setup.release.y, target.z - setup.release.z);
  const speed = dist / T;
  const spin: Vec3 = { x: prof.spin.x, y: prof.spin.y * side, z: prof.spin.z };
  return { type: t, label: prof.label, release: { ...setup.release }, target, duration, accel, v0, spin, speed, mph: Math.round(speed * 2.6), offsetX, offsetY };
}

/** Position along the pitch at time `t` (s since release). Continues past the plate for taken pitches. */
export function pitchPosition(p: Pitch, t: number, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
  out.x = p.release.x + p.v0.x * t + 0.5 * p.accel.x * t * t;
  out.y = p.release.y + p.v0.y * t + 0.5 * p.accel.y * t * t;
  out.z = p.release.z + p.v0.z * t + 0.5 * p.accel.z * t * t;
  return out;
}

export function pitchVelocity(p: Pitch, t: number, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
  out.x = p.v0.x + p.accel.x * t;
  out.y = p.v0.y + p.accel.y * t;
  out.z = p.v0.z + p.accel.z * t;
  return out;
}

/**
 * Judges a swing tapped `tapTime` seconds after release. The bat reaches the plate SWING_DELAY later; the signed error is
 * normalized so 1 = the edge of the perfect window (scaled by the bat's timing forgiveness).
 */
export function evaluateSwing(tapTime: number, pitch: Pitch, bat: BatSpec): ContactResult {
  const contactTime = tapTime + SWING_DELAY;
  const raw = contactTime - pitch.duration; // negative = early
  if (raw < -MAX_EARLY) return contactFromError(-99, bat);
  const err = raw / (PERFECT_WINDOW * bat.timingWindow);
  return contactFromError(err, bat);
}

/** Where along its flight the ball is at the moment of bat contact (clamped so whiffs still return a sensible point). */
export function contactPoint(pitch: Pitch, tapTime: number, out?: Vec3): Vec3 {
  const t = Math.max(0, Math.min(pitch.duration + 0.25, tapTime + SWING_DELAY));
  return pitchPosition(pitch, t, out);
}
