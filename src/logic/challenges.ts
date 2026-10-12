import type { RoundSummary, ShotSummary } from './types';

export interface Challenge {
  id: string;
  name: string;
  desc: string;
  reward: number;
  /** returns true when completed, given the finished round */
  check: (round: RoundSummary) => boolean;
  /** live progress text */
  progress: (shots: ShotSummary[]) => string;
}

export const CHALLENGES: Challenge[] = [
  {
    id: 'demolition',
    name: 'Demolition Day',
    desc: 'Score 20,000 or more in a single round.',
    reward: 800,
    check: (r) => r.total >= 20000,
    progress: (s) => `${s.reduce((a, b) => a + b.score, 0).toLocaleString()} / 20,000`,
  },
  {
    id: 'bigswing',
    name: 'One Big Swing',
    desc: 'Score 5,000 or more on a single shot.',
    reward: 600,
    check: (r) => r.bestShot >= 5000,
    progress: (s) => `${Math.max(0, ...s.map((x) => x.score)).toLocaleString()} / 5,000`,
  },
  {
    id: 'glazier',
    name: 'Glazier’s Nightmare',
    desc: 'Shatter 12 glass panels in one round.',
    reward: 500,
    check: (r) => r.glassBroken >= 12,
    progress: (s) => `${s.reduce((a, b) => a + b.glassBroken, 0)} / 12 panels`,
  },
  {
    id: 'combo',
    name: 'Combo King',
    desc: 'Reach a x4 combo on any shot.',
    reward: 700,
    check: (r) => r.bestCombo >= 4,
    progress: (s) => `best x${Math.max(1, ...s.map((x) => x.bestCombo))}`,
  },
  {
    id: 'sequence',
    name: 'Grand Tour',
    desc: 'Hit glass, a billboard, a car and a water tower in one round.',
    reward: 900,
    check: (r) => {
      const seen = new Set<string>();
      for (const s of r.shots) for (const l of s.lines) if (l.material) seen.add(l.material);
      return ['glass', 'billboard', 'car', 'watertower'].every((m) => seen.has(m));
    },
    progress: (s) => {
      const seen = new Set<string>();
      for (const x of s) for (const l of x.lines) if (l.material) seen.add(l.material);
      return `${['glass', 'billboard', 'car', 'watertower'].filter((m) => seen.has(m)).length} / 4 targets`;
    },
  },
  {
    id: 'softtouch',
    name: 'Soft Touch',
    desc: 'Score 1,500+ on a shot without perfect contact.',
    reward: 450,
    check: (r) => r.shots.some((s) => s.quality !== 'PERFECT' && s.score >= 1500),
    progress: (s) => `${Math.max(0, ...s.filter((x) => x.quality !== 'PERFECT').map((x) => x.score)).toLocaleString()} / 1,500`,
  },
];

export function getChallenge(id: string | null): Challenge | null {
  if (!id) return null;
  return CHALLENGES.find((c) => c.id === id) ?? null;
}
