import type { ContactQuality, RoundSummary, ShotSummary, ScoreLine } from '../logic/types';
import { qualityLabel } from '../logic/round';
import { BATS, BALLS, ROCKETS } from '../logic/equipment';
import { CHALLENGES } from '../logic/challenges';
import type { EquipKind, Profile } from '../logic/progression';

export interface UIHandlers {
  onPlay: () => void;
  onGarage: () => void;
  onChallenges: () => void;
  onSettings: () => void;
  onBack: () => void;
  onMute: () => void;
  /** tap: swing at the pitch (or detonate when a rocket is lit and the swing is spent) */
  onSwing: () => void;
  /** tap: detonate the rocket ball in flight */
  onDetonate: () => void;
  onContinue: () => void;
  onPlayAgain: () => void;
  onEquip: (kind: EquipKind, id: string) => void;
  onBuy: (kind: EquipKind, id: string) => void;
  onSelectChallenge: (id: string | null) => void;
  onToggleSetting: (key: 'sound' | 'shake' | 'reducedMotion' | 'haptics' | 'slowmo') => void;
  onLoft: (delta: number) => void;
  onSpin: (side: number) => void;
  onLift: (lift: number) => void;
  onAimDrag: (dx: number, dy: number) => void;
}

// Hand-drawn speaker glyphs for the mute toggle, stroked in the HUD cream so they match the type, not an emoji set.
const SPEAKER_BODY = '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>';
const ICON_SOUND_ON = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">${SPEAKER_BODY}<path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.8 7.8 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>`;
const ICON_SOUND_OFF = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">${SPEAKER_BODY}<path d="M15.5 9.5l5 5M20.5 9.5l-5 5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

export class UI {
  root: HTMLElement;
  loading: HTMLElement;
  title: HTMLElement;
  hud: HTMLElement;
  results: HTMLElement;
  garage: HTMLElement;
  challenges: HTMLElement;
  settings: HTMLElement;
  scoreValue: HTMLElement;
  ballsValue: HTMLElement;
  comboBadge: HTMLElement;
  windPill: HTMLElement;
  bonusPill: HTMLElement;
  challengePill: HTMLElement;
  aimHint: HTMLElement;
  swingBtn: HTMLButtonElement;
  detonateBtn: HTMLButtonElement;
  pitchPill: HTMLElement;
  rocketPill: HTMLElement;
  swingRing: SVGSVGElement;
  needle: SVGCircleElement;
  sweetArc: SVGPathElement;
  fillArc: SVGPathElement;
  popupLayer: HTMLElement;
  callout: HTMLElement;
  shotCard: HTMLElement;
  flash: HTMLElement;
  toast: HTMLElement;
  advPanel: HTMLElement;
  loftVal: HTMLElement;
  muteBtns: HTMLButtonElement[] = [];
  bestLine: HTMLElement;
  private displayedScore = 0;
  private targetScore = 0;
  private toastTimer = 0;
  private popups = 0;
  private lastSwingTap = 0;
  private lastDetonateTap = 0;
  private pitchPillTimer = 0;
  private rocketKey = '';

  constructor(root: HTMLElement, private h: UIHandlers) {
    this.root = root;
    this.loading = el('div', 'loading', 'DOWNTOWN DERBY<small>WARMING UP THE CITY</small>');
    root.appendChild(this.loading);

    // ---- Title ----
    this.title = el('div', 'screen title-screen');
    const tw = el('div', 'title-wrap');
    tw.appendChild(el('div', 'title-kicker', 'Rooftop Rocket Demolition'));
    tw.appendChild(el('h1', 'title-main', 'Downtown<span class="accent">Derby</span>'));
    tw.appendChild(el('div', 'title-tag', 'Ten pitches · One city · Bring it down'));
    this.title.appendChild(tw);
    this.title.appendChild(el('div', 'spacer'));
    const actions = el('div', 'title-actions');
    this.bestLine = el('div', 'best-line', '');
    actions.appendChild(this.bestLine);
    const play = el('button', 'play-btn', 'Play');
    play.id = 'play-btn';
    play.addEventListener('click', () => h.onPlay());
    actions.appendChild(play);
    const row = el('div', 'title-row');
    const garage = el('button', 'ghost', 'Garage');
    garage.id = 'garage-btn';
    garage.addEventListener('click', () => h.onGarage());
    const chall = el('button', 'ghost', 'Challenges');
    chall.id = 'challenges-btn';
    chall.addEventListener('click', () => h.onChallenges());
    row.append(garage, chall);
    actions.appendChild(row);
    this.title.appendChild(actions);
    const tr = el('div', 'top-right');
    tr.append(this.makeMute(), this.makeSettingsBtn());
    this.title.appendChild(tr);
    root.appendChild(this.title);

    // ---- HUD ----
    this.hud = el('div');
    this.hud.id = 'hud';
    const top = el('div', 'hud-top');
    const sb = el('div', 'score-block');
    sb.appendChild(el('div', 'score-label', 'Score'));
    this.scoreValue = el('div', 'score-value', '0');
    this.scoreValue.id = 'score-value';
    sb.appendChild(this.scoreValue);
    const pills = el('div', 'hud-pills');
    this.windPill = el('div', 'pill', 'Calm');
    this.bonusPill = el('div', 'pill gold', '★ Bonus');
    this.challengePill = el('div', 'pill', '');
    this.challengePill.style.display = 'none';
    pills.append(this.windPill, this.bonusPill, this.challengePill);
    sb.appendChild(pills);
    const bb = el('div', 'balls-block');
    bb.appendChild(el('div', 'score-label', 'Ball'));
    this.ballsValue = el('div', 'balls-value', '1<small>/10</small>');
    this.ballsValue.id = 'balls-value';
    bb.appendChild(this.ballsValue);
    const hr = el('div', 'top-right');
    hr.style.position = 'static';
    hr.append(this.makeMute(), this.makeSettingsBtn());
    top.append(sb, bb, hr);
    this.hud.appendChild(top);
    this.comboBadge = el('div', 'combo-badge', '');
    this.comboBadge.id = 'combo-badge';
    this.hud.appendChild(this.comboBadge);
    this.popupLayer = el('div', 'popup-layer');
    this.hud.appendChild(this.popupLayer);
    this.callout = el('div', 'center-callout', '');
    this.hud.appendChild(this.callout);
    this.pitchPill = el('div', 'pitch-pill', '');
    this.pitchPill.id = 'pitch-pill';
    this.hud.appendChild(this.pitchPill);
    this.rocketPill = el('div', 'rocket-pill', '');
    this.rocketPill.id = 'rocket-pill';
    this.hud.appendChild(this.rocketPill);
    this.shotCard = el('div', 'shot-card');
    this.shotCard.id = 'shot-card';
    this.hud.appendChild(this.shotCard);

    const bottom = el('div', 'hud-bottom');
    this.aimHint = el('div', 'aim-hint', 'Drag to aim · Tap SWING as the pitch crosses the plate');
    bottom.appendChild(this.aimHint);
    const wrap = el('div', 'swing-wrap');
    this.swingRing = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.swingRing.setAttribute('viewBox', '0 0 132 132');
    this.swingRing.classList.add('swing-ring');
    const track = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    track.setAttribute('d', arcPath(66, 66, 60, -135, 135));
    track.setAttribute('fill', 'none');
    track.setAttribute('stroke', 'rgba(20,13,31,0.55)');
    track.setAttribute('stroke-width', '9');
    track.setAttribute('stroke-linecap', 'round');
    this.fillArc = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    this.fillArc.setAttribute('fill', 'none');
    this.fillArc.setAttribute('stroke', '#ffd166');
    this.fillArc.setAttribute('stroke-width', '9');
    this.fillArc.setAttribute('stroke-linecap', 'round');
    this.sweetArc = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    this.sweetArc.setAttribute('fill', 'none');
    this.sweetArc.setAttribute('stroke', '#4ee6b0');
    this.sweetArc.setAttribute('stroke-width', '11');
    this.sweetArc.setAttribute('stroke-linecap', 'round');
    this.needle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    this.needle.setAttribute('r', '8');
    this.needle.setAttribute('fill', '#fff4e0');
    this.needle.setAttribute('stroke', '#140d1f');
    this.needle.setAttribute('stroke-width', '3');
    this.needle.style.display = 'none';
    this.swingRing.append(track, this.sweetArc, this.fillArc, this.needle);
    wrap.appendChild(this.swingRing);
    this.swingBtn = el('button', 'swing-btn', 'Swing<small>tap</small>');
    this.swingBtn.id = 'swing-btn';
    const swingTap = (e: Event) => {
      e.preventDefault();
      const now = performance.now();
      if (now - this.lastSwingTap < 120) return; // de-duplicate pointer + click + key
      this.lastSwingTap = now;
      this.swingBtn.classList.add('is-pressed');
      window.setTimeout(() => this.swingBtn.classList.remove('is-pressed'), 120);
      h.onSwing();
    };
    this.swingBtn.addEventListener('pointerdown', swingTap);
    this.swingBtn.addEventListener('contextmenu', (e) => e.preventDefault());
    this.detonateBtn = el('button', 'detonate-btn', 'Detonate<small>tap</small>');
    this.detonateBtn.id = 'detonate-btn';
    const detonateTap = (e: Event) => {
      e.preventDefault();
      const now = performance.now();
      if (now - this.lastDetonateTap < 150) return;
      this.lastDetonateTap = now;
      h.onDetonate();
    };
    this.detonateBtn.addEventListener('pointerdown', detonateTap);
    this.detonateBtn.addEventListener('contextmenu', (e) => e.preventDefault());
    this.detonateBtn.style.display = 'none';
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        swingTap(e);
      }
      if ((e.code === 'KeyD' || e.code === 'KeyX') && !e.repeat) detonateTap(e);
    });
    wrap.appendChild(this.detonateBtn);
    wrap.appendChild(this.swingBtn);
    bottom.appendChild(wrap);
    this.hud.appendChild(bottom);

    // Side: advanced controls.
    const side = el('div', 'side-controls');
    this.advPanel = el('div', 'adv-panel');
    this.advPanel.appendChild(el('div', 'lbl', 'Loft'));
    const loftRow = el('div', 'loft-row');
    const minus = el('button', '', '−');
    minus.addEventListener('click', () => h.onLoft(-4));
    this.loftVal = el('div', 'loft-val', '6°');
    const plus = el('button', '', '+');
    plus.addEventListener('click', () => h.onLoft(4));
    loftRow.append(minus, this.loftVal, plus);
    this.advPanel.appendChild(loftRow);
    this.advPanel.appendChild(el('div', 'lbl', 'Spin'));
    const seg = el('div', 'seg');
    for (const [label, v] of [
      ['↶', -1],
      ['•', 0],
      ['↷', 1],
    ] as [string, number][]) {
      const b = el('button', v === 0 ? 'on' : '', label);
      b.dataset.spin = String(v);
      b.addEventListener('click', () => {
        seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
        h.onSpin(v);
      });
      seg.appendChild(b);
    }
    this.advPanel.appendChild(seg);
    const seg2 = el('div', 'seg');
    for (const [label, v] of [
      ['Top', -1],
      ['Flat', 0],
      ['Back', 1],
    ] as [string, number][]) {
      const b = el('button', v === 0 ? 'on' : '', label);
      b.addEventListener('click', () => {
        seg2.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
        h.onLift(v);
      });
      seg2.appendChild(b);
    }
    this.advPanel.appendChild(seg2);
    side.appendChild(this.advPanel);
    const advBtn = el('button', 'ghost icon', '⚙︎');
    advBtn.id = 'adv-btn';
    advBtn.title = 'Loft & spin';
    advBtn.innerHTML = '<span style="font-size:13px;letter-spacing:0.08em">ADV</span>';
    advBtn.addEventListener('click', () => this.advPanel.classList.toggle('open'));
    side.appendChild(advBtn);
    this.hud.appendChild(side);
    root.appendChild(this.hud);

    // ---- Results ----
    this.results = el('div', 'screen results-screen');
    this.results.id = 'results';
    root.appendChild(this.results);

    // ---- Garage ----
    this.garage = el('div', 'screen');
    this.garage.id = 'garage';
    root.appendChild(this.garage);

    // ---- Challenges ----
    this.challenges = el('div', 'screen');
    this.challenges.id = 'challenges';
    root.appendChild(this.challenges);

    // ---- Settings ----
    this.settings = el('div', 'screen');
    this.settings.id = 'settings';
    root.appendChild(this.settings);

    this.flash = el('div', 'flash');
    root.appendChild(this.flash);
    this.toast = el('div', 'toast');
    root.appendChild(this.toast);

    // Shot card tap-to-continue
    this.shotCard.addEventListener('click', () => h.onContinue());
    this.shotCard.classList.add('tap');

    // Aim drag on the canvas
    const canvas = document.getElementById('game-canvas')!;
    let dragging = false;
    let lx = 0;
    let ly = 0;
    canvas.addEventListener('pointerdown', (e) => {
      dragging = true;
      lx = e.clientX;
      ly = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - lx;
      const dy = e.clientY - ly;
      lx = e.clientX;
      ly = e.clientY;
      h.onAimDrag(dx / window.innerWidth, dy / window.innerHeight);
    });
    const end = () => {
      dragging = false;
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('click', () => h.onContinue());
    window.addEventListener('keydown', (e) => {
      if (e.code === 'ArrowLeft') h.onAimDrag(-0.02, 0);
      if (e.code === 'ArrowRight') h.onAimDrag(0.02, 0);
      if (e.code === 'ArrowUp') h.onLoft(2);
      if (e.code === 'ArrowDown') h.onLoft(-2);
      if (e.code === 'Enter') h.onContinue();
    });
  }

  private makeMute(): HTMLButtonElement {
    const b = el('button', 'ghost icon', ICON_SOUND_ON);
    b.classList.add('mute-btn');
    b.setAttribute('aria-label', 'Mute sound');
    b.addEventListener('click', () => this.h.onMute());
    this.muteBtns.push(b);
    return b;
  }
  private makeSettingsBtn(): HTMLButtonElement {
    const b = el('button', 'ghost icon', '☰');
    b.classList.add('settings-btn');
    b.setAttribute('aria-label', 'Settings');
    b.addEventListener('click', () => this.h.onSettings());
    return b;
  }

  setMuted(m: boolean) {
    for (const b of this.muteBtns) {
      b.innerHTML = m ? ICON_SOUND_OFF : ICON_SOUND_ON;
      b.setAttribute('aria-label', m ? 'Unmute sound' : 'Mute sound');
    }
  }

  hideLoading() {
    this.loading.classList.add('hidden');
  }

  showScreen(name: 'title' | 'hud' | 'results' | 'garage' | 'challenges' | 'settings' | 'none') {
    this.title.classList.toggle('visible', name === 'title');
    this.hud.classList.toggle('visible', name === 'hud');
    this.results.classList.toggle('visible', name === 'results');
    this.garage.classList.toggle('visible', name === 'garage');
    this.challenges.classList.toggle('visible', name === 'challenges');
    this.settings.classList.toggle('visible', name === 'settings');
  }

  setBest(profile: Profile) {
    this.bestLine.innerHTML = profile.bestScore > 0 ? `Best round <b>${profile.bestScore.toLocaleString()}</b> · Credits <b>${profile.credits.toLocaleString()}</b>` : 'Swing for the skyline';
  }

  setScore(v: number) {
    if (v !== this.targetScore) {
      this.targetScore = v;
      this.scoreValue.classList.remove('bump');
      void this.scoreValue.offsetWidth;
      this.scoreValue.classList.add('bump');
    }
  }

  setBalls(current: number, total: number) {
    this.ballsValue.innerHTML = `${current}<small>/${total}</small>`;
  }

  setWind(speed: number, dirX: number) {
    if (speed < 0.8) this.windPill.textContent = 'Calm';
    else this.windPill.textContent = `Wind ${dirX < 0 ? '←' : '→'} ${speed.toFixed(0)}`;
  }

  setBonus(label: string | null) {
    this.bonusPill.style.display = label ? '' : 'none';
    if (label) this.bonusPill.textContent = `★ ${label} 2×`;
  }

  setChallengeProgress(text: string | null) {
    this.challengePill.style.display = text ? '' : 'none';
    if (text) this.challengePill.textContent = text;
  }

  setLoft(deg: number) {
    this.loftVal.textContent = `${Math.round(deg)}°`;
  }

  setCombo(mult: number, count: number) {
    if (mult <= 1) {
      this.comboBadge.classList.remove('visible');
      return;
    }
    this.comboBadge.innerHTML = `×${mult}<span class="combo-sub">${count} HIT CHAIN</span>`;
    this.comboBadge.classList.toggle('hot', mult >= 3);
    this.comboBadge.classList.add('visible');
  }

  setSwingEnabled(on: boolean) {
    this.swingBtn.classList.toggle('disabled', !on);
    this.swingBtn.disabled = !on;
  }

  /** 'wait' = pitcher winding up (button dim), 'live' = pitch in the air (button hot). */
  setSwingState(state: 'wait' | 'live' | 'off') {
    this.swingBtn.classList.toggle('wait', state === 'wait');
    this.swingBtn.classList.toggle('live', state === 'live');
    this.swingBtn.innerHTML = state === 'wait' ? 'Swing<small>wait for it</small>' : state === 'live' ? 'Swing<small>now!</small>' : 'Swing<small>tap</small>';
  }

  /**
   * Rocket control. 'hidden' shows the swing button; 'armed' shows a dim DETONATE while the fuse burns; 'lit' makes it hot.
   * `charge` 0..1 drives the ring fill, `fuel` 0..1 the label.
   */
  setRocket(state: 'hidden' | 'armed' | 'lit', charge = 1, fuel = 1) {
    // Called every frame in flight: only touch the DOM when something visible changed.
    const key = `${state}:${Math.round(charge * 100)}:${Math.round(fuel * 20)}`;
    if (key === this.rocketKey) return;
    this.rocketKey = key;
    const show = state !== 'hidden';
    this.detonateBtn.style.display = show ? '' : 'none';
    this.swingBtn.style.display = show ? 'none' : '';
    this.detonateBtn.classList.toggle('lit', state === 'lit');
    this.detonateBtn.disabled = state !== 'lit';
    if (show) {
      this.detonateBtn.innerHTML = state === 'lit' ? `Detonate<small>${fuel > 0.02 ? 'burning' : 'coasting'} · ${Math.round(charge * 100)}%</small>` : 'Detonate<small>arming…</small>';
      // Ring: charge as the fill, no sweet zone.
      this.sweetArc.setAttribute('d', '');
      const a0 = -135;
      this.fillArc.setAttribute('stroke', state === 'lit' ? '#ff6b4a' : 'rgba(255,107,74,0.35)');
      this.fillArc.setAttribute('d', arcPath(66, 66, 60, a0, a0 + Math.max(0.01, charge) * 270));
      this.needle.style.display = 'none';
    } else {
      this.fillArc.setAttribute('stroke', '#ffd166');
    }
    this.rocketPill.classList.toggle('visible', state === 'lit');
    if (state === 'lit') this.rocketPill.textContent = fuel > 0.02 ? `ROCKET · FUEL ${Math.round(fuel * 100)}%` : 'ROCKET · COASTING';
  }

  hidePitch() {
    this.pitchPill.classList.remove('visible');
    this.pitchPillTimer = 0;
  }

  /** Pitch readout near the top; fades after a moment. */
  showPitch(label: string, mph: number) {
    this.pitchPill.textContent = `${label.toUpperCase()} · ${mph}`;
    this.pitchPill.classList.add('visible');
    this.pitchPillTimer = 1.4;
  }

  setHint(text: string | null) {
    this.aimHint.classList.toggle('hidden', !text);
    if (text) this.aimHint.textContent = text;
  }

  /**
   * Timing ring during a pitch: `progress` 0..1 of the flight (fills the arc), with the perfect window drawn as a green arc
   * around `sweet` (also 0..1). Null hides the needle.
   */
  setPitchProgress(progress: number | null, sweet: number, width: number) {
    this.setMeter(progress === null ? null : Math.min(1, progress), sweet, width);
  }

  /** value, sweet centre and width in 0..1 */
  setMeter(value: number | null, sweet: number, width: number) {
    const a0 = -135;
    const span = 270;
    const s0 = a0 + (sweet - width / 2) * span;
    const s1 = a0 + (sweet + width / 2) * span;
    this.sweetArc.setAttribute('d', arcPath(66, 66, 60, s0, s1));
    if (value === null) {
      this.needle.style.display = 'none';
      this.fillArc.setAttribute('d', '');
      return;
    }
    const a = a0 + value * span;
    this.fillArc.setAttribute('d', arcPath(66, 66, 60, a0, a));
    const rad = ((a - 90) * Math.PI) / 180;
    this.needle.setAttribute('cx', String(66 + Math.cos(rad) * 60));
    this.needle.setAttribute('cy', String(66 + Math.sin(rad) * 60));
    this.needle.style.display = '';
  }

  popup(x: number, y: number, line: ScoreLine) {
    if (this.popups > 12) return;
    const p = el('div', 'popup');
    if (line.material === 'glass') p.classList.add('glass');
    else if (line.material === 'hvac' || line.material === 'streetlight' || line.material === 'watertower' || line.material === 'antenna') p.classList.add('metal');
    if (line.kind === 'collapse') p.classList.add('collapse');
    else if (line.kind === 'detonation') p.classList.add('blast');
    else if (line.kind === 'structure') p.classList.add('structure');
    if (line.points >= 1500 || line.kind === 'collapse') p.classList.add('huge');
    else if (line.points >= 600) p.classList.add('big');
    p.innerHTML = `${line.label}${line.combo && line.combo > 1 ? ` ×${line.combo}` : ''}<span class="pts">+${line.points.toLocaleString()}</span>`;
    p.style.left = `${Math.max(60, Math.min(window.innerWidth - 60, x))}px`;
    p.style.top = `${Math.max(90, Math.min(window.innerHeight - 220, y))}px`;
    this.popupLayer.appendChild(p);
    this.popups++;
    p.addEventListener('animationend', () => {
      p.remove();
      this.popups--;
    });
  }

  showCallout(text: string, kind: 'default' | 'perfect' | 'record' = 'default') {
    this.callout.textContent = text;
    this.callout.className = `center-callout ${kind}`;
    void this.callout.offsetWidth;
    this.callout.classList.add('show');
  }

  flashScreen(opacity = 0.5) {
    this.flash.style.transition = 'none';
    this.flash.style.opacity = String(opacity);
    requestAnimationFrame(() => {
      this.flash.style.transition = 'opacity 260ms ease-out';
      this.flash.style.opacity = '0';
    });
  }

  showToast(text: string) {
    this.toast.textContent = text;
    this.toast.classList.add('visible');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toast.classList.remove('visible'), 1800);
  }

  showShotCard(shot: ShotSummary, total: number, remaining: number, isBestShot: boolean) {
    const lines = shot.lines.slice().sort((a, b) => b.points - a.points).slice(0, 5);
    const q = shot.quality.toLowerCase();
    this.shotCard.innerHTML = `
      <div class="head"><div class="big">+${shot.score.toLocaleString()}</div><div class="quality ${q}">${qualityLabel(shot.quality)} contact${isBestShot ? ' · BEST' : ''}</div></div>
      <div class="grid">
        <div class="cell"><b>${shot.sectionsDestroyed}</b><span>Sections</span></div>
        <div class="cell"><b>${shot.buildingsDamaged}</b><span>Buildings</span></div>
        <div class="cell${shot.buildingsCollapsed ? ' hot' : ''}"><b>${shot.buildingsCollapsed}</b><span>Collapsed</span></div>
        <div class="cell"><b>×${shot.bestCombo}</b><span>Combo</span></div>
      </div>
      ${shot.chainCollapses ? `<div class="chain-line">Chain reaction ×${shot.chainCollapses}</div>` : ''}
      <div class="lines">${lines.map((l) => `<span class="line${l.kind !== 'impact' ? ' gold' : ''}">${l.label} +${l.points.toLocaleString()}</span>`).join('')}</div>
      <div class="next">Round ${total.toLocaleString()} · ${remaining > 0 ? `${remaining} ball${remaining === 1 ? '' : 's'} left · tap to continue` : 'tap for results'}</div>`;
    this.shotCard.classList.add('visible');
  }

  hideShotCard() {
    this.shotCard.classList.remove('visible');
  }

  showResults(r: RoundSummary, profile: Profile, challengeName: string | null) {
    const stat = (label: string, value: string) => `<div class="stat"><span>${label}</span><b>${value}</b></div>`;
    this.results.innerHTML = `
      <div class="results-card">
        <h2>Round Complete</h2>
        <div class="total" id="results-total">${r.total.toLocaleString()}</div>
        <div class="total-label">Destruction score</div>
        ${r.isRecord ? '<div class="record">★ New personal record ★</div>' : `<div class="total-label">Best ${profile.bestScore.toLocaleString()}</div>`}
        <div class="stats">
          ${stat('Best shot', r.bestShot.toLocaleString())}
          ${stat('Best combo', `×${r.bestCombo}`)}
          ${stat('Demolished', String(r.buildingsCollapsed))}
          ${stat('Chain collapses', String(r.chainCollapses))}
          ${stat('Sections', String(r.sectionsDestroyed))}
          ${stat('Perfect', String(r.perfectContacts))}
          ${stat('Objects', String(r.objectsDamaged))}
          ${stat('Longest', `${r.longestDistance}m`)}
        </div>
        <div class="credits">+${r.creditsEarned.toLocaleString()} credits · ${profile.credits.toLocaleString()} total</div>
        ${r.challengeCompleted ? `<div class="challenge-done">Challenge complete: ${challengeName} · +${r.challengeReward} credits</div>` : ''}
      </div>
      <div class="results-actions">
        <button class="play-btn" id="play-again-btn">Play Again</button>
        <div class="title-row"><button class="ghost" id="results-garage-btn">Garage</button><button class="ghost" id="results-title-btn">Title</button></div>
      </div>`;
    this.results.querySelector('#play-again-btn')!.addEventListener('click', () => this.h.onPlayAgain());
    this.results.querySelector('#results-garage-btn')!.addEventListener('click', () => this.h.onGarage());
    this.results.querySelector('#results-title-btn')!.addEventListener('click', () => this.h.onBack());
  }

  renderGarage(profile: Profile) {
    const item = (kind: EquipKind, id: string, name: string, desc: string, cost: number, tags: { label: string; dir: string }[]) => {
      const owned = (kind === 'bat' ? profile.unlockedBats : kind === 'ball' ? profile.unlockedBalls : profile.unlockedRockets).includes(id);
      const equipped = (kind === 'bat' ? profile.equippedBat : kind === 'ball' ? profile.equippedBall : profile.equippedRocket) === id;
      const btn = equipped ? '<button class="equipped-btn" disabled>Equipped</button>' : owned ? `<button data-equip="${kind}:${id}">Equip</button>` : `<button class="${profile.credits >= cost ? '' : 'ghost'}" data-buy="${kind}:${id}">${cost.toLocaleString()} cr</button>`;
      return `<div class="item${equipped ? ' equipped' : ''}"><div class="name">${name}</div>${btn}<div class="desc">${desc}</div><div class="tags">${tags.map((t) => `<span class="tag ${t.dir}">${t.label}</span>`).join('')}</div></div>`;
    };
    this.garage.innerHTML = `
      <div class="panel">
        <h2>Garage <span class="cr">${profile.credits.toLocaleString()} cr</span></h2>
        <h3>Bats</h3>
        ${BATS.map((b) => item('bat', b.id, b.name, b.desc, b.cost, b.tags)).join('')}
        <h3>Balls</h3>
        ${BALLS.map((b) => item('ball', b.id, b.name, b.desc, b.cost, b.tags)).join('')}
        <h3>Rockets</h3>
        <div class="desc" style="opacity:.8;font-size:13px">Clean contact lights the fuse. Tap DETONATE in flight: outside for a wide blast, inside for structural damage.</div>
        ${ROCKETS.map((r) => item('rocket', r.id, r.name, r.desc, r.cost, r.tags)).join('')}
      </div>
      <div class="panel-actions"><button class="ghost" id="garage-back">Back</button><button id="garage-play">Play</button></div>`;
    this.garage.querySelectorAll<HTMLButtonElement>('[data-equip]').forEach((b) => b.addEventListener('click', () => {
      const [k, id] = b.dataset.equip!.split(':');
      this.h.onEquip(k as EquipKind, id);
    }));
    this.garage.querySelectorAll<HTMLButtonElement>('[data-buy]').forEach((b) => b.addEventListener('click', () => {
      const [k, id] = b.dataset.buy!.split(':');
      this.h.onBuy(k as EquipKind, id);
    }));
    this.garage.querySelector('#garage-back')!.addEventListener('click', () => this.h.onBack());
    this.garage.querySelector('#garage-play')!.addEventListener('click', () => this.h.onPlay());
  }

  renderChallenges(profile: Profile) {
    this.challenges.innerHTML = `
      <div class="panel">
        <h2>Challenges <span class="cr">${profile.credits.toLocaleString()} cr</span></h2>
        <div class="desc" style="opacity:.8;font-size:14px">Pick one to track this round. Complete it once for a credit bonus.</div>
        ${CHALLENGES.map((c) => {
          const done = profile.completedChallenges.includes(c.id);
          const active = profile.activeChallenge === c.id;
          const btn = done ? '<button class="equipped-btn" disabled>Done</button>' : active ? `<button class="equipped-btn" data-sel="">Tracking</button>` : `<button data-sel="${c.id}">Track</button>`;
          return `<div class="item${done ? ' done' : active ? ' equipped' : ''}"><div class="name">${c.name}</div>${btn}<div class="desc">${c.desc}</div><div class="tags"><span class="tag up">+${c.reward} cr</span></div></div>`;
        }).join('')}
      </div>
      <div class="panel-actions"><button class="ghost" id="ch-back">Back</button><button id="ch-play">Play</button></div>`;
    this.challenges.querySelectorAll<HTMLButtonElement>('[data-sel]').forEach((b) => b.addEventListener('click', () => this.h.onSelectChallenge(b.dataset.sel || null)));
    this.challenges.querySelector('#ch-back')!.addEventListener('click', () => this.h.onBack());
    this.challenges.querySelector('#ch-play')!.addEventListener('click', () => this.h.onPlay());
  }

  renderSettings(profile: Profile, persistent: boolean) {
    const row = (key: 'sound' | 'shake' | 'reducedMotion' | 'haptics' | 'slowmo', label: string) =>
      `<div class="settings-row"><span>${label}</span><button class="toggle${profile.settings[key] ? ' on' : ''}" data-set="${key}" aria-label="${label}"></button></div>`;
    this.settings.innerHTML = `
      <div class="panel">
        <h2>Settings</h2>
        ${row('sound', 'Sound')}
        ${row('shake', 'Camera shake')}
        ${row('slowmo', 'Slow motion')}
        ${row('reducedMotion', 'Reduce motion')}
        ${row('haptics', 'Haptics')}
        <div class="desc" style="opacity:.7;font-size:13px">${persistent ? 'Progress is saved on this device.' : 'Storage unavailable: progress will not be saved.'}</div>
        <div class="desc" style="opacity:.7;font-size:13px">Keyboard: ← → aim · ↑ ↓ loft · Space to swing · D to detonate.</div>
      </div>
      <div class="panel-actions"><button id="settings-back">Done</button></div>`;
    this.settings.querySelectorAll<HTMLButtonElement>('[data-set]').forEach((b) => b.addEventListener('click', () => this.h.onToggleSetting(b.dataset.set as 'sound')));
    this.settings.querySelector('#settings-back')!.addEventListener('click', () => this.h.onBack());
  }

  /** Animates the score counter toward its target. */
  tick(dt: number) {
    if (this.pitchPillTimer > 0) {
      this.pitchPillTimer -= dt;
      if (this.pitchPillTimer <= 0) this.pitchPill.classList.remove('visible');
    }
    if (this.displayedScore !== this.targetScore) {
      const diff = this.targetScore - this.displayedScore;
      const step = Math.sign(diff) * Math.max(1, Math.abs(diff) * Math.min(1, dt * 8));
      this.displayedScore = Math.abs(step) >= Math.abs(diff) ? this.targetScore : this.displayedScore + step;
      this.scoreValue.textContent = Math.round(this.displayedScore).toLocaleString();
    }
  }

  resetScoreDisplay() {
    this.displayedScore = 0;
    this.targetScore = 0;
    this.scoreValue.textContent = '0';
  }
}

export function qualityCallout(q: ContactQuality): string | null {
  switch (q) {
    case 'PERFECT':
      return 'PERFECT!';
    case 'SOLID':
      return 'SOLID';
    case 'POOR':
      return 'POOR';
    case 'WEAK':
      return 'WEAK';
    default:
      return 'WHIFF';
  }
}

function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  if (a1 <= a0) return '';
  const s = polar(cx, cy, r, a0);
  const e = polar(cx, cy, r, a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y}`;
}
function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + Math.cos(rad) * r, y: cy + Math.sin(rad) * r };
}
