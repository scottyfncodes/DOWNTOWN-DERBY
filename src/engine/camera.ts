import * as THREE from 'three';
import { ROOF_Y } from '../world/city';
import { TEE_POS } from '../world/rooftop';

export type CameraMode = 'aim' | 'flight' | 'results';

const _dir = new THREE.Vector3();
const _desired = new THREE.Vector3();
const _look = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _ray = new THREE.Raycaster();

/** Aiming, flight and impact camera behaviours with smoothing, look-ahead and clipping avoidance. */
export class CameraRig {
  mode: CameraMode = 'aim';
  private pos = new THREE.Vector3();
  private target = new THREE.Vector3();
  private shake = 0;
  private shakeVec = new THREE.Vector3();
  private impulse = new THREE.Vector3();
  private impactTimer = 0;
  private aimYaw = 0;
  private lastVel = new THREE.Vector3(0, 0, -1);
  shakeEnabled = true;
  reducedMotion = false;
  private snapNext = true;
  private blend = 1; // 0..1 blend toward target (used for mode switches)

  constructor(private camera: THREE.PerspectiveCamera, private collidable: THREE.Object3D[]) {
    this.aimPose(this.pos, this.target, 0);
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.target);
  }

  setAimYaw(yaw: number) {
    this.aimYaw = yaw;
  }

  setMode(mode: CameraMode) {
    if (this.mode === mode) return;
    this.mode = mode;
    this.blend = 0;
    if (mode === 'flight') this.snapNext = true;
  }

  kick(strength: number) {
    if (!this.shakeEnabled) strength *= 0.25;
    if (this.reducedMotion) strength *= 0.15;
    this.shake = Math.min(1.2, this.shake + strength);
  }

  punch(dir: THREE.Vector3, strength: number) {
    if (this.reducedMotion) strength *= 0.3;
    this.impulse.addScaledVector(dir, strength);
  }

  impactMoment(duration = 0.9) {
    this.impactTimer = duration;
  }

  private aimPose(outPos: THREE.Vector3, outTarget: THREE.Vector3, yaw: number) {
    const portrait = this.camera.aspect < 1;
    const back = portrait ? 7.5 : 6.5;
    const height = portrait ? 4.2 : 3.6;
    outPos.set(TEE_POS.x + 1.4 + Math.sin(yaw) * -2.5, ROOF_Y + height, TEE_POS.z + back);
    outTarget.set(TEE_POS.x + Math.sin(-yaw) * 40, ROOF_Y - (portrait ? 4 : 1), TEE_POS.z - 60);
  }

  update(dt: number, ballPos: THREE.Vector3, ballVel: THREE.Vector3, ballActive: boolean) {
    const smooth = (k: number) => 1 - Math.exp(-dt * k);
    this.blend = Math.min(1, this.blend + dt * 1.6);
    if (ballVel.lengthSq() > 4) this.lastVel.copy(ballVel);
    if (this.mode === 'aim') {
      this.aimPose(_desired, _look, this.aimYaw);
      const k = this.blend < 1 ? 2.2 : 5;
      this.pos.lerp(_desired, smooth(k));
      this.target.lerp(_look, smooth(k));
    } else if (this.mode === 'flight') {
      _dir.copy(this.lastVel);
      _dir.y *= 0.35;
      if (_dir.lengthSq() < 0.01) _dir.set(0, 0, -1);
      _dir.normalize();
      const speed = ballVel.length();
      const moving = ballActive && speed > 3;
      const dist = this.impactTimer > 0 ? 10 : moving ? 6.5 + Math.min(3, speed * 0.04) : 6;
      const height = this.impactTimer > 0 ? 4.2 : 2.6;
      _desired.copy(ballPos).addScaledVector(_dir, -dist);
      _desired.y += height;
      // Keep the camera above the street and out of buildings.
      _desired.y = Math.max(_desired.y, 1.8);
      _ray.set(ballPos, _tmp.copy(_desired).sub(ballPos).normalize());
      _ray.far = dist + 1;
      const hits = _ray.intersectObjects(this.collidable, true);
      if (hits.length && hits[0].distance < dist) {
        _desired.copy(ballPos).addScaledVector(_ray.ray.direction, Math.max(1.5, hits[0].distance - 0.8));
      }
      const lookAhead = moving ? Math.min(14, speed * 0.18) : 2;
      _look.copy(ballPos).addScaledVector(_dir, lookAhead);
      if (this.snapNext) {
        this.pos.copy(_desired);
        this.target.copy(_look);
        this.snapNext = false;
      } else {
        const k = moving ? 7 : 3.5;
        this.pos.lerp(_desired, smooth(k));
        this.target.lerp(_look, smooth(10));
      }
    } else {
      // Results: slow drift above the rooftop looking over the city.
      _desired.set(TEE_POS.x - 6, ROOF_Y + 9, TEE_POS.z + 12);
      _look.set(0, ROOF_Y - 15, -120);
      this.pos.lerp(_desired, smooth(1.5));
      this.target.lerp(_look, smooth(1.5));
    }
    if (this.impactTimer > 0) this.impactTimer -= dt;
    // Shake + impulse.
    this.shake = Math.max(0, this.shake - dt * 2.6);
    const s = this.shake * this.shake * 0.5;
    this.shakeVec.set((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s * 0.4);
    this.impulse.multiplyScalar(Math.exp(-dt * 9));
    this.camera.position.copy(this.pos).add(this.shakeVec).add(this.impulse);
    this.camera.lookAt(this.target);
  }
}
