import type { MaterialKind, ContactQuality } from '../logic/types';

/** Procedural WebAudio sound design: nothing to download, everything synthesized. */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  muted = false;
  private lastPlay = new Map<string, number>();
  private rocketNodes: { src: AudioBufferSourceNode; gain: GainNode; osc: OscillatorNode; filter: BiquadFilterNode } | null = null;

  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.8;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 2;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.02);
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }
  resume() {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private throttle(key: string, ms: number): boolean {
    const now = performance.now();
    const last = this.lastPlay.get(key) ?? -Infinity;
    if (now - last < ms) return false;
    this.lastPlay.set(key, now);
    return true;
  }

  private noise(duration: number, gain: number, filterType: BiquadFilterType, freq: number, q = 1, freqEnd?: number): void {
    if (!this.ctx || !this.master || !this.noiseBuf) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = this.ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + duration);
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + duration + 0.05);
  }

  private tone(freq: number, duration: number, gain: number, type: OscillatorType = 'sine', freqEnd?: number, delay = 0): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + duration);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + duration + 0.05);
  }

  batContact(quality: ContactQuality) {
    if (quality === 'MISS') {
      this.noise(0.25, 0.25, 'bandpass', 600, 0.8, 1800);
      return;
    }
    const power = quality === 'PERFECT' ? 1 : quality === 'SOLID' ? 0.8 : quality === 'POOR' ? 0.55 : 0.35;
    this.noise(0.06, 0.9 * power, 'bandpass', 2200, 0.6);
    this.noise(0.14, 0.5 * power, 'lowpass', 500, 0.7);
    this.tone(160, 0.12, 0.5 * power, 'sine', 60);
    if (quality === 'PERFECT') {
      this.tone(2400, 0.35, 0.18, 'sine', 2300);
      this.tone(3600, 0.25, 0.1, 'sine');
    }
  }

  whoosh() {
    this.noise(0.22, 0.2, 'bandpass', 400, 1.2, 2400);
  }

  impact(material: MaterialKind, speed: number, destroyed: boolean) {
    const v = Math.min(1, speed / 40);
    switch (material) {
      case 'glass': {
        if (!this.throttle('glass', 40)) return;
        this.noise(0.08, 0.6 * v + 0.2, 'highpass', 3000, 0.7);
        for (let i = 0; i < 5; i++) this.tone(4000 + Math.random() * 5000, 0.25 + Math.random() * 0.3, 0.05 + v * 0.08, 'sine', undefined, Math.random() * 0.12);
        this.noise(0.5, 0.25, 'highpass', 5000, 0.5);
        break;
      }
      case 'hvac':
      case 'streetlight':
      case 'antenna':
      case 'scaffold':
      case 'barrel':
      case 'watertower': {
        if (!this.throttle('metal', 50)) return;
        const base = material === 'watertower' ? 180 : material === 'barrel' ? 260 : 420;
        this.noise(0.05, 0.5 * v + 0.15, 'bandpass', 1800, 1);
        this.tone(base, 0.6, 0.25 * v + 0.08, 'triangle', base * 0.9);
        this.tone(base * 2.76, 0.4, 0.15 * v, 'sine');
        this.tone(base * 5.4, 0.25, 0.08 * v, 'sine');
        break;
      }
      case 'car': {
        if (!this.throttle('car', 120)) return;
        this.noise(0.12, 0.7 * v + 0.2, 'lowpass', 900, 0.8);
        this.tone(120, 0.25, 0.4, 'sine', 50);
        this.tone(1800, 0.05, 0.2, 'square');
        if (destroyed || Math.random() < 0.6) {
          for (let i = 0; i < 6; i++) this.tone(i % 2 ? 880 : 1174, 0.2, 0.07, 'square', undefined, 0.2 + i * 0.22);
        }
        break;
      }
      case 'crate':
      case 'plank':
      case 'awning': {
        if (!this.throttle('wood', 50)) return;
        this.noise(0.08, 0.6 * v + 0.15, 'bandpass', 900, 1.5);
        this.tone(220, 0.1, 0.25 * v, 'triangle', 120);
        if (destroyed) this.noise(0.3, 0.4, 'bandpass', 1400, 0.8, 500);
        break;
      }
      case 'sign':
      case 'billboard': {
        if (!this.throttle('board', 60)) return;
        this.noise(0.1, 0.6 * v + 0.2, 'bandpass', 700, 1);
        this.tone(140, 0.3, 0.4 * v + 0.1, 'triangle', 80);
        if (destroyed) {
          this.noise(0.6, 0.35, 'lowpass', 700, 0.6);
          this.tone(90, 0.5, 0.3, 'sine', 40, 0.15);
        }
        break;
      }
      case 'brick': {
        if (!this.throttle('brick', 45)) return;
        this.noise(0.09, 0.55 * v + 0.15, 'bandpass', 1100, 0.9, 400);
        this.noise(0.25, 0.3 * v, 'lowpass', 500, 0.7);
        this.tone(140, 0.14, 0.3 * v, 'triangle', 70);
        if (destroyed) this.noise(0.45, 0.4, 'lowpass', 800, 0.6, 250);
        break;
      }
      case 'concrete':
      case 'slab':
      case 'column':
      case 'rubble': {
        if (!this.throttle('concrete', 45)) return;
        this.noise(0.08, 0.5 * v + 0.15, 'lowpass', 700, 0.8);
        this.tone(95, 0.18, 0.4 * v + 0.05, 'sine', 45);
        if (destroyed) {
          this.noise(0.6, 0.45, 'lowpass', 420, 0.6, 120);
          this.tone(60, 0.5, 0.35, 'sine', 35, 0.05);
        }
        break;
      }
      case 'steel': {
        if (!this.throttle('steel', 50)) return;
        this.noise(0.06, 0.5 * v + 0.15, 'bandpass', 2400, 1.2);
        this.tone(320, 0.45, 0.22 * v + 0.05, 'triangle', 300);
        this.tone(880, 0.3, 0.1 * v, 'sine');
        if (destroyed) this.noise(0.4, 0.3, 'bandpass', 900, 0.8, 300);
        break;
      }
      default: {
        if (!this.throttle('thud', 60)) return;
        this.noise(0.1, 0.35 * v + 0.05, 'lowpass', 350, 0.8);
        this.tone(80, 0.12, 0.3 * v, 'sine', 40);
      }
    }
  }

  combo(index: number) {
    const scale = [523, 659, 784, 988, 1175, 1319, 1568];
    const f = scale[Math.min(scale.length - 1, index)];
    this.tone(f, 0.18, 0.18, 'triangle');
    this.tone(f * 2, 0.12, 0.08, 'sine');
  }

  bigEvent() {
    this.tone(196, 0.5, 0.25, 'sawtooth', 98);
    this.noise(0.4, 0.25, 'lowpass', 300, 0.7);
    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.25, 0.12, 'triangle', undefined, 0.05 + i * 0.07));
  }

  record() {
    [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, 0.35, 0.16, 'triangle', undefined, i * 0.11));
    this.tone(1568, 0.8, 0.14, 'sine', undefined, 0.6);
  }

  fanfare() {
    [392, 523, 659, 784].forEach((f, i) => this.tone(f, 0.3, 0.14, 'triangle', undefined, i * 0.12));
    this.tone(1046, 0.7, 0.12, 'sine', undefined, 0.5);
  }

  tick() {
    this.tone(1200, 0.04, 0.08, 'square');
  }

  click() {
    this.tone(700, 0.05, 0.1, 'triangle', 400);
  }

  unlock_() {
    [660, 880, 1320].forEach((f, i) => this.tone(f, 0.18, 0.12, 'triangle', undefined, i * 0.08));
  }

  /** Pitch release: a short arm whip and the ball leaving the hand. */
  pitchRelease() {
    this.noise(0.16, 0.16, 'bandpass', 900, 1, 2600);
    this.tone(420, 0.06, 0.06, 'sine', 300);
  }

  /** Pitch passing the plate untouched: a soft catcher's pop. */
  catcherPop() {
    this.noise(0.05, 0.3, 'bandpass', 1400, 0.8);
    this.tone(180, 0.08, 0.2, 'sine', 90);
  }

  /** Fuse arming click right after contact. */
  armClick() {
    this.tone(1800, 0.04, 0.08, 'square');
    this.tone(2400, 0.05, 0.06, 'square', undefined, 0.06);
  }

  rocketIgnite() {
    this.noise(0.35, 0.7, 'lowpass', 1200, 0.7, 300);
    this.tone(90, 0.3, 0.5, 'sawtooth', 220);
    this.tone(1200, 0.12, 0.15, 'square', 2400);
    this.startRocketLoop();
  }

  private startRocketLoop() {
    if (!this.ctx || !this.master || !this.noiseBuf || this.rocketNodes) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 520;
    filter.Q.value = 0.6;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 70;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.42, t + 0.08);
    src.connect(filter).connect(gain);
    const og = this.ctx.createGain();
    og.gain.value = 0.12;
    osc.connect(og).connect(gain);
    gain.connect(this.master);
    src.start(t);
    osc.start(t);
    this.rocketNodes = { src, gain, osc, filter };
  }

  /** Call every frame while the rocket is lit: `intensity` 0..1 fuel, `speed` m/s. */
  rocketLoop(intensity: number, speed: number) {
    if (!this.rocketNodes || !this.ctx) return;
    const t = this.ctx.currentTime;
    this.rocketNodes.gain.gain.setTargetAtTime(0.1 + 0.35 * intensity, t, 0.05);
    this.rocketNodes.filter.frequency.setTargetAtTime(400 + speed * 6, t, 0.08);
    this.rocketNodes.osc.frequency.setTargetAtTime(55 + speed * 0.5, t, 0.08);
  }

  rocketStop() {
    if (!this.rocketNodes || !this.ctx) return;
    const n = this.rocketNodes;
    const t = this.ctx.currentTime;
    n.gain.gain.setTargetAtTime(0.0001, t, 0.05);
    n.src.stop(t + 0.3);
    n.osc.stop(t + 0.3);
    this.rocketNodes = null;
  }

  /** Detonation: low-end thump, crack, debris tail. `size` 0..1. */
  explosion(size: number) {
    this.rocketStop();
    const g = 0.6 + size * 0.5;
    this.noise(0.12, g, 'lowpass', 3000, 0.5, 200);
    this.tone(55, 0.9, 0.9 * g, 'sine', 25);
    this.tone(110, 0.35, 0.4 * g, 'triangle', 40);
    this.noise(1.2, 0.45 * g, 'lowpass', 500, 0.6, 80);
    this.noise(0.9, 0.25 * g, 'bandpass', 1600, 0.7, 300);
    for (let i = 0; i < 5; i++) this.noise(0.08, 0.15, 'bandpass', 700 + Math.random() * 900, 1.2, undefined);
  }

  /** Structural stress: a low groan with creaks, used while a floor is unstable. */
  groan() {
    if (!this.throttle('groan', 900)) return;
    this.tone(48, 1.1, 0.3, 'sawtooth', 38);
    this.noise(0.5, 0.18, 'bandpass', 240, 2, 160);
    this.tone(900 + Math.random() * 600, 0.12, 0.08, 'square', 500, 0.3);
  }

  /** Floor failure: cracking burst, then a rumble sized to the number of floors dropping. */
  collapse(floors: number) {
    const size = Math.min(1, 0.4 + floors * 0.06);
    this.noise(0.25, 0.7, 'bandpass', 900, 0.8, 200);
    this.tone(70, 1.6 * size + 0.6, 0.7 * size, 'sine', 30);
    this.noise(1.8 * size + 0.8, 0.5 * size, 'lowpass', 300, 0.6, 60);
    for (let i = 0; i < 6; i++) this.noise(0.1, 0.25, 'lowpass', 500, 0.8, undefined);
    if (floors >= 6) this.tone(45, 2.4, 0.4, 'triangle', 28, 0.3);
  }

  /** Debris landing: heavy thud scaled by speed. */
  rubble(speed: number) {
    if (!this.throttle('rubble', 70)) return;
    const v = Math.min(1, speed / 30);
    this.noise(0.14, 0.35 * v + 0.1, 'lowpass', 400, 0.8);
    this.tone(60, 0.25, 0.35 * v, 'sine', 32);
  }
}
