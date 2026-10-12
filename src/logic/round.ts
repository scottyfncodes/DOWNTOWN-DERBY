import type { ContactQuality, GameState, RoundSummary, ShotSummary } from './types';

export const BALLS_PER_ROUND = 10;

const TRANSITIONS: Record<GameState, GameState[]> = {
  BOOT: ['TITLE'],
  TITLE: ['READY', 'GARAGE', 'CHALLENGES', 'SETTINGS'],
  READY: ['AIMING', 'TITLE', 'SETTINGS'],
  AIMING: ['WINDING', 'READY', 'TITLE', 'SETTINGS'],
  WINDING: ['SWINGING', 'AIMING'],
  SWINGING: ['BALL_IN_FLIGHT'],
  BALL_IN_FLIGHT: ['SHOT_RESOLVING'],
  SHOT_RESOLVING: ['SHOT_RESULTS'],
  SHOT_RESULTS: ['READY', 'ROUND_COMPLETE'],
  ROUND_COMPLETE: ['READY', 'TITLE', 'GARAGE', 'CHALLENGES'],
  GARAGE: ['TITLE', 'READY'],
  CHALLENGES: ['TITLE', 'READY'],
  SETTINGS: ['TITLE', 'READY', 'AIMING'],
};

/**
 * Deterministic round + state manager. Owns the ball counter and shot history.
 * Physics/visuals live elsewhere; this never depends on them.
 */
export class RoundManager {
  state: GameState = 'BOOT';
  shots: ShotSummary[] = [];
  /** number of swings completed (ball counter) */
  ballsUsed = 0;
  private resultsShown = false;
  listeners = new Set<(s: GameState, prev: GameState) => void>();

  get ballsRemaining(): number {
    return BALLS_PER_ROUND - this.ballsUsed;
  }
  /** 1-based number of the ball currently on the tee (or just hit). */
  get currentBall(): number {
    return Math.min(BALLS_PER_ROUND, this.ballsUsed + (this.state === 'SHOT_RESULTS' || this.state === 'ROUND_COMPLETE' ? 0 : 1));
  }
  get total(): number {
    return this.shots.reduce((a, s) => a + s.score, 0);
  }
  get isRoundOver(): boolean {
    return this.ballsUsed >= BALLS_PER_ROUND;
  }

  canTransition(to: GameState): boolean {
    return TRANSITIONS[this.state].includes(to);
  }

  transition(to: GameState): boolean {
    if (!this.canTransition(to)) return false;
    const prev = this.state;
    this.state = to;
    for (const l of this.listeners) l(to, prev);
    return true;
  }

  startRound(): void {
    this.shots = [];
    this.ballsUsed = 0;
    this.resultsShown = false;
    const prev = this.state;
    this.state = 'READY';
    for (const l of this.listeners) l('READY', prev);
  }

  /** The bat connected (or whiffed); the ball counter increments exactly once here. */
  commitSwing(): boolean {
    if (this.state !== 'WINDING') return false;
    if (this.ballsUsed >= BALLS_PER_ROUND) return false;
    this.ballsUsed++;
    this.state = 'SWINGING';
    for (const l of this.listeners) l('SWINGING', 'WINDING');
    return true;
  }

  /** Records the resolved shot. Returns false if one was already recorded for this swing. */
  recordShot(summary: ShotSummary): boolean {
    if (this.state !== 'SHOT_RESOLVING') return false;
    if (this.shots.length >= this.ballsUsed) return false;
    this.shots.push(summary);
    this.transition('SHOT_RESULTS');
    return true;
  }

  /** Advances past the shot summary: either the next ball or the round results. */
  nextBall(): 'READY' | 'ROUND_COMPLETE' | null {
    if (this.state !== 'SHOT_RESULTS') return null;
    if (this.isRoundOver) {
      if (this.resultsShown) return null;
      this.resultsShown = true;
      this.transition('ROUND_COMPLETE');
      return 'ROUND_COMPLETE';
    }
    this.transition('READY');
    return 'READY';
  }

  summarize(previousBest: number, creditsEarned: number, challengeCompleted: string | null, challengeReward: number): RoundSummary {
    const total = this.total;
    return {
      total,
      bestShot: Math.max(0, ...this.shots.map((s) => s.score)),
      bestCombo: Math.max(1, ...this.shots.map((s) => s.bestCombo)),
      longestDistance: Math.max(0, ...this.shots.map((s) => s.distance)),
      objectsDamaged: this.shots.reduce((a, s) => a + s.objectsDamaged, 0),
      glassBroken: this.shots.reduce((a, s) => a + s.glassBroken, 0),
      perfectContacts: this.shots.filter((s) => s.quality === 'PERFECT').length,
      shots: this.shots.slice(),
      isRecord: total > previousBest,
      previousBest,
      creditsEarned,
      challengeCompleted,
      challengeReward,
    };
  }
}

export function qualityLabel(q: ContactQuality): string {
  switch (q) {
    case 'PERFECT':
      return 'Perfect';
    case 'SOLID':
      return 'Solid';
    case 'POOR':
      return 'Poor';
    case 'WEAK':
      return 'Weak';
    default:
      return 'Whiff';
  }
}
