export interface Settings {
  sound: boolean;
  shake: boolean;
  reducedMotion: boolean;
  haptics: boolean;
  slowmo: boolean;
}

export interface Profile {
  version: number;
  credits: number;
  bestScore: number;
  bestShot: number;
  bestCombo: number;
  longestDistance: number;
  roundsPlayed: number;
  unlockedBats: string[];
  unlockedBalls: string[];
  equippedBat: string;
  equippedBall: string;
  completedChallenges: string[];
  activeChallenge: string | null;
  settings: Settings;
}

export const PROFILE_KEY = 'downtown-derby.profile.v1';

export function defaultProfile(): Profile {
  return {
    version: 1,
    credits: 0,
    bestScore: 0,
    bestShot: 0,
    bestCombo: 1,
    longestDistance: 0,
    roundsPlayed: 0,
    unlockedBats: ['balanced'],
    unlockedBalls: ['standard'],
    equippedBat: 'balanced',
    equippedBall: 'standard',
    completedChallenges: [],
    activeChallenge: null,
    settings: { sound: true, shake: true, reducedMotion: false, haptics: true, slowmo: true },
  };
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Returns a storage adapter, or null when storage is unavailable (private mode, blocked, etc). */
export function resolveStorage(candidate?: StorageLike | null): StorageLike | null {
  try {
    const s = candidate ?? (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!s) return null;
    const probe = '__dd_probe__';
    s.setItem(probe, '1');
    s.getItem(probe);
    try {
      (s as unknown as { removeItem?: (k: string) => void }).removeItem?.(probe);
    } catch {
      /* ignore */
    }
    return s;
  } catch {
    return null;
  }
}

export function sanitizeProfile(raw: unknown): Profile {
  const d = defaultProfile();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<Profile>;
  const num = (v: unknown, fb: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fb);
  const strArr = (v: unknown, fb: string[]) => (Array.isArray(v) ? Array.from(new Set([...fb, ...v.filter((x) => typeof x === 'string')])) : fb);
  const s = (r.settings ?? {}) as Partial<Settings>;
  const bool = (v: unknown, fb: boolean) => (typeof v === 'boolean' ? v : fb);
  const p: Profile = {
    version: 1,
    credits: Math.floor(num(r.credits, 0)),
    bestScore: Math.floor(num(r.bestScore, 0)),
    bestShot: Math.floor(num(r.bestShot, 0)),
    bestCombo: Math.max(1, num(r.bestCombo, 1)),
    longestDistance: Math.floor(num(r.longestDistance, 0)),
    roundsPlayed: Math.floor(num(r.roundsPlayed, 0)),
    unlockedBats: strArr(r.unlockedBats, d.unlockedBats),
    unlockedBalls: strArr(r.unlockedBalls, d.unlockedBalls),
    equippedBat: typeof r.equippedBat === 'string' ? r.equippedBat : d.equippedBat,
    equippedBall: typeof r.equippedBall === 'string' ? r.equippedBall : d.equippedBall,
    completedChallenges: strArr(r.completedChallenges, []),
    activeChallenge: typeof r.activeChallenge === 'string' ? r.activeChallenge : null,
    settings: {
      sound: bool(s.sound, true),
      shake: bool(s.shake, true),
      reducedMotion: bool(s.reducedMotion, false),
      haptics: bool(s.haptics, true),
      slowmo: bool(s.slowmo, true),
    },
  };
  if (!p.unlockedBats.includes(p.equippedBat)) p.equippedBat = 'balanced';
  if (!p.unlockedBalls.includes(p.equippedBall)) p.equippedBall = 'standard';
  return p;
}

export class ProfileStore {
  profile: Profile;
  readonly persistent: boolean;
  private storage: StorageLike | null;

  constructor(storage?: StorageLike | null) {
    this.storage = resolveStorage(storage);
    this.persistent = this.storage !== null;
    this.profile = this.load();
  }

  private load(): Profile {
    if (!this.storage) return defaultProfile();
    try {
      const raw = this.storage.getItem(PROFILE_KEY);
      if (!raw) return defaultProfile();
      return sanitizeProfile(JSON.parse(raw));
    } catch {
      return defaultProfile();
    }
  }

  save(): boolean {
    if (!this.storage) return false;
    try {
      this.storage.setItem(PROFILE_KEY, JSON.stringify(this.profile));
      return true;
    } catch {
      return false;
    }
  }

  update(fn: (p: Profile) => void): void {
    fn(this.profile);
    this.save();
  }

  /** Applies a finished round. Returns whether a new best score was set. */
  applyRound(total: number, bestShot: number, bestCombo: number, longest: number, credits: number): boolean {
    const p = this.profile;
    const record = total > p.bestScore;
    p.bestScore = Math.max(p.bestScore, total);
    p.bestShot = Math.max(p.bestShot, bestShot);
    p.bestCombo = Math.max(p.bestCombo, bestCombo);
    p.longestDistance = Math.max(p.longestDistance, longest);
    p.roundsPlayed++;
    p.credits += credits;
    this.save();
    return record;
  }

  tryUnlock(kind: 'bat' | 'ball', id: string, cost: number): boolean {
    const p = this.profile;
    const list = kind === 'bat' ? p.unlockedBats : p.unlockedBalls;
    if (list.includes(id)) return true;
    if (p.credits < cost) return false;
    p.credits -= cost;
    list.push(id);
    this.save();
    return true;
  }

  equip(kind: 'bat' | 'ball', id: string): boolean {
    const p = this.profile;
    const list = kind === 'bat' ? p.unlockedBats : p.unlockedBalls;
    if (!list.includes(id)) return false;
    if (kind === 'bat') p.equippedBat = id;
    else p.equippedBall = id;
    this.save();
    return true;
  }

  completeChallenge(id: string, reward: number): boolean {
    const p = this.profile;
    if (p.completedChallenges.includes(id)) return false;
    p.completedChallenges.push(id);
    p.credits += reward;
    this.save();
    return true;
  }
}
