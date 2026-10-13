import { describe, expect, it } from 'vitest';
import { PITCH_PROFILES, PITCH_TYPES, SWING_DELAY, PERFECT_WINDOW, choosePitchType, contactPoint, createPitch, evaluateSwing, pitchPosition, pitchVelocity, pitcherLevel, type PitchType } from '../src/logic/pitching';
import { computeLaunch, classifySpin } from '../src/logic/batting';
import { createRng } from '../src/logic/rng';
import { getBat, getBall } from '../src/logic/equipment';

const setup = { release: { x: 0.6, y: 66, z: -31.5 }, plate: { x: 0, y: 65.1, z: -13.5 }, gravity: 11.5, level: 3 };
const bat = getBat('balanced');

describe('pitch generation', () => {
  it('arrives exactly at the plate crossing point at its duration', () => {
    const rng = createRng(1);
    for (let i = 0; i < 50; i++) {
      const p = createPitch(rng, setup);
      const at = pitchPosition(p, p.duration);
      expect(at.x).toBeCloseTo(p.target.x, 6);
      expect(at.y).toBeCloseTo(p.target.y, 6);
      expect(at.z).toBeCloseTo(p.target.z, 6);
      expect(pitchPosition(p, 0)).toEqual(p.release);
      // travels toward the batter (+z) throughout
      expect(pitchVelocity(p, 0).z).toBeGreaterThan(10);
      expect(pitchVelocity(p, p.duration).z).toBeGreaterThan(10);
    }
  });

  it('is deterministic for a seed', () => {
    const a = createPitch(createRng(7), setup);
    const b = createPitch(createRng(7), setup);
    expect(a).toEqual(b);
  });

  it('produces genuinely different speeds and movement per type', () => {
    const rng = createRng(3);
    const fast = createPitch(rng, setup, 'fastball');
    const change = createPitch(rng, setup, 'changeup');
    const curve = createPitch(rng, setup, 'curveball');
    const slider = createPitch(rng, setup, 'slider');
    expect(fast.duration).toBeLessThan(change.duration);
    expect(fast.speed).toBeGreaterThan(change.speed * 1.3);
    // a curveball drops far more than a fastball over the flight
    expect(curve.accel.y).toBeLessThan(fast.accel.y - 8);
    // a slider breaks sideways noticeably
    expect(Math.abs(slider.accel.x)).toBeGreaterThan(5);
    expect(Math.abs(fast.accel.x)).toBeLessThan(1.5);
    // spin signatures differ
    expect(fast.spin.x).toBeGreaterThan(0);
    expect(curve.spin.x).toBeLessThan(0);
    expect(Math.abs(slider.spin.y)).toBeGreaterThan(Math.abs(fast.spin.y));
  });

  it('varies location and timing across a round so repeated pitches are not identical', () => {
    const rng = createRng(99);
    const seen = new Set<string>();
    const types = new Set<PitchType>();
    let prev: PitchType | null = null;
    for (let i = 0; i < 30; i++) {
      const p = createPitch(rng, setup, undefined, prev);
      prev = p.type;
      types.add(p.type);
      seen.add(`${p.type}:${p.duration.toFixed(3)}:${p.target.x.toFixed(2)}:${p.target.y.toFixed(2)}`);
    }
    expect(seen.size).toBe(30);
    expect(types.size).toBeGreaterThanOrEqual(4);
  });

  it('gates pitch types by pitcher level', () => {
    for (let i = 0; i < 200; i++) {
      const t = choosePitchType(createRng(i), 1);
      expect(PITCH_PROFILES[t].level).toBe(1);
    }
    const lvl3 = new Set<PitchType>();
    for (let i = 0; i < 200; i++) lvl3.add(choosePitchType(createRng(i), 3));
    expect(lvl3.size).toBe(PITCH_TYPES.length);
    expect(pitcherLevel(0)).toBe(1);
    expect(pitcherLevel(2)).toBe(2);
    expect(pitcherLevel(5)).toBe(3);
  });
});

describe('swing timing', () => {
  const pitch = createPitch(createRng(5), setup, 'fastball');
  const perfectTap = pitch.duration - SWING_DELAY;

  it('rewards a tap that puts the bat on the ball', () => {
    const c = evaluateSwing(perfectTap, pitch, bat);
    expect(c.quality).toBe('PERFECT');
    expect(c.power).toBe(1);
    expect(c.yawError).toBe(0);
  });

  it('degrades with timing error in both directions and whiffs when far off', () => {
    const early = evaluateSwing(perfectTap - 0.09, pitch, bat);
    const late = evaluateSwing(perfectTap + 0.09, pitch, bat);
    expect(early.quality).toBe('SOLID');
    expect(late.quality).toBe('SOLID');
    expect(early.yawError).toBeLessThan(0);
    expect(late.yawError).toBeGreaterThan(0);
    expect(early.loftDelta).toBeLessThan(0);
    expect(late.loftDelta).toBeGreaterThan(0);
    expect(evaluateSwing(perfectTap - 0.2, pitch, bat).quality).toBe('POOR');
    expect(evaluateSwing(perfectTap + 0.3, pitch, bat).quality).toBe('WEAK');
    expect(evaluateSwing(perfectTap - 0.5, pitch, bat).quality).toBe('MISS');
    expect(evaluateSwing(0, pitch, bat).quality).toBe('MISS');
  });

  it('a wider timing bat forgives more, a narrow one less', () => {
    const off = perfectTap + PERFECT_WINDOW * 1.3;
    expect(evaluateSwing(off, pitch, getBat('precision')).quality).toBe('PERFECT');
    expect(evaluateSwing(off, pitch, bat).quality).toBe('SOLID');
    expect(evaluateSwing(perfectTap + PERFECT_WINDOW * 0.8, pitch, getBat('titan')).quality).not.toBe('PERFECT');
  });

  it('contact point is where the ball is when the bat arrives', () => {
    const pt = contactPoint(pitch, perfectTap);
    expect(pt.z).toBeCloseTo(pitch.target.z, 6);
    const earlyPt = contactPoint(pitch, perfectTap - 0.1);
    expect(earlyPt.z).toBeLessThan(pt.z);
  });
});

describe('launch from a pitch', () => {
  const aim = { yaw: 0, loft: 24, spin: { side: 0, lift: 0 } };
  const ball = getBall('standard');
  const pitch = createPitch(createRng(5), setup, 'fastball');
  const slow = createPitch(createRng(5), setup, 'changeup');

  it('squaring up a faster pitch adds exit velocity', () => {
    const c = evaluateSwing(pitch.duration - SWING_DELAY, pitch, bat);
    const fast = computeLaunch({ aim, contact: c, bat, ball, pitch: { speed: pitch.speed, offsetX: 0, offsetY: 0 } });
    const chg = computeLaunch({ aim, contact: c, bat, ball, pitch: { speed: slow.speed, offsetX: 0, offsetY: 0 } });
    const tee = computeLaunch({ aim, contact: c, bat, ball });
    expect(fast.speed).toBeGreaterThan(chg.speed);
    expect(chg.speed).toBeGreaterThan(tee.speed);
  });

  it('pitch location deflects the shot: inside pulls, low lifts', () => {
    const c = evaluateSwing(pitch.duration - SWING_DELAY, pitch, bat);
    const inside = computeLaunch({ aim, contact: c, bat, ball, pitch: { speed: 30, offsetX: -0.4, offsetY: 0 } });
    const outside = computeLaunch({ aim, contact: c, bat, ball, pitch: { speed: 30, offsetX: 0.4, offsetY: 0 } });
    expect(inside.velocity.x).toBeLessThan(outside.velocity.x);
    const low = computeLaunch({ aim, contact: c, bat, ball, pitch: { speed: 30, offsetX: 0, offsetY: -0.4 } });
    const high = computeLaunch({ aim, contact: c, bat, ball, pitch: { speed: 30, offsetX: 0, offsetY: 0.4 } });
    expect(low.velocity.y).toBeGreaterThan(high.velocity.y);
  });

  it('contact quality shapes spin: perfect carries backspin, topped balls topspin, late pop-ups backspin', () => {
    const perfect = computeLaunch({ aim, contact: evaluateSwing(pitch.duration - SWING_DELAY, pitch, bat), bat, ball });
    expect(classifySpin(perfect.spin)).toBe('backspin');
    const topped = computeLaunch({ aim, contact: evaluateSwing(pitch.duration - SWING_DELAY - 0.15, pitch, bat), bat, ball });
    expect(topped.spin.x).toBeLessThan(0);
    expect(classifySpin(topped.spin)).toBe('topspin');
    const popped = computeLaunch({ aim, contact: evaluateSwing(pitch.duration - SWING_DELAY + 0.15, pitch, bat), bat, ball });
    expect(popped.spin.x).toBeGreaterThan(perfect.spin.x);
    expect(popped.velocity.y / popped.speed).toBeGreaterThan(topped.velocity.y / topped.speed);
  });

  it('side spin reads as sidespin and bends the right way', () => {
    const c = evaluateSwing(pitch.duration - SWING_DELAY, pitch, bat);
    const slice = computeLaunch({ aim: { ...aim, spin: { side: 1, lift: 0 } }, contact: c, bat, ball });
    expect(classifySpin(slice.spin)).toBe('sidespin');
    // +side (slice right) → negative y angular velocity → Magnus pushes toward +x for a ball moving -z
    expect(slice.spin.y).toBeLessThan(0);
  });

  it('mistimed swings spray into foul territory', () => {
    const weak = evaluateSwing(pitch.duration - SWING_DELAY + 0.3, pitch, bat);
    const l = computeLaunch({ aim, contact: weak, bat, ball });
    const yaw = Math.atan2(l.velocity.x, -l.velocity.z);
    expect(Math.abs(yaw)).toBeGreaterThan((25 * Math.PI) / 180);
    expect(l.speed).toBeLessThan(30);
  });
});
