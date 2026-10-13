import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { RAPIER as R } from '../engine/physics';
import { makeBallTexture, makeParticleTexture } from '../world/textures';
import type { BallSpec } from '../logic/equipment';
import { BallTrail, SpinRing } from '../engine/effects';
import { TEE_POS } from '../world/rooftop';
import { pitchPosition, pitchVelocity, type Pitch } from '../logic/pitching';
import { classifySpin } from '../logic/batting';

export const BALL_RADIUS = 0.32;
/** Magnus coefficient: spin visibly bends the flight (gravity is 11.5). */
export const MAGNUS_K = 0.0016;

export const SPIN_COLORS = { backspin: 0x9ad7ff, topspin: 0xffa75a, sidespin: 0x7cf0b8, knuckle: 0xffffff } as const;

export type BallMode = 'idle' | 'pitch' | 'live';

export class Ball {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly mesh: THREE.Mesh;
  readonly trail = new BallTrail();
  readonly spinRing = new SpinRing(BALL_RADIUS);
  readonly prevVel = new THREE.Vector3();
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  readonly angVel = new THREE.Vector3();
  mode: BallMode = 'idle';
  /** true while the physics body is live (hit or passed pitch) */
  active = false;
  restTimer = 0;
  flightTime = 0;
  maxDistance = 0;
  spec: BallSpec;
  pitch: Pitch | null = null;
  pitchTime = 0;
  private material: THREE.MeshStandardMaterial;
  private glow: THREE.Sprite;
  private trailAcc = 0;
  private currentDamping = 0.06;
  private pitchQuat = new THREE.Quaternion();
  private tmpQ = new THREE.Quaternion();
  private tmpV = new THREE.Vector3();
  /** external thrust applied each step (rocket) */
  thrust = 0;
  lift = 0;
  /** flight time at which the ball was last moving quickly */
  lastFastTime = 0;

  constructor(world: RAPIER.World, scene: THREE.Scene, spec: BallSpec, envMap: THREE.Texture | null) {
    this.spec = spec;
    const desc = R.RigidBodyDesc.dynamic().setTranslation(TEE_POS.x, TEE_POS.y, TEE_POS.z).setCcdEnabled(true).setLinearDamping(0.06).setAngularDamping(0.25).setCanSleep(false);
    this.body = world.createRigidBody(desc);
    this.collider = world.createCollider(R.ColliderDesc.ball(BALL_RADIUS).setDensity(this.densityFor(spec)).setRestitution(spec.restitution).setFriction(0.45).setActiveEvents(R.ActiveEvents.COLLISION_EVENTS), this.body);
    this.body.setEnabled(false);
    this.material = new THREE.MeshStandardMaterial({ map: makeBallTexture(), color: spec.color, roughness: 0.55, metalness: spec.id === 'wrecker' ? 0.8 : 0.05, envMap });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(BALL_RADIUS, 24, 16), this.material);
    this.mesh.castShadow = true;
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeParticleTexture(), color: 0xffe9b0, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.glow.scale.set(2.2, 2.2, 1);
    this.mesh.add(this.glow);
    scene.add(this.mesh);
    scene.add(this.trail.line);
    scene.add(this.spinRing.mesh);
    this.hideAtPitcher();
  }

  private densityFor(spec: BallSpec): number {
    // Base mass ~5 kg at radius 0.32 (arcade scale) multiplied by the variant's mass factor.
    const volume = (4 / 3) * Math.PI * Math.pow(BALL_RADIUS, 3);
    return (5 * spec.mass) / volume;
  }

  get mass(): number {
    return this.body.mass();
  }

  setSpec(spec: BallSpec) {
    this.spec = spec;
    this.collider.setDensity(this.densityFor(spec));
    this.collider.setRestitution(spec.restitution);
    this.material.color.setHex(spec.color);
    this.material.metalness = spec.id === 'wrecker' ? 0.8 : 0.05;
    this.material.needsUpdate = true;
  }

  /** Between pitches: the ball is in the pitcher's hand (hidden here; the pitcher rig shows its own ball). */
  hideAtPitcher() {
    this.mode = 'idle';
    this.active = false;
    this.pitch = null;
    this.body.setEnabled(false);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, false);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, false);
    this.mesh.visible = false;
    this.spinRing.hide();
    this.trail.clear();
    this.vel.set(0, 0, 0);
    this.prevVel.set(0, 0, 0);
    this.angVel.set(0, 0, 0);
    this.restTimer = 0;
    this.flightTime = 0;
    this.maxDistance = 0;
    this.lastFastTime = 0;
    this.thrust = 0;
    this.lift = 0;
    this.setGlow(0.45, 0xffe9b0);
  }

  /** Legacy name kept for callers: resets to the pre-pitch state. */
  placeOnTee() {
    this.hideAtPitcher();
  }

  /** Starts the kinematic pitch flight. */
  startPitch(pitch: Pitch) {
    this.hideAtPitcher();
    this.mode = 'pitch';
    this.pitch = pitch;
    this.pitchTime = 0;
    this.mesh.visible = true;
    this.pos.set(pitch.release.x, pitch.release.y, pitch.release.z);
    this.mesh.position.copy(this.pos);
    this.pitchQuat.identity();
    this.angVel.set(pitch.spin.x, pitch.spin.y, pitch.spin.z);
  }

  /** Advances the pitch; returns true while the ball is still on its analytic path. */
  updatePitch(dt: number): void {
    if (this.mode !== 'pitch' || !this.pitch) return;
    this.pitchTime += dt;
    const p = pitchPosition(this.pitch, this.pitchTime);
    const v = pitchVelocity(this.pitch, this.pitchTime);
    this.pos.set(p.x, p.y, p.z);
    this.vel.set(v.x, v.y, v.z);
    this.mesh.position.copy(this.pos);
    // Real rotation about the pitch's spin axis.
    const w = this.angVel.length();
    if (w > 0) {
      this.tmpV.copy(this.angVel).normalize();
      this.tmpQ.setFromAxisAngle(this.tmpV, w * dt);
      this.pitchQuat.premultiply(this.tmpQ);
      this.mesh.quaternion.copy(this.pitchQuat);
    }
    this.spinRing.update(this.pos, this.angVel, SPIN_COLORS[classifySpin({ x: this.angVel.x, y: this.angVel.y, z: this.angVel.z })]);
  }

  /** Bat contact: hands the ball to physics from its current position with the launch velocity and spin. */
  launch(velocity: THREE.Vector3, spin: THREE.Vector3) {
    const from = this.pos.clone();
    this.mode = 'live';
    this.pitch = null;
    this.body.setEnabled(true);
    this.body.setTranslation({ x: from.x, y: from.y, z: from.z }, true);
    this.body.setRotation({ x: this.pitchQuat.x, y: this.pitchQuat.y, z: this.pitchQuat.z, w: this.pitchQuat.w }, true);
    this.body.setLinvel({ x: velocity.x, y: velocity.y, z: velocity.z }, true);
    this.body.setAngvel({ x: spin.x, y: spin.y, z: spin.z }, true);
    this.prevVel.copy(velocity);
    this.vel.copy(velocity);
    this.angVel.copy(spin);
    this.mesh.visible = true;
    this.active = true;
    this.restTimer = 0;
    this.flightTime = 0;
    this.maxDistance = 0;
    this.lastFastTime = 0;
    this.thrust = 0;
    this.lift = 0;
    this.body.setLinearDamping(0.06);
    this.currentDamping = 0.06;
  }

  /** Whiff or taken pitch: the ball keeps flying on its pitch velocity into the cage as a physics body. */
  passPlate() {
    if (!this.pitch) return;
    const v = pitchVelocity(this.pitch, this.pitchTime);
    this.launch(new THREE.Vector3(v.x, v.y, v.z), new THREE.Vector3(this.angVel.x, this.angVel.y, this.angVel.z));
  }

  /** Called before each physics step. Applies Magnus lift/curve, wind and rocket thrust. */
  beforeStep(wind: THREE.Vector3, gravity: number) {
    if (!this.active) return;
    const v = this.body.linvel();
    this.prevVel.set(v.x, v.y, v.z);
    const w = this.body.angvel();
    const m = this.mass;
    // Magnus: a = k * (omega x v)
    const k = MAGNUS_K;
    let fx = (w.y * v.z - w.z * v.y) * k * m;
    let fy = (w.z * v.x - w.x * v.z) * k * m;
    let fz = (w.x * v.y - w.y * v.x) * k * m;
    fx += wind.x * 0.25 * m;
    fz += wind.z * 0.25 * m;
    if (this.thrust > 0) {
      const speed = Math.hypot(v.x, v.y, v.z);
      if (speed > 0.5) {
        const a = this.thrust * m;
        fx += (v.x / speed) * a;
        fy += (v.y / speed) * a;
        fz += (v.z / speed) * a;
      }
      fy += gravity * this.lift * m;
    }
    this.body.resetForces(true);
    this.body.addForce({ x: fx, y: fy, z: fz }, true);
  }

  /** Called after physics; syncs the mesh and bookkeeping. */
  sync(dt: number) {
    if (!this.active) return;
    const t = this.body.translation();
    const v = this.body.linvel();
    const w = this.body.angvel();
    this.pos.set(t.x, t.y, t.z);
    this.vel.set(v.x, v.y, v.z);
    this.angVel.set(w.x, w.y, w.z);
    this.mesh.position.copy(this.pos);
    const r = this.body.rotation();
    this.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    this.flightTime += dt;
    const d = Math.hypot(this.pos.x - TEE_POS.x, this.pos.z - TEE_POS.z);
    if (d > this.maxDistance) this.maxDistance = d;
    const speed = this.vel.length();
    // Rolling resistance: rigid spheres never slow down on flat ground by themselves.
    const rolling = Math.abs(this.vel.y) < 1.2 && speed < 16 && this.thrust <= 0;
    const damping = rolling ? 1.1 : 0.06;
    if (damping !== this.currentDamping) {
      this.body.setLinearDamping(damping);
      this.currentDamping = damping;
    }
    if (speed < 0.7 || (rolling && speed < 2.5)) this.restTimer += dt;
    else this.restTimer = 0;
    if (speed > 10) this.lastFastTime = this.flightTime;
    this.trailAcc += dt;
    if (speed > 4 && this.trailAcc > 0.03) {
      this.trail.push(this.pos);
      this.trailAcc = 0;
    } else if (speed <= 4) {
      this.trail.clear();
    }
    this.spinRing.update(this.pos, this.angVel, SPIN_COLORS[classifySpin({ x: this.angVel.x, y: this.angVel.y, z: this.angVel.z })]);
  }

  /** Overrides the velocity after a pass-through (shattered glass, breached wall). */
  setVelocity(v: THREE.Vector3) {
    this.body.setLinvel({ x: v.x, y: v.y, z: v.z }, true);
    this.vel.copy(v);
  }

  /** Rocket detonated: the ball is consumed. */
  consume() {
    this.active = false;
    this.mode = 'idle';
    this.body.setEnabled(false);
    this.mesh.visible = false;
    this.spinRing.hide();
    this.trail.clear();
    this.thrust = 0;
    this.lift = 0;
  }

  setGlow(opacity: number, color: number) {
    const m = this.glow.material as THREE.SpriteMaterial;
    m.opacity = opacity;
    m.color.setHex(color);
  }

  get isResting(): boolean {
    return this.restTimer > 1.0;
  }
  /** Slow and uneventful for a while: nothing more will happen. */
  get isDull(): boolean {
    return this.flightTime - this.lastFastTime > 4 && this.vel.length() < 6;
  }
  get isOutOfBounds(): boolean {
    return Math.abs(this.pos.x) > 430 || this.pos.z < -760 || this.pos.z > 80 || this.pos.y < -5;
  }
}
