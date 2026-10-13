import * as THREE from 'three';
import { makeParticleTexture } from '../world/textures';
import { createRng } from '../logic/rng';
import type { MaterialKind } from '../logic/types';

const rng = createRng(4242);
const _col = new THREE.Color();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

interface Fragment {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  rot: THREE.Euler;
  spin: THREE.Vector3;
  life: number;
  max: number;
  size: number;
}

/** Lightweight CPU-simulated glass shards (no physics bodies). */
export class FragmentPool {
  readonly mesh: THREE.InstancedMesh;
  private items: Fragment[] = [];
  constructor(capacity: number, envMap: THREE.Texture | null) {
    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.MeshStandardMaterial({ color: 0xbfe6ff, roughness: 0.1, metalness: 0.8, envMap, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    for (let i = 0; i < capacity; i++) {
      this.items.push({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), rot: new THREE.Euler(), spin: new THREE.Vector3(), life: 0, max: 1, size: 0.5 });
    }
  }

  burst(center: THREE.Vector3, normal: THREE.Vector3, impulse: THREE.Vector3, count: number, width: number, height: number) {
    let n = 0;
    for (const f of this.items) {
      if (n >= count) break;
      if (f.life > 0) continue;
      f.pos.set(center.x + (rng.next() - 0.5) * width, center.y + (rng.next() - 0.5) * height, center.z + (rng.next() - 0.5) * 0.3);
      f.vel.set(impulse.x * 0.12 + normal.x * rng.range(1, 6) + rng.range(-3, 3), impulse.y * 0.12 + rng.range(-1, 4), impulse.z * 0.12 + normal.z * rng.range(1, 6) + rng.range(-3, 3));
      f.rot.set(rng.range(0, 6), rng.range(0, 6), rng.range(0, 6));
      f.spin.set(rng.range(-8, 8), rng.range(-8, 8), rng.range(-8, 8));
      f.max = f.life = rng.range(1.2, 2.2);
      f.size = rng.range(0.35, 1.1);
      n++;
    }
  }

  update(dt: number) {
    let count = 0;
    for (let i = 0; i < this.items.length; i++) {
      const f = this.items[i];
      if (f.life <= 0) continue;
      f.life -= dt;
      f.vel.y -= 11.5 * dt;
      f.pos.addScaledVector(f.vel, dt);
      f.rot.x += f.spin.x * dt;
      f.rot.y += f.spin.y * dt;
      f.rot.z += f.spin.z * dt;
      const k = Math.min(1, f.life / 0.4);
      _q.setFromEuler(f.rot);
      _s.setScalar(f.size * k);
      _m.compose(f.pos, _q, _s);
      this.mesh.setMatrixAt(count++, _m);
    }
    this.mesh.count = count;
    if (count) this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear() {
    for (const f of this.items) f.life = 0;
    this.mesh.count = 0;
  }
}

interface Particle {
  life: number;
  max: number;
  vel: THREE.Vector3;
  size: number;
  gravity: number;
}

export const MATERIAL_COLORS: Partial<Record<MaterialKind, number>> = {
  glass: 0xbfe6ff,
  concrete: 0xd9c9b0,
  brick: 0xb86a4a,
  steel: 0x9aa4b8,
  slab: 0xcfc5b2,
  column: 0xd9d0c0,
  rubble: 0xb0a898,
  ground: 0xb9a98c,
  roof: 0xc7b89d,
  hvac: 0xffe08a,
  sign: 0xff9ad0,
  billboard: 0xffd166,
  car: 0xffb347,
  streetlight: 0xffe08a,
  watertower: 0x8fd3ff,
  crate: 0xd9a066,
  barrel: 0xffe08a,
  plank: 0xd9a066,
  scaffold: 0xffe08a,
  antenna: 0xffe08a,
  awning: 0xff9a7a,
  cage: 0xffffff,
};

export class ParticleSystem {
  readonly points: THREE.Points;
  private positions: Float32Array;
  private colors: Float32Array;
  private sizes: Float32Array;
  private items: Particle[] = [];
  private capacity: number;
  private geo: THREE.BufferGeometry;
  constructor(capacity: number) {
    this.capacity = capacity;
    this.positions = new Float32Array(capacity * 3);
    this.colors = new Float32Array(capacity * 3);
    this.sizes = new Float32Array(capacity);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: makeParticleTexture() } },
      vertexShader: `
        attribute float aSize; varying vec3 vColor; varying float vA;
        void main(){ vColor = color; vA = clamp(aSize, 0.0, 1.0);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = min(96.0, aSize * 180.0 / max(1.0, -mv.z));
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `
        uniform sampler2D map; varying vec3 vColor; varying float vA;
        void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vColor, t.a * 0.9); }`,
      transparent: true,
      depthWrite: false,
      vertexColors: true,
      blending: THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    for (let i = 0; i < capacity; i++) this.items.push({ life: 0, max: 1, vel: new THREE.Vector3(), size: 1, gravity: 8 });
    this.geo.setDrawRange(0, 0);
  }

  burst(pos: THREE.Vector3, material: MaterialKind, count: number, speed: number, dir?: THREE.Vector3) {
    _col.setHex(MATERIAL_COLORS[material] ?? 0xffffff);
    this.burstColor(pos, _col, count, speed, dir, material === 'glass' ? 0.6 : 1.1, [0.35, 0.9], material === 'glass' ? 12 : 6, material === 'glass' ? 0.3 : 0.3);
  }

  /** General-purpose burst with explicit colour, size, life range, gravity and spawn jitter. */
  burstColor(pos: THREE.Vector3, color: THREE.Color, count: number, speed: number, dir: THREE.Vector3 | undefined, maxSize: number, life: [number, number], gravity: number, jitter: number) {
    let n = 0;
    for (let i = 0; i < this.capacity && n < count; i++) {
      const p = this.items[i];
      if (p.life > 0) continue;
      p.max = p.life = rng.range(life[0], life[1]);
      p.vel.set(rng.range(-1, 1), rng.range(-0.2, 1), rng.range(-1, 1)).normalize().multiplyScalar(speed * rng.range(0.3, 1));
      if (dir) p.vel.addScaledVector(dir, speed * 0.4);
      p.size = rng.range(maxSize * 0.4, maxSize);
      p.gravity = gravity;
      this.positions[i * 3] = pos.x + rng.range(-jitter, jitter);
      this.positions[i * 3 + 1] = pos.y + rng.range(-jitter, jitter);
      this.positions[i * 3 + 2] = pos.z + rng.range(-jitter, jitter);
      this.colors[i * 3] = color.r * rng.range(0.8, 1.1);
      this.colors[i * 3 + 1] = color.g * rng.range(0.8, 1.1);
      this.colors[i * 3 + 2] = color.b * rng.range(0.8, 1.1);
      n++;
    }
  }

  update(dt: number) {
    let maxIndex = 0;
    for (let i = 0; i < this.capacity; i++) {
      const p = this.items[i];
      if (p.life <= 0) {
        this.sizes[i] = 0;
        continue;
      }
      p.life -= dt;
      p.vel.y -= p.gravity * dt;
      p.vel.multiplyScalar(1 - dt * 1.5);
      this.positions[i * 3] += p.vel.x * dt;
      this.positions[i * 3 + 1] += p.vel.y * dt;
      this.positions[i * 3 + 2] += p.vel.z * dt;
      this.sizes[i] = p.size * Math.min(1, p.life / p.max + 0.2);
      maxIndex = i + 1;
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    this.geo.setDrawRange(0, maxIndex);
  }

  clear() {
    for (const p of this.items) p.life = 0;
    this.geo.setDrawRange(0, 0);
  }
}

/** Fading ribbon behind the ball. */
export class BallTrail {
  readonly line: THREE.Line;
  private points: THREE.Vector3[] = [];
  private max = 28;
  private positions: Float32Array;
  private colors: Float32Array;
  private geo: THREE.BufferGeometry;
  constructor() {
    this.positions = new Float32Array(this.max * 3);
    this.colors = new Float32Array(this.max * 3);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.line = new THREE.Line(this.geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, linewidth: 2 }));
    this.line.frustumCulled = false;
    this.geo.setDrawRange(0, 0);
  }
  push(p: THREE.Vector3) {
    this.points.push(p.clone());
    if (this.points.length > this.max) this.points.shift();
    this.rebuild();
  }
  private rebuild() {
    const n = this.points.length;
    for (let i = 0; i < n; i++) {
      const p = this.points[i];
      this.positions[i * 3] = p.x;
      this.positions[i * 3 + 1] = p.y;
      this.positions[i * 3 + 2] = p.z;
      const k = i / Math.max(1, n - 1);
      this.colors[i * 3] = 1;
      this.colors[i * 3 + 1] = 0.6 + 0.4 * k;
      this.colors[i * 3 + 2] = 0.2 + 0.6 * k;
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    this.geo.setDrawRange(0, n);
  }
  clear() {
    this.points.length = 0;
    this.geo.setDrawRange(0, 0);
  }
}

/** Dotted aim preview. */
export class TrajectoryPreview {
  readonly mesh: THREE.InstancedMesh;
  readonly reticle: THREE.Mesh;
  private count: number;
  constructor(count = 30) {
    this.count = count;
    this.mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.22, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.9, depthTest: false }), count);
    this.mesh.renderOrder = 5;
    this.mesh.frustumCulled = false;
    this.reticle = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.3, 24), new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthTest: false }));
    this.reticle.renderOrder = 5;
    this.reticle.visible = false;
  }
  set(points: { x: number; y: number; z: number }[]) {
    const n = Math.min(points.length, this.count);
    for (let i = 0; i < n; i++) {
      _p.set(points[i].x, points[i].y, points[i].z);
      const s = 1 - (i / n) * 0.7;
      _s.setScalar(s);
      _m.compose(_p, _q.identity(), _s);
      this.mesh.setMatrixAt(i, _m);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  setVisible(v: boolean) {
    this.mesh.visible = v;
  }
}


/** Rocket exhaust: a stretched additive flame sprite behind the ball plus a hot glow. Particles are emitted by the caller. */
export class RocketFlame {
  readonly group = new THREE.Group();
  private flame: THREE.Sprite;
  private glow: THREE.Sprite;
  private t = 0;
  constructor() {
    this.flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeParticleTexture(), color: 0xffb060, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeParticleTexture(), color: 0xff6a2a, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.group.add(this.flame, this.glow);
    this.group.visible = false;
  }
  /** `intensity` 0..1 (fuel), `dir` = unit flight direction. */
  update(dt: number, pos: THREE.Vector3, dir: THREE.Vector3, intensity: number, lit: boolean) {
    this.group.visible = lit && intensity > 0.02;
    if (!this.group.visible) return;
    this.t += dt;
    const flicker = 0.85 + 0.15 * Math.sin(this.t * 60) * Math.cos(this.t * 37);
    const len = (2.2 + 3.5 * intensity) * flicker;
    this.flame.position.copy(pos).addScaledVector(dir, -len * 0.45);
    this.flame.scale.set(0.9 + intensity * 0.6, len, 1);
    // Sprite rotation: align its vertical axis with the flight direction projected to screen is not available; use rotation from dir.xy as a cheap approximation.
    (this.flame.material as THREE.SpriteMaterial).rotation = Math.atan2(dir.x, -dir.y);
    this.glow.position.copy(pos);
    this.glow.scale.setScalar(2.4 + intensity * 1.6);
    (this.glow.material as THREE.SpriteMaterial).opacity = 0.35 + 0.35 * intensity * flicker;
  }
}

/** Pooled explosion visuals: a flash sprite, an expanding shock shell and a lingering fireball. */
export class BlastFX {
  readonly group = new THREE.Group();
  private items: { shell: THREE.Mesh; flash: THREE.Sprite; fire: THREE.Sprite; life: number; max: number; radius: number }[] = [];
  constructor(count = 3) {
    for (let i = 0; i < count; i++) {
      const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeParticleTexture(), color: 0xffffff, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending }));
      const fire = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeParticleTexture(), color: 0xff7a30, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
      shell.visible = flash.visible = fire.visible = false;
      this.group.add(shell, flash, fire);
      this.items.push({ shell, flash, fire, life: 0, max: 1, radius: 10 });
    }
  }
  spawn(pos: THREE.Vector3, radius: number) {
    const it = this.items.find((i) => i.life <= 0) ?? this.items[0];
    it.life = it.max = 0.9;
    it.radius = radius;
    it.shell.position.copy(pos);
    it.flash.position.copy(pos);
    it.fire.position.copy(pos);
    it.shell.visible = it.flash.visible = it.fire.visible = true;
  }
  update(dt: number) {
    for (const it of this.items) {
      if (it.life <= 0) continue;
      it.life -= dt;
      const k = 1 - Math.max(0, it.life) / it.max; // 0 → 1
      if (it.life <= 0) {
        it.shell.visible = it.flash.visible = it.fire.visible = false;
        continue;
      }
      const r = it.radius * (0.2 + 0.8 * Math.sqrt(k));
      it.shell.scale.setScalar(r);
      (it.shell.material as THREE.MeshBasicMaterial).opacity = 0.45 * (1 - k) * (1 - k);
      it.flash.scale.setScalar(it.radius * (1.6 - k * 1.2));
      (it.flash.material as THREE.SpriteMaterial).opacity = Math.max(0, 1 - k * 4);
      it.fire.scale.setScalar(it.radius * (0.5 + k * 0.5));
      (it.fire.material as THREE.SpriteMaterial).opacity = 0.9 * (1 - k);
    }
  }
}

/**
 * Spin readout: a translucent ring in the plane of rotation (perpendicular to the angular-velocity axis), tinted by spin
 * kind, growing with spin rate. Together with the really-rotating seamed ball it makes the axis unmistakable.
 */
export class SpinRing {
  readonly mesh: THREE.Mesh;
  private axis = new THREE.Vector3(0, 1, 0);
  constructor(radius: number) {
    this.mesh = new THREE.Mesh(new THREE.TorusGeometry(radius * 1.35, radius * 0.11, 6, 36), new THREE.MeshBasicMaterial({ color: 0x9ad7ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.mesh.visible = false;
  }
  update(pos: THREE.Vector3, angVel: THREE.Vector3, color: number) {
    const rate = angVel.length();
    if (rate < 6) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;
    this.mesh.position.copy(pos);
    this.axis.copy(angVel).normalize();
    // Torus lies in the XY plane with normal +Z; align +Z to the spin axis.
    this.mesh.quaternion.setFromUnitVectors(_zAxis, this.axis);
    const mat = this.mesh.material as THREE.MeshBasicMaterial;
    mat.color.setHex(color);
    mat.opacity = Math.min(0.55, (rate - 6) / 90);
  }
  hide() {
    this.mesh.visible = false;
  }
}
const _zAxis = new THREE.Vector3(0, 0, 1);
