import { describe, expect, it } from 'vitest';
import { BALLS_PER_ROUND, RoundManager } from '../src/logic/round';
import type { ShotSummary } from '../src/logic/types';

function shot(score: number, extra: Partial<ShotSummary> = {}): ShotSummary {
  return { score, distance: 100, quality: 'SOLID', objectsDamaged: 1, chainCount: 1, bestCombo: 1, glassBroken: 0, lines: [], uniqueMaterials: 1, sectionsDestroyed: 0, buildingsDamaged: 0, buildingsCollapsed: 0, chainCollapses: 0, detonated: false, ...extra };
}

function playShot(r: RoundManager, score = 100) {
  expect(r.transition('AIMING')).toBe(true);
  expect(r.transition('PITCHING')).toBe(true);
  expect(r.commitSwing()).toBe(true);
  expect(r.transition('BALL_IN_FLIGHT')).toBe(true);
  expect(r.transition('SHOT_RESOLVING')).toBe(true);
  expect(r.recordShot(shot(score))).toBe(true);
}

describe('RoundManager', () => {
  it('walks the full state machine for one swing', () => {
    const r = new RoundManager();
    r.transition('TITLE');
    r.startRound();
    expect(r.state).toBe('READY');
    expect(r.currentBall).toBe(1);
    playShot(r);
    expect(r.state).toBe('SHOT_RESULTS');
    expect(r.ballsUsed).toBe(1);
    expect(r.nextBall()).toBe('READY');
    expect(r.currentBall).toBe(2);
  });

  it('a taken pitch returns to the wind-up without consuming a ball', () => {
    const r = new RoundManager();
    r.startRound();
    r.transition('AIMING');
    expect(r.takePitch()).toBe(false);
    r.transition('PITCHING');
    expect(r.takePitch()).toBe(true);
    expect(r.state).toBe('AIMING');
    expect(r.ballsUsed).toBe(0);
    expect(r.commitSwing()).toBe(false);
    r.transition('PITCHING');
    expect(r.commitSwing()).toBe(true);
    expect(r.ballsUsed).toBe(1);
  });

  it('rejects invalid transitions and double swings', () => {
    const r = new RoundManager();
    r.startRound();
    expect(r.transition('BALL_IN_FLIGHT')).toBe(false);
    expect(r.commitSwing()).toBe(false);
    r.transition('AIMING');
    r.transition('PITCHING');
    expect(r.commitSwing()).toBe(true);
    expect(r.commitSwing()).toBe(false);
    expect(r.ballsUsed).toBe(1);
  });

  it('increments the ball counter exactly once per swing and records one shot per swing', () => {
    const r = new RoundManager();
    r.startRound();
    r.transition('AIMING');
    r.transition('PITCHING');
    r.commitSwing();
    r.transition('BALL_IN_FLIGHT');
    r.transition('SHOT_RESOLVING');
    expect(r.recordShot(shot(50))).toBe(true);
    expect(r.recordShot(shot(50))).toBe(false);
    expect(r.shots.length).toBe(1);
    expect(r.ballsUsed).toBe(1);
  });

  it('completes a round after ten swings and totals correctly', () => {
    const r = new RoundManager();
    r.startRound();
    for (let i = 0; i < BALLS_PER_ROUND; i++) {
      playShot(r, 100 * (i + 1));
      const next = r.nextBall();
      if (i < BALLS_PER_ROUND - 1) expect(next).toBe('READY');
      else expect(next).toBe('ROUND_COMPLETE');
    }
    expect(r.state).toBe('ROUND_COMPLETE');
    expect(r.total).toBe(5500);
    expect(r.ballsRemaining).toBe(0);
    expect(r.nextBall()).toBeNull();
    const s = r.summarize(5000, 150, null, 0);
    expect(s.isRecord).toBe(true);
    expect(s.bestShot).toBe(1000);
    expect(s.shots.length).toBe(10);
    expect(s.buildingsCollapsed).toBe(0);
    expect(s.sectionsDestroyed).toBe(0);
    // cannot swing an eleventh ball
    expect(r.transition('AIMING')).toBe(false);
  });

  it('resets cleanly for a second round', () => {
    const r = new RoundManager();
    r.startRound();
    for (let i = 0; i < BALLS_PER_ROUND; i++) {
      playShot(r);
      r.nextBall();
    }
    r.startRound();
    expect(r.state).toBe('READY');
    expect(r.ballsUsed).toBe(0);
    expect(r.shots.length).toBe(0);
    expect(r.total).toBe(0);
    playShot(r, 7);
    expect(r.total).toBe(7);
    expect(r.currentBall).toBe(1);
  });
});
