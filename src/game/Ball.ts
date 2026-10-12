import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { RAPIER as R } from '../engine/physics';
import { makeBallTexture, makeParticleTexture } from '../world/textures';
import type { BallSpec } from '../logic/equipment';
import { BallTrail } from '../engine/effects';
import { TEE_POS } from '../world/rooftop';

export const BALL_RADIUS = 0.32;

export class Ball {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly mesh: THREE.Mesh;
  readonly trail = new BallTrail();
  readonly prevVel = new THREE.Vector3();
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  active = false;
  restTimer = 0;
  flightTime = 0;
  maxDistance = 0;
  spec: BallSpec;
  private material: THREE.MeshStandardMaterial;
  private trailAcc = 0;
  private currentDamping = 0.06;
  /** flight time at which the ball was last moving quickly */
  lastFastTime = 0;

  constructor(world: RAPIER.World, scene: THREE.Scene, spec: BallSpec, envMap: THREE.Texture | null) {
    this.spec = spec;
    const desc = R.RigidBodyDesc.dynamic().setTranslation(TEE_POS.x, TEE_POS.y, TEE_POS.z).setCcdEnabled(true).setLinearDamping(0.06).setAngularDamping(0.4).setCanSleep(false);
    this.body = world.createRigidBody(desc);
    this.collider = world.createCollider(R.ColliderDesc.ball(BALL_RADIUS).setDensity(this.densityFor(spec)).setRestitution(spec.restitution).setFriction(0.45).setActiveEvents(R.ActiveEvents.COLLISION_EVENTS), this.body);
    this.body.setEnabled(false);
    this.material = new THREE.MeshStandardMaterial({ map: makeBallTexture(), color: spec.color, roughness: 0.55, metalness: spec.id === 'wrecker' ? 0.8 : 0.05, envMap });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(BALL_RADIUS, 20, 14), this.material);
    this.mesh.castShadow = true;
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeParticleTexture(), color: 0xffe9b0, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.scale.set(2.2, 2.2, 1);
    this.mesh.add(glow);
    scene.add(this.mesh);
    scene.add(this.trail.line);
    this.placeOnTee();
  }

  private densityFor(spec: BallSpec): number {
    // Base mass ~5 kg at radius 0.37 (arcade scale) multiplied by the variant's mass factor.
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

  placeOnTee() {
    this.active = false;
    this.body.setEnabled(false);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, false);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, false);
    this.body.setTranslation({ x: TEE_POS.x, y: TEE_POS.y, z: TEE_POS.z }, false);
    this.pos.copy(TEE_POS);
    this.vel.set(0, 0, 0);
    this.prevVel.set(0, 0, 0);
    this.mesh.position.copy(TEE_POS);
    this.mesh.visible = true;
    this.trail.clear();
    this.restTimer = 0;
    this.flightTime = 0;
    this.maxDistance = 0;
    this.lastFastTime = 0;
  }

  launch(velocity: THREE.Vector3, spin: THREE.Vector3) {
    this.body.setEnabled(true);
    this.body.setTranslation({ x: TEE_POS.x, y: TEE_POS.y, z: TEE_POS.z }, true);
    this.body.setLinvel({ x: velocity.x, y: velocity.y, z: velocity.z }, true);
    this.body.setAngvel({ x: spin.x, y: spin.y, z: spin.z }, true);
    this.prevVel.copy(velocity);
    this.vel.copy(velocity);
    this.active = true;
    this.restTimer = 0;
    this.flightTime = 0;
    this.maxDistance = 0;
    this.lastFastTime = 0;
    this.body.setLinearDamping(0.06);
    this.currentDamping = 0.06;
  }

  /** Called before each physics step. Applies Magnus lift/curve and wind. */
  beforeStep(wind: THREE.Vector3) {
    if (!this.active) return;
    const v = this.body.linvel();
    this.prevVel.set(v.x, v.y, v.z);
    const w = this.body.angvel();
    const m = this.mass;
    // Magnus: a = k * (omega x v)
    const k = 0.0012;
    const fx = (w.y * v.z - w.z * v.y) * k * m;
    const fy = (w.z * v.x - w.x * v.z) * k * m;
    const fz = (w.x * v.y - w.y * v.x) * k * m;
    this.body.resetForces(true);
    this.body.addForce({ x: fx + wind.x * 0.25 * m, y: fy, z: fz + wind.z * 0.25 * m }, true);
  }

  /** Called after physics; syncs the mesh and bookkeeping. */
  sync(dt: number) {
    if (!this.active) return;
    const t = this.body.translation();
    const v = this.body.linvel();
    this.pos.set(t.x, t.y, t.z);
    this.vel.set(v.x, v.y, v.z);
    this.mesh.position.copy(this.pos);
    const r = this.body.rotation();
    this.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    this.flightTime += dt;
    const d = Math.hypot(this.pos.x - TEE_POS.x, this.pos.z - TEE_POS.z);
    if (d > this.maxDistance) this.maxDistance = d;
    const speed = this.vel.length();
    // Rolling resistance: rigid spheres never slow down on flat ground by themselves.
    const rolling = Math.abs(this.vel.y) < 1.2 && speed < 16;
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
  }

  /** Overrides the velocity after a pass-through (shattered glass). */
  setVelocity(v: THREE.Vector3) {
    this.body.setLinvel({ x: v.x, y: v.y, z: v.z }, true);
    this.vel.copy(v);
  }

  get isResting(): boolean {
    return this.restTimer > 1.0;
  }
  /** Slow and uneventful for a while: nothing more will happen. */
  get isDull(): boolean {
    return this.flightTime - this.lastFastTime > 4 && this.vel.length() < 6;
  }
  get isOutOfBounds(): boolean {
    return Math.abs(this.pos.x) > 430 || this.pos.z < -730 || this.pos.z > 80 || this.pos.y < -5;
  }
}
