import type { AimSettings, ContactQuality, ContactResult, LaunchParams, SwingTiming, Vec3 } from './types';
import type { BatSpec, BallSpec } from './equipment';

export const BASE_LAUNCH_SPEED = 63; // m/s, arcade scale (keeps shots inside the dense blocks)
export const MIN_LOFT = 6;
export const MAX_LOFT = 48;
export const MAX_YAW = (38 * Math.PI) / 180;

/** Timing meter: sweeps 0→1→0 as a ping-pong; the sweet zone is a window around `sweet`. */
export function meterPosition(elapsed: number, period: number): number {
  const t = (elapsed % period) / period; // 0..1
  return t < 0.5 ? t * 2 : 2 - t * 2;
}

/** Sweet zone width scaled by the bat's timing forgiveness. */
export function sweetWidthFor(bat: BatSpec, base = 0.16): number {
  return Math.min(0.5, base * bat.timingWindow);
}

/** Returns contact quality bucket from the absolute normalized timing error. */
export function qualityFromError(absErr: number): ContactQuality {
  if (absErr <= 1) return 'PERFECT';
  if (absErr <= 2.2) return 'SOLID';
  if (absErr <= 4.2) return 'POOR';
  if (absErr <= 6.5) return 'WEAK';
  return 'MISS';
}

export const QUALITY_POWER: Record<ContactQuality, number> = {
  PERFECT: 1,
  SOLID: 0.86,
  POOR: 0.64,
  WEAK: 0.36,
  MISS: 0.06,
};

export function evaluateContact(timing: SwingTiming, bat: BatSpec): ContactResult {
  const half = timing.sweetWidth / 2;
  const err = (timing.value - timing.sweet) / half; // normalized, 1 = edge of perfect zone
  const abs = Math.abs(err);
  const quality = qualityFromError(abs);
  const power = QUALITY_POWER[quality];
  // Early swings pull the ball (negative yaw, to the left), late swings push it right.
  const dir = Math.sign(err) || 0;
  const yawError = dir * Math.min(1, abs / 6.5) * (22 * Math.PI) / 180 * bat.spread;
  // Late contact pops the ball up a touch, early contact tops it.
  const loftDelta = -dir * Math.min(1, abs / 6.5) * 9 * bat.spread;
  return { quality, error: err, power, yawError, loftDelta };
}

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

export interface LaunchInput {
  aim: AimSettings;
  contact: ContactResult;
  bat: BatSpec;
  ball: BallSpec;
  /** optional deterministic jitter in [0,1) for tiny natural variance */
  jitter?: number;
}

/**
 * Converts aim + contact into a launch velocity. The ball travels toward -Z.
 * Spin is expressed as angular velocity: side spin around Y bends the flight,
 * back/top spin around X lifts or dives.
 */
export function computeLaunch(input: LaunchInput): LaunchParams {
  const { aim, contact, bat, ball } = input;
  const jitter = input.jitter ?? 0.5;
  const quality = contact.quality;
  const speed = BASE_LAUNCH_SPEED * contact.power * bat.power * ball.speed * (0.985 + jitter * 0.03);
  const yaw = clamp(aim.yaw + contact.yawError, -MAX_YAW * 1.4, MAX_YAW * 1.4);
  let loft = clamp(aim.loft + contact.loftDelta, -5, 70);
  if (quality === 'MISS') loft = -10; // dribbles off the tee
  const lr = (loft * Math.PI) / 180;
  const vx = Math.sin(yaw) * Math.cos(lr) * speed;
  const vy = Math.sin(lr) * speed;
  const vz = -Math.cos(yaw) * Math.cos(lr) * speed;
  const spinScale = 55 * ball.curve;
  // Mistimed contact imparts natural side spin as well.
  const naturalSide = -Math.sign(contact.error) * Math.min(1, Math.abs(contact.error) / 6.5) * 0.35;
  const side = clamp(aim.spin.side + naturalSide, -1.4, 1.4);
  const spin: Vec3 = {
    x: aim.spin.lift * spinScale * 0.6,
    y: side * spinScale,
    z: 0,
  };
  return { velocity: { x: vx, y: vy, z: vz }, spin, speed, quality };
}

/** Analytic preview of the opening arc (no drag, no collisions). */
export function previewTrajectory(
  origin: Vec3,
  velocity: Vec3,
  gravity: number,
  steps = 24,
  dt = 0.08,
): Vec3[] {
  const pts: Vec3[] = [];
  for (let i = 0; i < steps; i++) {
    const t = i * dt;
    pts.push({
      x: origin.x + velocity.x * t,
      y: origin.y + velocity.y * t - 0.5 * gravity * t * t,
      z: origin.z + velocity.z * t,
    });
  }
  return pts;
}
