import * as THREE from 'three';
import { Renderer, detectQuality } from '../engine/renderer';
import { GRAVITY, PhysicsWorld, RAPIER as R, loadRapier } from '../engine/physics';
import { CameraRig } from '../engine/camera';
import { AudioEngine } from '../engine/audio';
import { BlastFX, FragmentPool, ParticleSystem, RocketFlame, TrajectoryPreview } from '../engine/effects';
import { PropManager, type Prop } from '../world/props';
import { StaticRegistry } from '../world/statics';
import { buildCity, pickBonusTarget } from '../world/city';
import { buildRooftop, TEE_POS, type BatterRig } from '../world/rooftop';
import { buildPitcherMound, RELEASE_POS, DECK_BOX, type PitcherRig, type PitcherPhase } from '../world/pitcher';
import type { DestructibleCity, CollapseEvent, CellRef } from '../world/buildings';
import { Ball, SPIN_COLORS } from './Ball';
import { UI, qualityCallout } from '../ui/ui';
import { RoundManager, BALLS_PER_ROUND } from '../logic/round';
import { ShotScorer, creditsForRound, MATERIAL_LABEL, COMBO_GRACE } from '../logic/scoring';
import { computeLaunch, previewTrajectory, classifySpin, MAX_YAW, MIN_LOFT, MAX_LOFT } from '../logic/batting';
import { createPitch, evaluateSwing, pitcherLevel, SWING_DELAY, PERFECT_WINDOW, type Pitch, type PitchType } from '../logic/pitching';
import { RocketState } from '../logic/rocket';
import { getBat, getBall, getRocket } from '../logic/equipment';
import { ProfileStore } from '../logic/progression';
import { getChallenge } from '../logic/challenges';
import { createRng } from '../logic/rng';
import { impactCrater, type Structure, type DamageResult, type CellMaterial } from '../logic/structure';
import type { AimSettings, ContactResult, ScoreLine, MaterialKind, ImpactEvent } from '../logic/types';

const WINDUP_DURATION = 0.8;
const RELEASE_DURATION = 0.22;
const FOLLOW_DURATION = 0.6;
const TAKEN_GRACE = 0.62;
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _n = new THREE.Vector3(0, 0, 1);
const _col = new THREE.Color();

/** Test/debug hooks: when set, the game swings/detonates itself with the given timing (used by the Playwright suite). */
export interface DebugHooks {
  /** seconds relative to the perfect tap moment (0 = perfect, negative = early) */
  autoSwing: number | null;
  /** seconds after ignition to auto-detonate (null = let the player / fuse decide) */
  autoDetonate: number | null;
  /** render only every Nth frame (headless test environments without a GPU) */
  renderEvery: number;
  /** fixed simulation step per frame instead of wall-clock time (deterministic headless runs) */
  fixedDt: number | null;
  /** detonate the moment the lit rocket is inside a standing building's footprint */
  autoDetonateInside: boolean;
  /** seed the pitch generator at the next round start (deterministic test runs) */
  pitchSeed: number | null;
}

export interface BlastInfo {
  x: number;
  y: number;
  z: number;
  radius: number;
  power: number;
  sections: number;
  buildings: number;
  interior: boolean;
}

export class Game {
  renderer!: Renderer;
  physics!: PhysicsWorld;
  props!: PropManager;
  structures!: DestructibleCity;
  statics = new StaticRegistry();
  ball!: Ball;
  camera!: CameraRig;
  ui!: UI;
  audio = new AudioEngine();
  store = new ProfileStore();
  round = new RoundManager();
  fragments!: FragmentPool;
  particles!: ParticleSystem;
  preview!: TrajectoryPreview;
  flame!: RocketFlame;
  blastFx!: BlastFX;
  batter!: BatterRig;
  pitcher!: PitcherRig;
  aim: AimSettings = { yaw: 0, loft: 6, spin: { side: 0, lift: 0 } };
  wind = new THREE.Vector3();
  scorer: ShotScorer | null = null;
  contact: ContactResult | null = null;
  pitch: Pitch | null = null;
  rocket = new RocketState(getRocket('sparkler'));
  debug: DebugHooks = { autoSwing: null, autoDetonate: null, renderEvery: 1, fixedDt: null, autoDetonateInside: false, pitchSeed: null };
  /** the most recent detonation, for tests and tuning */
  lastBlast: BlastInfo | null = null;
  private frameIndex = 0;
  private swingTimer = -1;
  private swingTapTime = 0;
  private batterPhase: 'idle' | 'windup' | 'swing' | 'follow' = 'idle';
  private phaseTime = 0;
  private pitcherPhase: PitcherPhase = 'idle';
  private pitcherTime = 0;
  private pitchTimer = 0;
  private lastPitchType: PitchType | null = null;
  private pitchRng = createRng((Date.now() & 0xffff) ^ 0x5a5a);
  private timeScale = 1;
  private freezeUntil = 0;
  private slowmoTimer = 0;
  private simTime = 0;
  private resolveTimer = 0;
  private resultsTimer = 0;
  private lastFrame = 0;
  private paused = false;
  private rng = createRng(Date.now() & 0xffff);
  private roundBestShot = 0;
  private bigEventCooldown = 0;
  private returnState: 'TITLE' | 'AIMING' | 'ROUND_COMPLETE' = 'TITLE';
  private mediaReduced = false;
  private lastResultsAt = 0;
  private elapsed = 0;
  private titleSway = 0;
  private changed = new Set<Structure>();
  private lastWorldEvent = -Infinity;
  private unstableTimer = 0;
  private penetratedThisStep = false;
  private rocketIgnitedAt = -1;
  private slowRocketTimer = 0;
  private exhaustAcc = 0;
  private roundDemolished = 0;
  private deckSmashed = false;
  ready = false;

  constructor(private canvas: HTMLCanvasElement, private uiRoot: HTMLElement) {}

  async init(): Promise<void> {
    const quality = detectQuality();
    this.renderer = new Renderer(this.canvas, quality);
    await loadRapier();
    this.physics = new PhysicsWorld();
    const env = this.renderer.envMap;
    this.props = new PropManager(this.physics.world, env, quality);
    const city = buildCity(this.renderer.scene, this.physics.world, this.props, this.statics, env, quality.chunks, quality.rubble);
    this.structures = city.destructible;
    this.structures.onDust = (pos, material, count, speed) => this.particles.burst(pos, material as MaterialKind, count, speed);
    this.props.onDebrisSettle = (pos, quat, size, color) => this.structures.rubble.add(pos, quat, size, color, false);
    const roof = buildRooftop(this.renderer.scene, this.physics.world, this.statics, env);
    const mound = buildPitcherMound(this.renderer.scene, this.physics.world, this.statics, env);
    this.batter = roof.batter;
    this.pitcher = mound.pitcher;
    this.renderer.sun.target.position.set(0, 0, -120);
    this.ball = new Ball(this.physics.world, this.renderer.scene, getBall(this.store.profile.equippedBall), env);
    this.fragments = new FragmentPool(quality.fragments, env);
    this.particles = new ParticleSystem(quality.particles);
    this.preview = new TrajectoryPreview();
    this.flame = new RocketFlame();
    this.blastFx = new BlastFX(3);
    this.renderer.scene.add(this.fragments.mesh, this.particles.points, this.preview.mesh, this.preview.reticle, this.flame.group, this.blastFx.group);
    this.camera = new CameraRig(this.renderer.camera, [...city.collidable.filter((o) => o !== this.props.group), ...roof.collidable, ...mound.collidable]);
    this.camera.occluder = (o, d, far) => this.structures.rayHit(o, d, far);
    this.mediaReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    this.applySettings();
    this.ui = new UI(this.uiRoot, {
      onPlay: () => this.startRound(),
      onGarage: () => this.openGarage(),
      onChallenges: () => this.openChallenges(),
      onSettings: () => this.openSettings(),
      onBack: () => this.goBack(),
      onMute: () => this.toggleMute(),
      onSwing: () => this.swing(),
      onDetonate: () => this.detonate(),
      onContinue: () => this.continueShot(),
      onPlayAgain: () => this.startRound(),
      onEquip: (kind, id) => {
        this.audio.click();
        this.store.equip(kind, id);
        this.ui.renderGarage(this.store.profile);
      },
      onBuy: (kind, id) => {
        const spec = kind === 'bat' ? getBat(id) : kind === 'ball' ? getBall(id) : getRocket(id);
        if (this.store.tryUnlock(kind, id, spec.cost)) {
          this.store.equip(kind, id);
          this.audio.unlock_();
          this.ui.showToast(`${spec.name} unlocked`);
        } else {
          this.audio.click();
          this.ui.showToast(`Need ${(spec.cost - this.store.profile.credits).toLocaleString()} more credits`);
        }
        this.ui.renderGarage(this.store.profile);
      },
      onSelectChallenge: (id) => {
        this.audio.click();
        this.store.update((p) => (p.activeChallenge = id));
        this.ui.renderChallenges(this.store.profile);
      },
      onToggleSetting: (key) => {
        this.store.update((p) => (p.settings[key] = !p.settings[key]));
        this.applySettings();
        this.audio.click();
        this.ui.renderSettings(this.store.profile, this.store.persistent);
      },
      onLoft: (d) => this.adjustLoft(d),
      onSpin: (side) => (this.aim.spin.side = side),
      onLift: (lift) => (this.aim.spin.lift = lift),
      onAimDrag: (dx, dy) => this.aimDrag(dx, dy),
    });
    this.ui.setMuted(!this.store.profile.settings.sound);
    this.ui.setLoft(this.aim.loft);
    const unlock = () => this.audio.unlock();
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('touchend', unlock, { passive: true });
    window.addEventListener('click', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
    window.addEventListener('resize', () => this.renderer.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.renderer.resize(), 300));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.paused = true;
        this.audio.suspend();
        this.audio.rocketStop();
        if (this.round.state === 'PITCHING') this.cancelPitch();
      } else {
        this.paused = false;
        this.lastFrame = performance.now();
        this.audio.resume();
      }
    });
    // Block iOS Safari gestures.
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener(
      'touchmove',
      (e) => {
        // Allow scrolling inside menu panels; block page scrolling everywhere else.
        if ((e.target as HTMLElement | null)?.closest?.('.panel')) return;
        e.preventDefault();
      },
      { passive: false },
    );
    document.addEventListener('dblclick', (e) => e.preventDefault());

    this.showTitle();
    this.ui.hideLoading();
    this.ready = true;
    this.lastFrame = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  // ---------- Screens ----------

  private applySettings() {
    const s = this.store.profile.settings;
    this.audio.setMuted(!s.sound);
    this.camera.shakeEnabled = s.shake;
    this.camera.reducedMotion = s.reducedMotion || this.mediaReduced;
  }

  private get reducedMotion() {
    return this.store.profile.settings.reducedMotion || this.mediaReduced;
  }

  showTitle() {
    this.round.transition('TITLE');
    this.ui.setBest(this.store.profile);
    this.ui.showScreen('title');
    this.ui.hideShotCard();
    this.camera.setMode('aim');
    this.returnState = 'TITLE';
  }

  openGarage() {
    this.audio.click();
    this.returnState = this.round.state === 'ROUND_COMPLETE' ? 'ROUND_COMPLETE' : 'TITLE';
    if (!this.round.transition('GARAGE')) return;
    this.ui.renderGarage(this.store.profile);
    this.ui.showScreen('garage');
  }

  openChallenges() {
    this.audio.click();
    this.returnState = this.round.state === 'ROUND_COMPLETE' ? 'ROUND_COMPLETE' : 'TITLE';
    if (!this.round.transition('CHALLENGES')) return;
    this.ui.renderChallenges(this.store.profile);
    this.ui.showScreen('challenges');
  }

  openSettings() {
    this.audio.click();
    if (this.round.state === 'PITCHING') this.cancelPitch();
    this.returnState = this.round.state === 'AIMING' ? 'AIMING' : 'TITLE';
    if (!this.round.transition('SETTINGS')) return;
    this.ui.renderSettings(this.store.profile, this.store.persistent);
    this.ui.showScreen('settings');
  }

  goBack() {
    this.audio.click();
    if (this.returnState === 'AIMING') {
      this.round.transition('AIMING');
      this.ui.showScreen('hud');
      this.beginAiming();
    } else if (this.returnState === 'ROUND_COMPLETE') {
      this.round.transition('TITLE');
      this.showTitle();
    } else {
      this.showTitle();
    }
  }

  toggleMute() {
    this.audio.unlock();
    this.store.update((p) => (p.settings.sound = !p.settings.sound));
    this.applySettings();
    this.ui.setMuted(!this.store.profile.settings.sound);
    this.audio.click();
  }

  // ---------- Round flow ----------

  startRound() {
    this.audio.unlock();
    this.audio.click();
    this.audio.rocketStop();
    this.props.reset();
    this.structures.reset();
    this.fragments.clear();
    this.particles.clear();
    this.ball.setSpec(getBall(this.store.profile.equippedBall));
    this.ball.hideAtPitcher();
    this.rocket = new RocketState(getRocket(this.store.profile.equippedRocket));
    if (this.debug.pitchSeed !== null) this.pitchRng = createRng(this.debug.pitchSeed);
    this.scorer = null;
    this.contact = null;
    this.pitch = null;
    this.roundBestShot = 0;
    this.roundDemolished = 0;
    this.timeScale = 1;
    this.slowmoTimer = 0;
    this.changed.clear();
    this.lastWorldEvent = -Infinity;
    // Round variation: wind + a bonus target.
    const calm = this.rng.chance(0.3);
    const speed = calm ? 0 : this.rng.range(1.5, 6);
    const dirX = this.rng.chance(0.5) ? -1 : 1;
    this.wind.set(dirX * speed * 0.95, 0, speed * this.rng.range(-0.3, 0.3));
    this.ui.setWind(speed, dirX);
    const bonus = pickBonusTarget(this.props, this.rng);
    this.props.setBonus(bonus);
    this.ui.setBonus(bonus ? MATERIAL_LABEL[bonus.material] : null);
    this.round.startRound();
    this.ui.resetScoreDisplay();
    this.ui.setBalls(1, BALLS_PER_ROUND);
    this.ui.setCombo(1, 0);
    this.ui.hideShotCard();
    this.ui.showScreen('hud');
    this.updateChallengePill();
    this.camera.setMode('aim');
    this.beginAiming();
  }

  /** Between pitches: the pitcher gets set, the player can still drag to aim. */
  private beginAiming() {
    this.round.transition('AIMING');
    this.ball.hideAtPitcher();
    this.pitch = null;
    this.rocket.reset();
    this.flame.group.visible = false;
    this.ui.setRocket('hidden');
    this.ui.setSwingEnabled(true);
    this.ui.setSwingState('wait');
    this.ui.setHint(this.round.ballsUsed === 0 ? 'Drag to aim · Tap SWING as the pitch crosses the plate' : null);
    this.ui.setMeter(null, 1, 0);
    this.preview.setVisible(true);
    this.batterPhase = 'idle';
    this.phaseTime = 0;
    this.pitcherPhase = 'idle';
    this.pitcherTime = 0;
    this.pitchTimer = this.round.ballsUsed === 0 ? 1.8 : 1.1;
  }

  private cancelPitch() {
    if (this.round.state !== 'PITCHING') return;
    this.round.takePitch();
    this.ball.hideAtPitcher();
    this.pitch = null;
    this.pitcherPhase = 'idle';
    this.pitchTimer = 1.1;
    this.ui.setSwingState('wait');
    this.ui.setMeter(null, 1, 0);
  }

  private throwPitch() {
    const level = pitcherLevel(this.store.profile.roundsPlayed);
    const pitch = createPitch(this.pitchRng, { release: { x: RELEASE_POS.x, y: RELEASE_POS.y, z: RELEASE_POS.z }, plate: { x: TEE_POS.x, y: TEE_POS.y, z: TEE_POS.z }, gravity: GRAVITY, level }, undefined, this.lastPitchType);
    this.lastPitchType = pitch.type;
    this.pitch = pitch;
    this.ball.startPitch(pitch);
    this.round.transition('PITCHING');
    this.ui.setSwingState('live');
    this.ui.showPitch(pitch.label, pitch.mph);
    this.audio.pitchRelease();
    this.batterPhase = 'windup';
    this.phaseTime = 0;
  }

  /** SWING tap: swing at a live pitch, or detonate if that is what is available. */
  swing() {
    if (this.round.state === 'PITCHING' && this.pitch) {
      this.audio.unlock();
      const bat = getBat(this.store.profile.equippedBat);
      this.swingTapTime = this.ball.pitchTime;
      this.contact = evaluateSwing(this.swingTapTime, this.pitch, bat);
      if (!this.round.commitSwing()) return;
      this.ui.setSwingEnabled(false);
      this.ui.setSwingState('off');
      this.ui.setHint(null);
      this.ui.hidePitch();
      this.batterPhase = 'swing';
      this.phaseTime = 0;
      this.swingTimer = SWING_DELAY;
      this.audio.whoosh();
      return;
    }
    if (this.rocket.canDetonate) this.detonate();
  }

  private doContact() {
    const contact = this.contact!;
    const pitch = this.pitch!;
    const bat = getBat(this.store.profile.equippedBat);
    const ballSpec = getBall(this.store.profile.equippedBall);
    this.scorer = new ShotScorer({ impactMultiplier: bat.impact * ballSpec.impact });
    this.deckSmashed = false;
    this.round.transition('BALL_IN_FLIGHT');
    this.simTime = 0;
    this.lastWorldEvent = -Infinity;
    this.preview.setVisible(false);
    this.audio.batContact(contact.quality);
    const q = contact.quality;
    if (q === 'MISS') {
      // Whiff: the pitch sails on into the cage.
      this.ball.passPlate();
      this.ui.showCallout('WHIFF', 'default');
      this.camera.setMode('flight');
      return;
    }
    const launch = computeLaunch({
      aim: this.aim,
      contact,
      bat,
      ball: ballSpec,
      jitter: this.rng.next(),
      pitch: { speed: pitch.speed, offsetX: this.ball.pos.x - TEE_POS.x, offsetY: this.ball.pos.y - TEE_POS.y },
    });
    this.ball.launch(new THREE.Vector3(launch.velocity.x, launch.velocity.y, launch.velocity.z), new THREE.Vector3(launch.spin.x, launch.spin.y, launch.spin.z));
    const power = contact.power;
    this.camera.kick(0.25 + power * 0.5);
    this.camera.punch(new THREE.Vector3(0, 0.3, 1), 0.35 * power);
    this.freezeUntil = performance.now() + (q === 'PERFECT' ? 90 : 60);
    this.haptic(q === 'PERFECT' ? 40 : 20);
    const callout = qualityCallout(q);
    if (callout) this.ui.showCallout(callout, q === 'PERFECT' ? 'perfect' : 'default');
    if (q === 'PERFECT' && !this.reducedMotion) this.ui.flashScreen(0.45);
    // Contact sparks coloured by the spin the ball leaves with.
    _col.setHex(SPIN_COLORS[classifySpin(launch.spin)]);
    this.particles.burstColor(this.ball.pos, _col, 14, 9, undefined, 0.8, [0.2, 0.5], 4, 0.2);
    if (this.rocket.arm(q)) {
      this.ui.setRocket('armed');
      this.audio.armClick();
    }
    this.camera.setMode('flight');
  }

  /** DETONATE tap (or self-destruct): radial blast against structures and props at the ball's position. */
  detonate(): boolean {
    if (!this.rocket.canDetonate || !this.ball.active) return false;
    this.rocket.detonate();
    const pos = this.ball.pos.clone();
    const radius = this.rocket.blastRadius();
    const power = this.rocket.blastPower();
    const now = this.simTime;
    this.ball.consume();
    this.flame.group.visible = false;
    this.ui.setRocket('hidden');
    // Structures.
    const blast = this.structures.blast(pos.x, pos.y, pos.z, radius, power);
    let sections = 0;
    for (const r of blast.results) {
      const line = this.scorer?.structureHit(r.cell.building, r.cell.id, r.cell.material, r.broke ? 'broken' : 'cracked', true, now, { x: r.cell.x, y: r.cell.y, z: r.cell.z }) ?? null;
      if (r.broke) sections++;
      if (line && (r.broke || sections < 4)) this.popupAt(_v.set(r.cell.x, r.cell.y, r.cell.z), line);
    }
    for (const s of blast.structures) this.changed.add(s);
    // Props: shove everything in range away from the blast.
    for (const prop of this.props.props) {
      if (prop.removed) continue;
      const t = prop.body.translation();
      const d = Math.hypot(t.x - pos.x, t.y - pos.y, t.z - pos.z);
      if (d > radius) continue;
      const k = 1 - d / radius;
      _v.set(t.x - pos.x, t.y - pos.y + 2, t.z - pos.z).normalize().multiplyScalar(k * power * 9);
      const speed = k * power * 0.9;
      const outcome = this.props.applyHit(prop, speed, _v, _v2.set(t.x, t.y, t.z), true);
      if (outcome.effect === 'shatter') this.fragments.burst(new THREE.Vector3(t.x, t.y, t.z), _n, _v, 12, prop.size.x, prop.size.y);
      const ev: ImpactEvent = { objectId: prop.id, material: prop.material, speed, direct: true, destroyed: outcome.destroyed, time: now, position: { x: t.x, y: t.y, z: t.z }, bonusTarget: prop.bonus };
      const line = this.scorer?.impact(ev) ?? null;
      this.feedback(line, prop.material, speed, outcome.destroyed, _v2.set(t.x, t.y, t.z), true);
      if (outcome.destroyed && prop.bonus) this.props.setBonus(null);
    }
    this.lastBlast = { x: pos.x, y: pos.y, z: pos.z, radius, power, sections, buildings: blast.structures.size, interior: blast.interior !== null };
    const detLine = this.scorer?.detonation(sections, blast.structures.size, blast.interior !== null, now, { x: pos.x, y: pos.y, z: pos.z }) ?? null;
    if (detLine) this.popupAt(pos, detLine, true);
    if (blast.interior) this.ui.showCallout('INTERIOR BLAST!', 'record');
    else if (blast.structures.size >= 2) this.ui.showCallout('MULTI-STRIKE!');
    // FX.
    this.blastFx.spawn(pos, radius);
    _col.setHex(0xffb060);
    this.particles.burstColor(pos, _col, 40, 22, undefined, 1.6, [0.3, 0.8], 2, 1);
    _col.setHex(0x6b6560);
    this.particles.burstColor(pos, _col, 60, 12, undefined, 3.2, [1.2, 2.6], -0.6, 2.5);
    this.props.spawnDebris(pos, _v.set(0, 8, 0), 8);
    this.camera.kick(1.1);
    this.camera.punch(new THREE.Vector3(0, 0.4, 0.6), 0.6);
    this.camera.impactMoment(1.3);
    this.camera.setOverview(pos);
    this.camera.focus(pos, 1.6, 0.6);
    this.freezeUntil = performance.now() + 70;
    if (!this.reducedMotion) this.ui.flashScreen(0.6);
    if (this.store.profile.settings.slowmo && !this.reducedMotion) this.slowmoTimer = 0.5;
    this.haptic(60);
    this.audio.explosion(Math.min(1, radius / 22));
    this.lastWorldEvent = now;
    this.settleWorld();
    return true;
  }

  private continueShot() {
    if (this.round.state !== 'SHOT_RESULTS') return;
    if (performance.now() - this.lastResultsAt < 500) return;
    const next = this.round.nextBall();
    if (next === 'READY') {
      this.ui.hideShotCard();
      this.ui.setBalls(this.round.currentBall, BALLS_PER_ROUND);
      this.ui.setCombo(1, 0);
      this.camera.setMode('aim');
      this.beginAiming();
    } else if (next === 'ROUND_COMPLETE') {
      this.endRound();
    }
  }

  private finishShot() {
    if (!this.scorer || !this.contact) return;
    const summary = this.scorer.finish(this.ball.maxDistance, this.contact.quality);
    if (!this.round.recordShot(summary)) return;
    this.scorer = null;
    this.audio.rocketStop();
    this.lastResultsAt = performance.now();
    this.resultsTimer = 0;
    const isBest = summary.score > this.store.profile.bestShot && summary.score > 0;
    if (summary.score > this.roundBestShot) this.roundBestShot = summary.score;
    if (isBest) {
      this.store.update((p) => (p.bestShot = summary.score));
      this.ui.showCallout('NEW BEST SHOT!', 'record');
      this.audio.record();
    }
    this.ui.setScore(this.round.total);
    this.ui.setCombo(1, 0);
    this.ui.setRocket('hidden');
    this.ui.showShotCard(summary, this.round.total, this.round.ballsRemaining, isBest);
    this.updateChallengePill();
    this.ball.trail.clear();
  }

  private endRound() {
    const p = this.store.profile;
    const previousBest = p.bestScore;
    const bestCombo = Math.max(1, ...this.round.shots.map((s) => s.bestCombo));
    const perfect = this.round.shots.filter((s) => s.quality === 'PERFECT').length;
    const collapsed = this.round.shots.reduce((a, s) => a + s.buildingsCollapsed, 0);
    const credits = creditsForRound(this.round.total, bestCombo, perfect, collapsed);
    const challenge = getChallenge(p.activeChallenge);
    let completed: string | null = null;
    let reward = 0;
    const prelim = this.round.summarize(previousBest, credits, null, 0);
    if (challenge && !p.completedChallenges.includes(challenge.id) && challenge.check(prelim)) {
      completed = challenge.id;
      reward = challenge.reward;
    }
    const record = this.store.applyRound(this.round.total, prelim.bestShot, bestCombo, prelim.longestDistance, credits, this.roundDemolished);
    if (completed) this.store.completeChallenge(completed, reward);
    const summary = this.round.summarize(previousBest, credits, completed, reward);
    this.ui.hideShotCard();
    this.ui.showResults(summary, this.store.profile, challenge?.name ?? null);
    this.ui.showScreen('results');
    this.camera.setMode('results');
    if (record && this.round.total > 0) this.audio.record();
    else this.audio.fanfare();
    this.returnState = 'ROUND_COMPLETE';
  }

  private updateChallengePill() {
    const c = getChallenge(this.store.profile.activeChallenge);
    if (!c || this.store.profile.completedChallenges.includes(c.id)) {
      this.ui.setChallengeProgress(null);
      return;
    }
    this.ui.setChallengeProgress(`${c.name}: ${c.progress(this.round.shots)}`);
  }

  // ---------- Input ----------

  private aimDrag(dx: number, dy: number) {
    if (this.round.state !== 'AIMING' && this.round.state !== 'PITCHING') return;
    this.aim.yaw = THREE.MathUtils.clamp(this.aim.yaw + dx * 1.7, -MAX_YAW, MAX_YAW);
    this.aim.loft = THREE.MathUtils.clamp(this.aim.loft - dy * 55, MIN_LOFT, MAX_LOFT);
    this.ui.setLoft(this.aim.loft);
  }

  private adjustLoft(d: number) {
    this.aim.loft = THREE.MathUtils.clamp(this.aim.loft + d, MIN_LOFT, MAX_LOFT);
    this.ui.setLoft(this.aim.loft);
    this.audio.click();
  }

  private haptic(ms: number) {
    if (!this.store.profile.settings.haptics) return;
    try {
      navigator.vibrate?.(ms);
    } catch {
      /* unsupported */
    }
  }

  // ---------- Collision processing ----------

  private processCollisions() {
    const ballHandle = this.ball.collider.handle;
    this.penetratedThisStep = false;
    for (const pair of this.physics.started) {
      const isBallA = pair.a === ballHandle;
      const isBallB = pair.b === ballHandle;
      if (isBallA || isBallB) {
        this.ballHit(isBallA ? pair.b : pair.a);
        continue;
      }
      const chunkA = this.structures.chunkByCollider.get(pair.a);
      const chunkB = this.structures.chunkByCollider.get(pair.b);
      if (chunkA || chunkB) {
        this.chunkPair(chunkA ? chunkA : chunkB!, chunkA ? pair.b : pair.a);
        continue;
      }
      this.propPair(pair.a, pair.b);
    }
    if (this.changed.size) this.settleWorld();
  }

  private ballHit(other: number) {
    const prev = this.ball.prevVel;
    const now = this.simTime;
    if (!this.ball.active) return;
    // Destructible building section.
    const cellRef = this.structures.byCollider.get(other);
    if (cellRef) {
      this.ballHitCell(other, cellRef);
      return;
    }
    const prop = this.props.byCollider.get(other);
    if (prop) {
      _v.copy(prev).sub(prop.prevVel);
      const rel = _v.length();
      const impulse = _v2.copy(prev).multiplyScalar(this.ball.mass * (this.rocket.lit ? 3.2 : 1.8));
      const outcome = this.props.applyHit(prop, rel * (this.rocket.lit ? 1.5 : 1), impulse, this.ball.pos, true);
      if (outcome.effect === 'shatter') {
        this.ball.setVelocity(_v.copy(prev).multiplyScalar(0.74));
        const t = prop.body.translation();
        this.fragments.burst(new THREE.Vector3(t.x, t.y, t.z), _n, prev, 16, prop.size.x, prop.size.y);
      }
      const ev: ImpactEvent = { objectId: prop.id, material: prop.material, speed: rel, direct: true, destroyed: outcome.destroyed, time: now, position: { x: this.ball.pos.x, y: this.ball.pos.y, z: this.ball.pos.z }, bonusTarget: prop.bonus };
      const line = this.scorer?.impact(ev) ?? null;
      this.feedback(line, prop.material, rel, outcome.destroyed, this.ball.pos, true);
      if (outcome.destroyed && prop.bonus) this.props.setBonus(null);
      return;
    }
    const st = this.statics.byCollider.get(other);
    if (st) {
      const speed = prev.length();
      let material: MaterialKind = st.material;
      if (material === 'concrete' && this.ball.pos.y > st.top - 0.9) material = 'roof';
      const ev: ImpactEvent = { objectId: st.id, material, speed, direct: true, destroyed: false, time: now, position: { x: this.ball.pos.x, y: this.ball.pos.y, z: this.ball.pos.z } };
      const line = this.scorer?.impact(ev) ?? null;
      if (speed > 4) this.feedback(line, material, speed, false, this.ball.pos, true);
      // A lit rocket that slams into solid scenery goes off.
      if (this.rocket.lit && speed > 12) this.detonate();
    }
  }

  private ballHitCell(handle: number, ref: CellRef) {
    const prev = this.ball.prevVel;
    const speed = prev.length();
    const lit = this.rocket.lit;
    const penetrator = lit ? this.rocket.spec.penetration : 1;
    // The crater (how big a chunk comes out) is set by the quality of contact, the ball's speed and its mass.
    const quality = this.contact?.quality ?? 'POOR';
    const crater = impactCrater(quality, speed, this.ball.mass, penetrator);
    _v3.copy(prev);
    if (_v3.lengthSq() > 1e-6) _v3.normalize();
    const res = this.structures.projectileHit(handle, crater, lit ? 'rocket' : 'ball', this.ball.pos, _v3, speed);
    if (!res) return;
    const now = this.simTime;
    const cell = ref.cell;
    this.changed.add(ref.structure);
    for (const r of res.craterResults) this.changed.add(this.structures.structures[r.cell.building]);
    this.lastWorldEvent = now;
    const main = res.result;
    let popups = 0;
    let brokenCount = main.broke ? 1 : 0;
    if (main.broke || main.cracked) {
      const line = this.scorer?.structureHit(cell.building, cell.id, cell.material, main.broke ? 'broken' : 'cracked', true, now, { x: cell.x, y: cell.y, z: cell.z }) ?? null;
      this.cellFeedback(ref, main, speed, line, true, true);
      popups++;
    } else if (speed > 6) {
      this.particles.burst(this.ball.pos, cell.material as MaterialKind, 5, 4);
      this.audio.impact(cell.material as MaterialKind, speed, false);
    }
    for (const r of res.craterResults) {
      if (r.broke) brokenCount++;
      const line = this.scorer?.structureHit(r.cell.building, r.cell.id, r.cell.material, r.broke ? 'broken' : 'cracked', true, now, { x: r.cell.x, y: r.cell.y, z: r.cell.z }) ?? null;
      this.cellFeedback({ structure: this.structures.structures[r.cell.building], cell: r.cell }, r, speed * 0.7, line, true, popups < 3);
      if (line) popups++;
    }
    if (brokenCount >= 5) {
      // A big bite out of the building: a beat of weight on the hit.
      this.camera.kick(Math.min(0.9, 0.3 + brokenCount * 0.05));
      this.freezeUntil = Math.max(this.freezeUntil, performance.now() + Math.min(90, 30 + brokenCount * 5));
      this.haptic(Math.min(45, 15 + brokenCount * 2));
      if (brokenCount >= 8 && this.bigEventCooldown <= 0) {
        this.ui.showCallout(brokenCount >= 14 ? 'HUGE CHUNK!' : 'CHUNK!', quality === 'PERFECT' ? 'perfect' : 'default');
        this.bigEventCooldown = 0.8;
      }
    }
    if (lit) this.rocket.penetrate(res.hpBefore, res.damage, main.broke);
    if (main.broke && res.retention > 0 && !this.penetratedThisStep) {
      // Punch through: keep flying in the same direction, slower.
      this.penetratedThisStep = true;
      this.ball.setVelocity(_v.copy(prev).multiplyScalar(res.retention));
      this.camera.kick(lit ? 0.45 : 0.3);
      if (lit) {
        this.freezeUntil = Math.max(this.freezeUntil, performance.now() + 35);
        this.haptic(15);
      }
    } else if (!main.broke) {
      this.camera.kick(Math.min(0.5, speed / 100));
      if (lit) {
        // A rocket that fails to breach a wall goes off against it.
        this.detonate();
      }
    }
  }

  private chunkPair(chunk: import('../world/buildings').Chunk, other: number) {
    const cellRef = this.structures.byCollider.get(other);
    const now = this.simTime;
    if (cellRef) {
      const hit = this.structures.chunkHitCell(chunk, other);
      if (!hit) return;
      this.changed.add(hit.ref.structure);
      const r = hit.result;
      if (r.broke || r.cracked) this.lastWorldEvent = now;
      if (r.broke || r.cracked) {
        const c = r.cell;
        const line = this.scorer?.structureHit(c.building, c.id, c.material, r.broke ? 'broken' : 'cracked', false, now, { x: c.x, y: c.y, z: c.z }) ?? null;
        this.cellFeedback(hit.ref, r, chunk.prevVel.length(), line, false);
      }
      return;
    }
    const prop = this.props.byCollider.get(other);
    if (prop) {
      const rel = chunk.prevVel.length();
      if (rel < 4) return;
      const t = prop.body.translation();
      _v.set(t.x, t.y, t.z);
      const impulse = _v2.copy(chunk.prevVel).multiplyScalar(chunk.massEq * 0.6);
      const outcome = this.props.applyHit(prop, rel, impulse, _v, false);
      if (outcome.effect === 'shatter') this.fragments.burst(_v.clone(), _n, chunk.prevVel, 10, prop.size.x, prop.size.y);
      const ev: ImpactEvent = { objectId: prop.id, material: prop.material, speed: rel, direct: false, destroyed: outcome.destroyed, time: now, position: { x: _v.x, y: _v.y, z: _v.z }, bonusTarget: prop.bonus };
      const line = this.scorer?.impact(ev, `chunk>${prop.id}`) ?? null;
      this.feedback(line, prop.material, rel, outcome.destroyed, _v, false);
      if (outcome.destroyed && prop.bonus) this.props.setBonus(null);
      this.lastWorldEvent = now;
      return;
    }
    // Chunk vs ground/static or another chunk: dust and a thud (does not keep the shot alive).
    const rel = chunk.prevVel.length();
    if (rel > 7) {
      const t = chunk.body.translation();
      _v.set(t.x, t.y - chunk.size.y * 0.5, t.z);
      this.particles.burst(_v, 'rubble', Math.min(24, 6 + rel), Math.min(12, 3 + rel * 0.3));
      this.audio.rubble(rel);
      if (rel > 14) this.camera.kick(Math.min(0.35, rel / 80));
    }
  }

  private propPair(a: number, b: number) {
    const pa = this.props.byCollider.get(a);
    const pb = this.props.byCollider.get(b);
    if (!pa && !pb) return;
    const va = pa ? pa.prevVel : _v.set(0, 0, 0);
    const vb = pb ? pb.prevVel : _v2.set(0, 0, 0);
    const rel = Math.hypot(va.x - vb.x, va.y - vb.y, va.z - vb.z);
    if (rel < 3) return;
    if (pa && pb) {
      const key = pa.id < pb.id ? `${pa.id}|${pb.id}` : `${pb.id}|${pa.id}`;
      this.secondary(pa, pb, rel, key);
      this.secondary(pb, pa, rel, key);
      return;
    }
    // Prop vs destructible cell: a falling water tower or car can break walls.
    const prop = (pa ?? pb)!;
    const cellHandle = pa ? b : a;
    const cellRef = this.structures.byCollider.get(cellHandle);
    if (cellRef && prop.body.bodyType() === R.RigidBodyType.Dynamic) {
      const hit = this.structures.propHitCell(cellHandle, rel, prop.body.mass());
      if (hit) {
        this.changed.add(hit.ref.structure);
        this.lastWorldEvent = this.simTime;
        const r = hit.result;
        if (r.broke || r.cracked) {
          const c = r.cell;
          const line = this.scorer?.structureHit(c.building, c.id, c.material, r.broke ? 'broken' : 'cracked', false, this.simTime, { x: c.x, y: c.y, z: c.z }) ?? null;
          this.cellFeedback(hit.ref, r, rel, line, false);
        }
      }
      return;
    }
    // Prop vs building/ground: a falling object landing. Effects only.
    if (rel > 9 && this.scorer) {
      const t = prop.body.translation();
      _v.set(t.x, t.y, t.z);
      this.particles.burst(_v, 'concrete', 8, 5);
      this.audio.impact(prop.material === 'glass' ? 'glass' : 'concrete', rel, false);
    }
  }

  private secondary(struck: Prop, mover: Prop, rel: number, key: string) {
    if (mover.body.bodyType() !== R.RigidBodyType.Dynamic || mover.prevVel.lengthSq() < 4) return;
    const t = struck.body.translation();
    _v.set(t.x, t.y, t.z);
    const impulse = _v2.copy(mover.prevVel).multiplyScalar(mover.body.mass() * 0.3);
    const outcome = this.props.applyHit(struck, rel, impulse, _v, false);
    if (outcome.effect === 'shatter') this.fragments.burst(_v.clone(), _n, mover.prevVel, 10, struck.size.x, struck.size.y);
    const ev: ImpactEvent = { objectId: struck.id, material: struck.material, speed: rel, direct: false, destroyed: outcome.destroyed, time: this.simTime, position: { x: _v.x, y: _v.y, z: _v.z }, bonusTarget: struck.bonus };
    const line = this.scorer?.impact(ev, `${key}>${struck.id}`) ?? null;
    this.feedback(line, struck.material, rel, outcome.destroyed, _v, false);
    if (outcome.destroyed && struck.bonus) this.props.setBonus(null);
  }

  /** Section damage feedback: dust/shards by material, sound, popup, score HUD. */
  private cellFeedback(_ref: CellRef, r: DamageResult, speed: number, line: ScoreLine | null, direct: boolean, showPopup = true) {
    const c = r.cell;
    _v3.set(c.x, c.y, c.z);
    const mat = c.material as MaterialKind;
    if (r.broke) {
      if (c.material === 'glass') this.fragments.burst(_v3.clone(), _n, _v2.set(c.nx * speed * 0.3, 0, c.nz * speed * 0.3), 14, c.sx, c.sy);
      else this.props.spawnDebris(_v3, _v2.set(c.nx * speed * 0.4, 2, c.nz * speed * 0.4), c.kind === 'slab' ? 1 : 2);
      this.particles.burst(_v3, mat, c.material === 'glass' ? 10 : 16, Math.min(14, 4 + speed * 0.2));
      this.audio.impact(mat, speed, true);
    } else {
      this.particles.burst(_v3, mat, 6, Math.min(10, 3 + speed * 0.15));
      this.audio.impact(mat, speed, false);
    }
    if (direct) this.camera.kick(Math.min(0.4, speed / 150) + (r.broke ? 0.12 : 0));
    if (!line) return;
    if (showPopup) this.popupAt(_v3, line);
    this.bumpScore(line, mat, r.broke);
  }

  private popupAt(pos: THREE.Vector3, line: ScoreLine, force = false) {
    if (!force && line.points < 40) return;
    const sp = this.project(pos);
    this.ui.popup(sp.x, sp.y, line);
  }

  private bumpScore(line: ScoreLine, material: MaterialKind, destroyed: boolean) {
    if (!this.scorer) return;
    this.ui.setScore(this.round.total + this.scorer.score);
    this.ui.setCombo(this.scorer.combo, this.scorer.chainCount);
    if (this.scorer.chainIndex >= 1 && destroyed) this.audio.combo(this.scorer.chainIndex);
    const big = line.points >= 900 || line.kind === 'collapse' || (destroyed && (material === 'billboard' || material === 'watertower' || material === 'car' || material === 'column')) || this.scorer.combo >= 3.5;
    if (big && this.bigEventCooldown <= 0) {
      this.bigEventCooldown = 1.2;
      this.camera.impactMoment(0.9);
      this.camera.kick(0.5);
      this.audio.bigEvent();
      this.haptic(30);
      if (this.store.profile.settings.slowmo && !this.reducedMotion) this.slowmoTimer = 0.45;
      if (line.kind !== 'collapse') {
        if (line.points >= 1500) this.ui.showCallout('DEMOLITION!', 'record');
        else if (this.scorer.combo >= 3.5) this.ui.showCallout('CHAIN REACTION!');
      }
    }
  }

  private feedback(line: ScoreLine | null, material: MaterialKind, speed: number, destroyed: boolean, pos: THREE.Vector3, direct: boolean) {
    const count = material === 'glass' ? 14 : destroyed ? 18 : 8;
    this.particles.burst(pos, material, count, Math.min(14, 3 + speed * 0.25));
    if (this.scorer) this.audio.impact(material, speed, destroyed);
    if (direct) this.camera.kick(Math.min(0.5, speed / 120) + (destroyed ? 0.2 : 0));
    if (!line) return;
    this.popupAt(pos, line, true);
    this.bumpScore(line, material, destroyed);
  }

  /** Re-evaluates damaged structures; turns failures into collapses with debris, scoring and spectacle. */
  private settleWorld() {
    if (!this.changed.size) return;
    const events = this.structures.settle(this.changed);
    this.changed.clear();
    for (const ev of events) this.onCollapse(ev);
  }

  private onCollapse(ev: CollapseEvent) {
    const s = ev.structure;
    const c = ev.collapse;
    const now = this.simTime;
    this.lastWorldEvent = now;
    if (c.total) this.roundDemolished++;
    const top = _v.set(s.spec.x, c.y + Math.min(20, c.floorsDropped * s.floorHeight * 0.5), s.spec.z);
    const line = this.scorer?.collapse(s.spec.id, c.floorsDropped, c.total, ev.chain, now, { x: top.x, y: top.y, z: top.z }) ?? null;
    if (line) {
      this.popupAt(top, line, true);
      this.bumpScore(line, 'concrete', true);
    }
    this.ui.showCallout(ev.chain ? 'CHAIN COLLAPSE!' : c.total ? 'DEMOLISHED!' : 'COLLAPSE!', 'record');
    // Props riding the collapsed floors fall with them.
    const fp = this.structures.footprint(s);
    for (const prop of this.props.propsInBox(fp.minX - 2, fp.maxX + 2, fp.minZ - 2, fp.maxZ + 2, c.y - 1)) {
      this.props.detach(prop, _v2.set(c.lean.x * 3 + (this.rng.next() - 0.5) * 2, 1.5, c.lean.z * 3 + (this.rng.next() - 0.5) * 2));
    }
    // Spectacle: proportional to the mass coming down.
    const size = Math.min(1, 0.35 + c.floorsDropped * 0.07);
    this.camera.kick(0.6 + size * 0.6);
    this.camera.impactMoment(1.4 + size);
    this.camera.focus(top, 2.2 + size, 0.7);
    this.audio.collapse(c.floorsDropped);
    this.haptic(50 + Math.round(size * 60));
    if (this.store.profile.settings.slowmo && !this.reducedMotion) this.slowmoTimer = 0.5 + size * 0.5;
    if (!this.reducedMotion) this.ui.flashScreen(0.25);
    _col.setHex(0x8d8578);
    this.particles.burstColor(top.clone().setY(c.y + 1), _col, 50, 10, undefined, 3.4, [1.5, 3], -0.4, Math.min(s.spec.w, s.spec.d) * 0.4);
  }

  private project(pos: THREE.Vector3): { x: number; y: number } {
    _v2.copy(pos).project(this.renderer.camera);
    return { x: (_v2.x * 0.5 + 0.5) * window.innerWidth, y: (-_v2.y * 0.5 + 0.5) * window.innerHeight };
  }

  // ---------- Main loop ----------

  private frame(now: number) {
    requestAnimationFrame((t) => this.frame(t));
    if (this.paused) return;
    const start = performance.now();
    let dt = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    if (!Number.isFinite(dt) || dt < 0) dt = 0;
    if (this.debug.fixedDt !== null) dt = this.debug.fixedDt;
    this.frameIndex++;
    this.elapsed += dt;
    const frozen = now < this.freezeUntil;
    // Time scale (slow motion) ramps.
    const targetScale = this.slowmoTimer > 0 ? 0.28 : 1;
    this.timeScale += (targetScale - this.timeScale) * Math.min(1, dt * 10);
    if (this.slowmoTimer > 0) this.slowmoTimer -= dt;
    if (this.bigEventCooldown > 0) this.bigEventCooldown -= dt;
    const simDt = frozen ? 0 : dt * this.timeScale;
    this.update(dt, simDt);
    this.renderer.update(dt, this.elapsed);
    if (this.debug.renderEvery <= 1 || this.frameIndex % this.debug.renderEvery === 0) {
      this.renderer.render();
      this.renderer.recordFrame(performance.now() - start);
    }
  }

  private updateActors(dt: number) {
    // Batter animation.
    this.phaseTime += dt;
    if (this.batterPhase === 'swing' && this.phaseTime > 0.16) {
      this.batterPhase = 'follow';
      this.phaseTime = 0;
    } else if (this.batterPhase === 'follow' && this.phaseTime > 0.5) {
      this.batterPhase = 'idle';
      this.phaseTime = 0;
    }
    const phaseDur = this.batterPhase === 'swing' ? 0.16 : this.batterPhase === 'follow' ? 0.5 : this.batterPhase === 'windup' ? 0.6 : 3;
    this.batter.setPhase(this.batterPhase, this.batterPhase === 'idle' ? (this.elapsed % 3) / 3 : Math.min(1, this.phaseTime / phaseDur));
    this.batter.setAimYaw(this.aim.yaw);
    // Pitcher animation.
    this.pitcherTime += dt;
    if (this.pitcherPhase === 'windup' && this.pitcherTime >= WINDUP_DURATION) {
      this.pitcherPhase = 'release';
      this.pitcherTime = 0;
      if (this.round.state === 'AIMING') this.throwPitch();
    } else if (this.pitcherPhase === 'release' && this.pitcherTime >= RELEASE_DURATION) {
      this.pitcherPhase = 'follow';
      this.pitcherTime = 0;
    } else if (this.pitcherPhase === 'follow' && this.pitcherTime >= FOLLOW_DURATION) {
      this.pitcherPhase = 'idle';
      this.pitcherTime = 0;
    }
    const pDur = this.pitcherPhase === 'windup' ? WINDUP_DURATION : this.pitcherPhase === 'release' ? RELEASE_DURATION : this.pitcherPhase === 'follow' ? FOLLOW_DURATION : 2.4;
    this.pitcher.setPhase(this.pitcherPhase, this.pitcherPhase === 'idle' ? (this.elapsed % 2.4) / 2.4 : Math.min(1, this.pitcherTime / pDur));
  }

  private update(dt: number, simDt: number) {
    const state = this.round.state;
    this.updateActors(dt);

    if (this.swingTimer >= 0) {
      this.swingTimer -= dt;
      if (this.swingTimer < 0) {
        this.swingTimer = -1;
        this.doContact();
      }
    }

    if (state === 'TITLE' || state === 'GARAGE' || state === 'CHALLENGES' || (state === 'SETTINGS' && this.returnState === 'TITLE')) {
      this.titleSway += dt;
      this.camera.setAimYaw(Math.sin(this.titleSway * 0.25) * 0.12);
    } else {
      this.camera.setAimYaw(this.aim.yaw);
    }

    if (state === 'AIMING' || state === 'PITCHING') {
      const bat = getBat(this.store.profile.equippedBat);
      const ballSpec = getBall(this.store.profile.equippedBall);
      const perfect: ContactResult = { quality: 'PERFECT', error: 0, power: 1, yawError: 0, loftDelta: 0 };
      const launch = computeLaunch({ aim: this.aim, contact: perfect, bat, ball: ballSpec, jitter: 0.5, pitch: { speed: 30, offsetX: 0, offsetY: 0 } });
      this.preview.set(previewTrajectory({ x: TEE_POS.x, y: TEE_POS.y, z: TEE_POS.z }, launch.velocity, GRAVITY, 30, 0.08));
      if (state === 'AIMING') {
        if (this.pitcherPhase === 'idle') {
          this.pitchTimer -= dt;
          if (this.pitchTimer <= 0) {
            this.pitcherPhase = 'windup';
            this.pitcherTime = 0;
          }
        }
      } else if (this.pitch) {
        // The pitch is in the air.
        this.ball.updatePitch(dt);
        const p = this.pitch;
        const perfectTap = p.duration - SWING_DELAY;
        const window_ = (PERFECT_WINDOW * bat.timingWindow) / p.duration;
        this.ui.setPitchProgress(this.ball.pitchTime / p.duration, perfectTap / p.duration, window_ * 2);
        if (this.debug.autoSwing !== null && this.swingTimer < 0 && this.ball.pitchTime >= perfectTap + this.debug.autoSwing) this.swing();
        else if (this.swingTimer < 0 && this.ball.pitchTime > p.duration + TAKEN_GRACE) {
          // Taken pitch: let it fly into the cage and set up the next one.
          this.ball.passPlate();
          this.round.takePitch();
          this.audio.catcherPop();
          this.ui.showToast(`${p.label} · taken`);
          this.ui.setSwingState('wait');
          this.ui.setMeter(null, 1, 0);
          this.pitchTimer = 1.0;
          this.pitch = null;
        }
      }
    }

    // Physics.
    if (simDt > 0) {
      this.physics.step(
        simDt,
        () => {
          this.props.storeVelocities();
          this.structures.storeVelocities();
          this.ball.beforeStep(this.wind, GRAVITY);
        },
        () => {
          this.simTime += 1 / 60;
          this.processCollisions();
        },
      );
      this.ball.sync(simDt);
      this.props.update(simDt, this.elapsed);
      this.structures.update(simDt);
      this.fragments.update(simDt);
      this.particles.update(simDt);
      this.blastFx.update(simDt);
    }

    if (this.scorer) {
      if (this.scorer.tick(this.simTime)) this.ui.setCombo(1, 0);
    }

    if (state === 'BALL_IN_FLIGHT') this.updateFlight(dt, simDt);
    else if (state === 'SHOT_RESOLVING') {
      this.resolveTimer += simDt;
      const chainDone = !this.scorer || this.simTime - this.scorer.lastScoreTime > COMBO_GRACE;
      if ((chainDone && this.resolveTimer > 0.4) || this.resolveTimer > 3) {
        this.ball.active = false;
        this.finishShot();
      }
    } else if (state === 'SHOT_RESULTS') {
      this.resultsTimer += dt;
      if (this.resultsTimer > 3.4) this.continueShot();
    }

    // Performance governor: if frames get expensive while rubble is flying, thin the debris so controls stay responsive.
    if (this.renderer.lastAvgMs > 40 && this.structures.activeChunks > 10) {
      this.structures.trimChunks(10);
      this.renderer.lastAvgMs = 0;
    }

    // Unstable structures groan and shed dust until they give way.
    this.unstableTimer -= dt;
    if (this.unstableTimer <= 0) {
      this.unstableTimer = 0.55;
      for (const u of this.structures.unstableStructures()) {
        const s = u.structure;
        const cells = s.cells.filter((c) => c.iy === u.floor && c.state !== 'broken' && c.kind !== 'slab');
        if (!cells.length) continue;
        const c = cells[this.rng.int(0, cells.length - 1)];
        this.particles.burst(_v.set(c.x + c.nx * c.sx * 0.6, c.y - c.sy * 0.3, c.z + c.nz * c.sz * 0.6), 'concrete', 6, 2.5);
        if (state === 'BALL_IN_FLIGHT' || state === 'SHOT_RESOLVING') this.audio.groan();
      }
    }

    this.camera.update(dt, this.ball.pos, this.ball.vel, this.ball.active);
    this.ui.tick(dt);
  }

  private updateFlight(dt: number, simDt: number) {
    // A line drive that clips the pitcher's scaffold deck splinters straight through the plywood.
    if (this.ball.active && !this.deckSmashed) {
      const p = this.ball.pos;
      const r = 0.4;
      if (p.x > DECK_BOX.minX - r && p.x < DECK_BOX.maxX + r && p.y > DECK_BOX.minY - r && p.y < DECK_BOX.maxY && p.z > DECK_BOX.minZ - r && p.z < DECK_BOX.maxZ + r) {
        this.deckSmashed = true;
        this.particles.burst(p, 'plank', 22, 9);
        this.props.spawnDebris(p, _v.copy(this.ball.vel).multiplyScalar(0.5), 4);
        this.audio.impact('plank', this.ball.vel.length(), true);
        this.camera.kick(0.25);
        this.ball.setVelocity(_v.copy(this.ball.vel).multiplyScalar(0.92));
      }
    }
    // Rocket state.
    if (this.ball.active && !this.rocket.finished) {
      const ev = this.rocket.tick(simDt);
      if (ev === 'ignite') {
        this.ball.thrust = this.rocket.spec.thrust;
        this.ball.lift = this.rocket.spec.lift;
        this.ball.setGlow(0.9, 0xff9a50);
        this.rocketIgnitedAt = this.simTime;
        this.audio.rocketIgnite();
        this.camera.kick(0.3);
        this.ui.showCallout('IGNITION', 'default');
        _col.setHex(0xffc070);
        this.particles.burstColor(this.ball.pos, _col, 24, 14, undefined, 1.2, [0.2, 0.6], 2, 0.3);
        this.haptic(25);
      } else if (ev === 'burnout') {
        this.ball.thrust = 0;
        this.ball.lift = 0;
      } else if (ev === 'autodetonate') {
        this.detonate();
      }
      if (this.rocket.lit && this.ball.active) {
        const speed = this.ball.vel.length();
        this.ui.setRocket('lit', this.rocket.charge, this.rocket.fuel);
        this.audio.rocketLoop(this.rocket.fuel, speed);
        _v.copy(this.ball.vel);
        if (_v.lengthSq() > 1) _v.normalize();
        else _v.set(0, 0, -1);
        this.flame.update(dt, this.ball.pos, _v, this.rocket.fuel, true);
        this.exhaustAcc += simDt;
        if (this.exhaustAcc > 0.016 && this.rocket.fuel > 0.02) {
          this.exhaustAcc = 0;
          _col.setHex(0xffa040);
          this.particles.burstColor(_v2.copy(this.ball.pos).addScaledVector(_v, -0.6), _col, 2, 3, _v3.copy(_v).multiplyScalar(-1), 0.9, [0.15, 0.35], -1, 0.15);
          _col.setHex(0x9a938c);
          this.particles.burstColor(_v2.copy(this.ball.pos).addScaledVector(_v, -1.2), _col, 1, 1.5, undefined, 1.8, [0.8, 1.6], -1.5, 0.2);
        }
        if (this.debug.autoDetonate !== null && this.simTime - this.rocketIgnitedAt >= this.debug.autoDetonate) this.detonate();
        else if (this.debug.autoDetonateInside && this.structures.structureAt(this.ball.pos.x, this.ball.pos.y, this.ball.pos.z)) this.detonate();
        // A lit rocket that has stalled (lodged, rolling) goes off on its own.
        if (speed < 7) this.slowRocketTimer += simDt;
        else this.slowRocketTimer = 0;
        if (this.slowRocketTimer > 0.35 || this.ball.isOutOfBounds) this.detonate();
      } else if (this.rocket.phase === 'armed') {
        this.ui.setRocket('armed');
      }
    } else {
      this.flame.group.visible = false;
    }
    const quiet = !this.scorer || this.simTime - this.scorer.lastScoreTime > 3;
    const whiff = this.contact?.quality === 'MISS';
    const ballDone = !this.ball.active || this.ball.isResting || this.ball.isOutOfBounds || this.ball.flightTime > (whiff ? 3 : 14) || (this.ball.isDull && quiet);
    const worldQuiet = this.structures.activeChunks === 0 || this.simTime - this.lastWorldEvent > 2.6;
    if (ballDone && worldQuiet && !this.rocket.lit) {
      this.round.transition('SHOT_RESOLVING');
      this.resolveTimer = 0;
      this.ball.thrust = 0;
      this.flame.group.visible = false;
      this.audio.rocketStop();
      if (this.ball.active && this.ball.isOutOfBounds && this.ball.pos.y > -5) this.ui.showToast('Out of town!');
    }
  }
}

export type { CellMaterial };
