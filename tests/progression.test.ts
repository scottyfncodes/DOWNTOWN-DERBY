import { describe, expect, it } from 'vitest';
import { PROFILE_KEY, ProfileStore, defaultProfile, sanitizeProfile, type StorageLike } from '../src/logic/progression';
import { CHALLENGES } from '../src/logic/challenges';

class MemStorage implements StorageLike {
  map = new Map<string, string>();
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
}

class BrokenStorage implements StorageLike {
  getItem(): string | null {
    throw new Error('blocked');
  }
  setItem(): void {
    throw new Error('blocked');
  }
}

describe('ProfileStore', () => {
  it('persists rounds, unlocks and equips across instances', () => {
    const mem = new MemStorage();
    const a = new ProfileStore(mem);
    expect(a.persistent).toBe(true);
    expect(a.applyRound(12000, 3000, 2.5, 250, 400)).toBe(true);
    expect(a.applyRound(9000, 100, 1, 50, 100)).toBe(false);
    expect(a.tryUnlock('bat', 'slugger', 1800)).toBe(false);
    a.profile.credits = 5000;
    expect(a.tryUnlock('bat', 'slugger', 1800)).toBe(true);
    expect(a.equip('bat', 'slugger')).toBe(true);
    expect(a.equip('ball', 'wrecker')).toBe(false);
    const b = new ProfileStore(mem);
    expect(b.profile.bestScore).toBe(12000);
    expect(b.profile.credits).toBe(3200);
    expect(b.profile.equippedBat).toBe('slugger');
    expect(b.profile.roundsPlayed).toBe(2);
  });

  it('works without storage', () => {
    const s = new ProfileStore(null);
    expect(s.persistent).toBe(false);
    expect(s.save()).toBe(false);
    expect(s.applyRound(100, 100, 1, 10, 5)).toBe(true);
    expect(s.profile.credits).toBe(5);
  });

  it('survives a throwing storage', () => {
    const s = new ProfileStore(new BrokenStorage());
    expect(s.persistent).toBe(false);
    expect(s.profile).toEqual(defaultProfile());
  });

  it('sanitizes corrupt data', () => {
    const mem = new MemStorage();
    mem.setItem(PROFILE_KEY, '{not json');
    expect(new ProfileStore(mem).profile).toEqual(defaultProfile());
    mem.setItem(PROFILE_KEY, JSON.stringify({ credits: -5, equippedBat: 'titan', unlockedBats: ['zzz', 3], settings: { sound: 'no' } }));
    const p = new ProfileStore(mem).profile;
    expect(p.credits).toBe(0);
    expect(p.equippedBat).toBe('balanced');
    expect(p.unlockedBats).toEqual(['balanced', 'zzz']);
    expect(p.settings.sound).toBe(true);
    expect(sanitizeProfile(null)).toEqual(defaultProfile());
  });

  it('awards each challenge once', () => {
    const s = new ProfileStore(new MemStorage());
    const c = CHALLENGES[0];
    expect(s.completeChallenge(c.id, c.reward)).toBe(true);
    expect(s.completeChallenge(c.id, c.reward)).toBe(false);
    expect(s.profile.credits).toBe(c.reward);
  });
});
