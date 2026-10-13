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
    id: 'wrecker',
    name: 'Wrecking Ball',
    desc: 'Collapse at least one building in a round.',
    reward: 700,
    check: (r) => r.buildingsCollapsed >= 1,
    progress: (s) => `${s.reduce((a, b) => a + b.buildingsCollapsed, 0)} / 1 collapsed`,
  },
  {
    id: 'domino',
    name: 'Domino Effect',
    desc: 'Trigger a chain collapse: one building’s debris brings down another.',
    reward: 1200,
    check: (r) => r.chainCollapses >= 1,
    progress: (s) => `${s.reduce((a, b) => a + b.chainCollapses, 0)} / 1 chain`,
  },
  {
    id: 'spread',
    name: 'Block Party',
    desc: 'Damage four different buildings with a single swing.',
    reward: 650,
    check: (r) => r.shots.some((s) => s.buildingsDamaged >= 4),
    progress: (s) => `best ${Math.max(0, ...s.map((x) => x.buildingsDamaged))} / 4 buildings`,
  },
  {
    id: 'sections',
    name: 'Section Eight',
    desc: 'Destroy 60 building sections in one round.',
    reward: 800,
    check: (r) => r.sectionsDestroyed >= 60,
    progress: (s) => `${s.reduce((a, b) => a + b.sectionsDestroyed, 0)} / 60 sections`,
  },
  {
    id: 'demolition',
    name: 'Demolition Day',
    desc: 'Score 60,000 or more in a single round.',
    reward: 800,
    check: (r) => r.total >= 60000,
    progress: (s) => `${s.reduce((a, b) => a + b.score, 0).toLocaleString()} / 60,000`,
  },
  {
    id: 'bigswing',
    name: 'One Big Swing',
    desc: 'Score 15,000 or more on a single shot.',
    reward: 600,
    check: (r) => r.bestShot >= 15000,
    progress: (s) => `${Math.max(0, ...s.map((x) => x.score)).toLocaleString()} / 15,000`,
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
    desc: 'Score 4,000+ on a shot without perfect contact.',
    reward: 450,
    check: (r) => r.shots.some((s) => s.quality !== 'PERFECT' && s.score >= 4000),
    progress: (s) => `${Math.max(0, ...s.filter((x) => x.quality !== 'PERFECT').map((x) => x.score)).toLocaleString()} / 4,000`,
  },
];

export function getChallenge(id: string | null): Challenge | null {
  if (!id) return null;
  return CHALLENGES.find((c) => c.id === id) ?? null;
}
