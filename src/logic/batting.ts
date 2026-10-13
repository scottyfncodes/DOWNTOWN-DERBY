import type { AimSettings, ContactQuality, ContactResult, LaunchParams, SwingTiming, Vec3 } from './types';
import type { BatSpec, BallSpec } from './equipment';

export const BASE_LAUNCH_SPEED = 63; // m/s, arcade scale (keeps shots inside the dense blocks)
export const MIN_LOFT = -14;
export const MAX_LOFT = 48;
export const MAX_YAW = (38 * Math.PI) / 180;
/** How much of the incoming pitch speed a square hit turns back into exit velocity. */
export const PITCH_SPEED_BONUS = 0.22;

/** Timing meter: sweeps 0→1→0 as a ping-pong; the sweet zone is a window around `sweet`. (Legacy meter, kept for the tutorial ring.) */
export function meterPosition(elapsed: number, period: number): number {
  const t = (elapsed % period) / period; // 0..1
  return t < 0.5 ? t * 2 : 2 - t * 2;
}

/** Sweet zone width scaled by the bat's timing forgiveness. */
export function sweetWidthFor(bat: BatSpec, base = 0.16): number {
  return Math.min(0.5, base * bat.timingWindow);
}

/** Returns contact quality bucket from the absolute normalized timing error (1 = edge of the perfect window). */
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

/**
 * Shared contact model. `err` is the signed normalized timing error: negative = early (out in front of the ball),
 * positive = late. Early contact pulls the ball toward the batter's pull side (left) and tops it (drives it down
 * with topspin); late contact pushes it right and gets under it (pops it up with backspin). Weak contact sprays.
 */
export function contactFromError(err: number, bat: BatSpec): ContactResult {
  const abs = Math.abs(err);
  const quality = qualityFromError(abs);
  const power = QUALITY_POWER[quality];
  const dir = Math.sign(err) || 0;
  const k = Math.min(1, abs / 6.5);
  // Aim error grows steeply once outside the solid window so fouls read as fouls.
  const spray = k * k * 0.6 + k * 0.4;
  const yawError = dir * spray * ((34 * Math.PI) / 180) * bat.spread;
  const loftDelta = dir * k * 11 * bat.spread;
  return { quality, error: err, power, yawError, loftDelta };
}

export function evaluateContact(timing: SwingTiming, bat: BatSpec): ContactResult {
  const half = timing.sweetWidth / 2;
  const err = (timing.value - timing.sweet) / half; // normalized, 1 = edge of perfect zone
  return contactFromError(err, bat);
}

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

export interface PitchContact {
  /** incoming pitch speed in m/s */
  speed: number;
  /** horizontal offset of the ball from the plate centre at contact (m, +x = right) */
  offsetX: number;
  /** vertical offset of the ball from the ideal contact height at contact (m, + = high) */
  offsetY: number;
}

export interface LaunchInput {
  aim: AimSettings;
  contact: ContactResult;
  bat: BatSpec;
  ball: BallSpec;
  /** optional deterministic jitter in [0,1) for tiny natural variance */
  jitter?: number;
  /** the pitch that was hit (adds exit velocity and location-based deflection) */
  pitch?: PitchContact;
}

/**
 * Converts aim + contact (+ pitch) into a launch velocity and spin. The ball travels toward -Z.
 * Spin is expressed as angular velocity: +x = backspin (lift), -x = topspin (dive),
 * +y bends the flight left, -y bends it right.
 */
export function computeLaunch(input: LaunchInput): LaunchParams {
  const { aim, contact, bat, ball } = input;
  const jitter = input.jitter ?? 0.5;
  const quality = contact.quality;
  const pitchBonus = input.pitch ? input.pitch.speed * PITCH_SPEED_BONUS * contact.power : 0;
  const speed = (BASE_LAUNCH_SPEED * contact.power + pitchBonus) * bat.power * ball.speed * (0.985 + jitter * 0.03);
  // Pitch location: an inside/outside pitch deflects the shot, a low pitch gets lifted, a high pitch is driven flatter.
  const locYaw = input.pitch ? clamp(input.pitch.offsetX, -0.6, 0.6) * 0.12 : 0;
  const locLoft = input.pitch ? clamp(-input.pitch.offsetY, -0.6, 0.6) * 6 : 0;
  const yaw = clamp(aim.yaw + contact.yawError + locYaw, -MAX_YAW * 1.6, MAX_YAW * 1.6);
  let loft = clamp(aim.loft + contact.loftDelta + locLoft, -6, 70);
  if (quality === 'MISS') loft = -10; // dribbles off the plate
  const lr = (loft * Math.PI) / 180;
  const vx = Math.sin(yaw) * Math.cos(lr) * speed;
  const vy = Math.sin(lr) * speed;
  const vz = -Math.cos(yaw) * Math.cos(lr) * speed;
  const spinScale = 55 * ball.curve;
  // Mistimed contact imparts natural spin: topped balls carry topspin, late pop-ups backspin, and both add side spin.
  const k = Math.min(1, Math.abs(contact.error) / 6.5);
  const naturalSide = -Math.sign(contact.error) * k * 0.35;
  const naturalLift = Math.sign(contact.error) * k * 1.2;
  const side = clamp(aim.spin.side + naturalSide, -1.4, 1.4);
  const lift = clamp(aim.spin.lift + naturalLift + (quality === 'PERFECT' ? 0.35 : 0), -1.6, 1.6);
  const spin: Vec3 = {
    x: lift * spinScale * 0.7,
    y: -side * spinScale,
    z: 0,
  };
  return { velocity: { x: vx, y: vy, z: vz }, spin, speed, quality };
}

/** Classifies the dominant spin for readouts and visuals. */
export type SpinKind = 'backspin' | 'topspin' | 'sidespin' | 'knuckle';
export function classifySpin(spin: Vec3): SpinKind {
  const ax = Math.abs(spin.x);
  const ay = Math.abs(spin.y);
  if (ax < 4 && ay < 4) return 'knuckle';
  if (ay > ax * 1.2) return 'sidespin';
  return spin.x >= 0 ? 'backspin' : 'topspin';
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
