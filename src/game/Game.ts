import * as THREE from 'three';
import { Renderer, detectQuality } from '../engine/renderer';
import { GRAVITY, PhysicsWorld, RAPIER as R, loadRapier } from '../engine/physics';
import { CameraRig } from '../engine/camera';
import { AudioEngine } from '../engine/audio';
import { FragmentPool, ParticleSystem, TrajectoryPreview } from '../engine/effects';
import { PropManager, type Prop } from '../world/props';
import { StaticRegistry } from '../world/statics';
import { buildCity, pickBonusTarget } from '../world/city';
import { buildRooftop, TEE_POS, type BatterRig } from '../world/rooftop';
import { Ball } from './Ball';
import { UI, qualityCallout } from '../ui/ui';
import { RoundManager, BALLS_PER_ROUND } from '../logic/round';
import { ShotScorer, creditsForRound, MATERIAL_LABEL, COMBO_GRACE } from '../logic/scoring';
import { computeLaunch, evaluateContact, meterPosition, previewTrajectory, sweetWidthFor, MAX_YAW, MIN_LOFT, MAX_LOFT } from '../logic/batting';
import { getBat, getBall } from '../logic/equipment';
import { ProfileStore } from '../logic/progression';
import { getChallenge } from '../logic/challenges';
import { createRng } from '../logic/rng';
import type { AimSettings, ContactResult, ScoreLine, MaterialKind, ImpactEvent } from '../logic/types';

const METER_PERIOD = 1.5;
const SWEET_CENTER = 0.78;
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _n = new THREE.Vector3(0, 0, 1);

export class Game {
  renderer!: Renderer;
  physics!: PhysicsWorld;
  props!: PropManager;
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
  batter!: BatterRig;
  aim: AimSettings = { yaw: 0, loft: 24, spin: { side: 0, lift: 0 } };
  wind = new THREE.Vector3();
  scorer: ShotScorer | null = null;
  contact: ContactResult | null = null;
  private swingStart = 0;
  private swingTimer = -1;
  private batterPhase: 'idle' | 'windup' | 'swing' | 'follow' = 'idle';
  private phaseTime = 0;
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
  ready = false;

  constructor(private canvas: HTMLCanvasElement, private uiRoot: HTMLElement) {}

  async init(): Promise<void> {
    const quality = detectQuality();
    this.renderer = new Renderer(this.canvas, quality);
    await loadRapier();
    this.physics = new PhysicsWorld();
    const env = this.renderer.envMap;
    this.props = new PropManager(this.physics.world, env, quality);
    const city = buildCity(this.renderer.scene, this.physics.world, this.props, this.statics, env);
    const roof = buildRooftop(this.renderer.scene, this.physics.world, this.statics, env);
    this.batter = roof.batter;
    this.renderer.sun.target.position.set(0, 0, -120);
    this.ball = new Ball(this.physics.world, this.renderer.scene, getBall(this.store.profile.equippedBall), env);
    this.fragments = new FragmentPool(quality.fragments, env);
    this.particles = new ParticleSystem(quality.particles);
    this.preview = new TrajectoryPreview();
    this.renderer.scene.add(this.fragments.mesh, this.particles.points, this.preview.mesh, this.preview.reticle);
    this.camera = new CameraRig(this.renderer.camera, [...city.collidable.filter((o) => o !== this.props.group), ...roof.collidable]);
    this.mediaReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    this.applySettings();
    this.ui = new UI(this.uiRoot, {
      onPlay: () => this.startRound(),
      onGarage: () => this.openGarage(),
      onChallenges: () => this.openChallenges(),
      onSettings: () => this.openSettings(),
      onBack: () => this.goBack(),
      onMute: () => this.toggleMute(),
      onWindStart: () => this.windStart(),
      onWindRelease: () => this.windRelease(),
      onContinue: () => this.continueShot(),
      onPlayAgain: () => this.startRound(),
      onEquip: (kind, id) => {
        this.audio.click();
        this.store.equip(kind, id);
        this.ui.renderGarage(this.store.profile);
      },
      onBuy: (kind, id) => {
        const spec = kind === 'bat' ? getBat(id) : getBall(id);
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
        if (this.round.state === 'WINDING') this.cancelWindup();
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
    if (this.round.state === 'BOOT') this.round.transition('TITLE');
    else this.round.transition('TITLE');
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
    const from = this.round.state;
    if (from === 'WINDING') this.cancelWindup();
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
    } else if (this.returnState === 'ROUND_COMPLETE') {
      // Results screen is still rendered; re-show it.
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
    this.props.reset();
    this.fragments.clear();
    this.particles.clear();
    this.ball.setSpec(getBall(this.store.profile.equippedBall));
    this.ball.placeOnTee();
    this.scorer = null;
    this.contact = null;
    this.roundBestShot = 0;
    this.timeScale = 1;
    this.slowmoTimer = 0;
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

  private beginAiming() {
    this.round.transition('AIMING');
    this.ui.setSwingEnabled(true);
    this.ui.setHint(this.round.ballsUsed === 0 ? 'Drag to aim · Hold SWING to wind up · Release at the green zone' : null);
    this.ui.setMeter(null, SWEET_CENTER, this.sweetWidth());
    this.preview.setVisible(true);
    this.batterPhase = 'idle';
    this.phaseTime = 0;
  }

  private sweetWidth() {
    return sweetWidthFor(getBat(this.store.profile.equippedBat));
  }

  private windStart() {
    if (this.round.state !== 'AIMING') return;
    this.audio.unlock();
    if (!this.round.transition('WINDING')) return;
    this.swingStart = performance.now();
    this.batterPhase = 'windup';
    this.phaseTime = 0;
    this.ui.setHint(null);
    this.audio.tick();
  }

  private cancelWindup() {
    if (this.round.state !== 'WINDING') return;
    this.round.transition('AIMING');
    this.ui.setMeter(null, SWEET_CENTER, this.sweetWidth());
    this.ui.setSwingEnabled(true);
    this.batterPhase = 'idle';
    this.phaseTime = 0;
  }

  private windRelease() {
    if (this.round.state !== 'WINDING') return;
    const elapsed = (performance.now() - this.swingStart) / 1000;
    if (elapsed < 0.12) {
      this.cancelWindup();
      this.ui.showToast('Hold to wind up, release to swing');
      return;
    }
    const bat = getBat(this.store.profile.equippedBat);
    const value = meterPosition(elapsed, METER_PERIOD);
    this.contact = evaluateContact({ value, sweet: SWEET_CENTER, sweetWidth: sweetWidthFor(bat) }, bat);
    if (!this.round.commitSwing()) return;
    this.ui.setSwingEnabled(false);
    this.ui.setMeter(value, SWEET_CENTER, sweetWidthFor(bat));
    this.batterPhase = 'swing';
    this.phaseTime = 0;
    this.swingTimer = 0.09;
    this.audio.whoosh();
  }

  private doContact() {
    const contact = this.contact!;
    const bat = getBat(this.store.profile.equippedBat);
    const ballSpec = getBall(this.store.profile.equippedBall);
    const launch = computeLaunch({ aim: this.aim, contact, bat, ball: ballSpec, jitter: this.rng.next() });
    this.ball.launch(new THREE.Vector3(launch.velocity.x, launch.velocity.y, launch.velocity.z), new THREE.Vector3(launch.spin.x, launch.spin.y, launch.spin.z));
    this.scorer = new ShotScorer({ impactMultiplier: bat.impact * ballSpec.impact });
    this.round.transition('BALL_IN_FLIGHT');
    this.simTime = 0;
    this.preview.setVisible(false);
    this.audio.batContact(contact.quality);
    const q = contact.quality;
    const power = contact.power;
    if (q !== 'MISS') {
      this.camera.kick(0.25 + power * 0.5);
      this.camera.punch(new THREE.Vector3(0, 0.3, 1), 0.35 * power);
      this.freezeUntil = performance.now() + (q === 'PERFECT' ? 90 : 60);
      this.haptic(q === 'PERFECT' ? 40 : 20);
    }
    const callout = qualityCallout(q);
    if (callout) this.ui.showCallout(callout, q === 'PERFECT' ? 'perfect' : 'default');
    if (q === 'PERFECT' && !this.reducedMotion) this.ui.flashScreen(0.45);
    this.camera.setMode('flight');
  }

  private continueShot() {
    if (this.round.state !== 'SHOT_RESULTS') return;
    if (performance.now() - this.lastResultsAt < 500) return;
    const next = this.round.nextBall();
    if (next === 'READY') {
      this.ui.hideShotCard();
      this.ball.placeOnTee();
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
    this.ui.showShotCard(summary, this.round.total, this.round.ballsRemaining, isBest);
    this.updateChallengePill();
    this.ball.trail.clear();
  }

  private endRound() {
    const p = this.store.profile;
    const previousBest = p.bestScore;
    const bestCombo = Math.max(1, ...this.round.shots.map((s) => s.bestCombo));
    const perfect = this.round.shots.filter((s) => s.quality === 'PERFECT').length;
    const credits = creditsForRound(this.round.total, bestCombo, perfect);
    const challenge = getChallenge(p.activeChallenge);
    let completed: string | null = null;
    let reward = 0;
    const prelim = this.round.summarize(previousBest, credits, null, 0);
    if (challenge && !p.completedChallenges.includes(challenge.id) && challenge.check(prelim)) {
      completed = challenge.id;
      reward = challenge.reward;
    }
    const record = this.store.applyRound(this.round.total, prelim.bestShot, bestCombo, prelim.longestDistance, credits);
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
    if (this.round.state !== 'AIMING' && this.round.state !== 'WINDING') return;
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
    for (const pair of this.physics.started) {
      const isBallA = pair.a === ballHandle;
      const isBallB = pair.b === ballHandle;
      if (isBallA || isBallB) this.ballHit(isBallA ? pair.b : pair.a);
      else this.propPair(pair.a, pair.b);
    }
  }

  private ballHit(other: number) {
    const prev = this.ball.prevVel;
    const prop = this.props.byCollider.get(other);
    const now = this.simTime;
    if (prop) {
      _v.copy(prev).sub(prop.prevVel);
      const rel = _v.length();
      const impulse = _v2.copy(prev).multiplyScalar(this.ball.mass * 1.8);
      const outcome = this.props.applyHit(prop, rel, impulse, this.ball.pos, true);
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
    // Prop vs building/ground: a falling object landing. Effects only.
    const prop = (pa ?? pb)!;
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

  private feedback(line: ScoreLine | null, material: MaterialKind, speed: number, destroyed: boolean, pos: THREE.Vector3, direct: boolean) {
    const count = material === 'glass' ? 14 : destroyed ? 18 : 8;
    this.particles.burst(pos, material, count, Math.min(14, 3 + speed * 0.25));
    if (this.scorer) this.audio.impact(material, speed, destroyed);
    if (direct) this.camera.kick(Math.min(0.5, speed / 120) + (destroyed ? 0.2 : 0));
    if (!line) return;
    const sp = this.project(pos);
    this.ui.popup(sp.x, sp.y, line);
    if (this.scorer) {
      this.ui.setScore(this.round.total + this.scorer.score);
      this.ui.setCombo(this.scorer.combo, this.scorer.chainCount);
      if (this.scorer.chainIndex >= 1) this.audio.combo(this.scorer.chainIndex);
      const big = line.points >= 900 || (destroyed && (material === 'billboard' || material === 'watertower' || material === 'car')) || this.scorer.combo >= 3.5;
      if (big && this.bigEventCooldown <= 0) {
        this.bigEventCooldown = 1.2;
        this.camera.impactMoment(0.9);
        this.camera.kick(0.5);
        this.audio.bigEvent();
        this.haptic(30);
        if (this.store.profile.settings.slowmo && !this.reducedMotion) this.slowmoTimer = 0.55;
        if (line.points >= 1500) this.ui.showCallout('DEMOLITION!', 'record');
        else if (this.scorer.combo >= 3.5) this.ui.showCallout('CHAIN REACTION!');
      }
    }
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
    this.renderer.render();
    this.renderer.recordFrame(performance.now() - start);
  }

  private update(dt: number, simDt: number) {
    const state = this.round.state;
    // Batter animation.
    this.phaseTime += dt;
    if (this.batterPhase === 'swing' && this.phaseTime > 0.16) {
      this.batterPhase = 'follow';
      this.phaseTime = 0;
    } else if (this.batterPhase === 'follow' && this.phaseTime > 0.5) {
      this.batterPhase = 'idle';
      this.phaseTime = 0;
    }
    const phaseDur = this.batterPhase === 'swing' ? 0.16 : this.batterPhase === 'follow' ? 0.5 : this.batterPhase === 'windup' ? 0.4 : 3;
    this.batter.setPhase(this.batterPhase, this.batterPhase === 'idle' ? (this.elapsed % 3) / 3 : this.phaseTime / phaseDur);
    this.batter.setAimYaw(this.aim.yaw);

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

    if (state === 'AIMING' || state === 'WINDING') {
      const bat = getBat(this.store.profile.equippedBat);
      const ballSpec = getBall(this.store.profile.equippedBall);
      const perfect: ContactResult = { quality: 'PERFECT', error: 0, power: 1, yawError: 0, loftDelta: 0 };
      const launch = computeLaunch({ aim: this.aim, contact: perfect, bat, ball: ballSpec, jitter: 0.5 });
      this.preview.set(previewTrajectory({ x: TEE_POS.x, y: TEE_POS.y, z: TEE_POS.z }, launch.velocity, GRAVITY, 30, 0.08));
      if (state === 'WINDING') {
        const elapsed = (performance.now() - this.swingStart) / 1000;
        this.ui.setMeter(meterPosition(elapsed, METER_PERIOD), SWEET_CENTER, this.sweetWidth());
      }
    }

    // Physics.
    if (simDt > 0) {
      this.physics.step(
        simDt,
        () => {
          this.props.storeVelocities();
          this.ball.beforeStep(this.wind);
        },
        () => {
          this.simTime += 1 / 60;
          this.processCollisions();
        },
      );
      this.ball.sync(simDt);
      this.props.update(simDt, this.elapsed);
      this.fragments.update(simDt);
      this.particles.update(simDt);
    }

    if (this.scorer) {
      if (this.scorer.tick(this.simTime)) this.ui.setCombo(1, 0);
    }

    if (state === 'BALL_IN_FLIGHT') {
      const quiet = !this.scorer || this.simTime - this.scorer.lastScoreTime > 3;
      const done = this.ball.isResting || this.ball.isOutOfBounds || this.ball.flightTime > 13 || (this.ball.isDull && quiet);
      if (done) {
        this.round.transition('SHOT_RESOLVING');
        this.resolveTimer = 0;
        if (this.ball.isOutOfBounds && this.ball.pos.y > -5) this.ui.showToast('Out of town!');
      }
    } else if (state === 'SHOT_RESOLVING') {
      this.resolveTimer += simDt;
      const chainDone = !this.scorer || this.simTime - this.scorer.lastScoreTime > COMBO_GRACE;
      if ((chainDone && this.resolveTimer > 0.4) || this.resolveTimer > 3) {
        this.ball.active = false;
        this.finishShot();
      }
    } else if (state === 'SHOT_RESULTS') {
      this.resultsTimer += dt;
      if (this.resultsTimer > 3.2) this.continueShot();
    }

    this.camera.update(dt, this.ball.pos, this.ball.vel, this.ball.active);
    this.ui.tick(dt);
  }
}
