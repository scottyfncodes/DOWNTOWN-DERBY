import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { RAPIER as R } from '../engine/physics';
import type { MaterialKind, Vec3 } from '../logic/types';
import { InstancedBatch } from './batch';
import { makeBillboardTexture, makeNeonSignTexture } from './textures';
import { createRng } from '../logic/rng';

export type PropState = 'intact' | 'damaged' | 'destroyed';

interface Part {
  batch: InstancedBatch;
  index: number;
  local: THREE.Matrix4;
}

export interface Prop {
  id: string;
  material: MaterialKind;
  body: RAPIER.RigidBody;
  colliders: RAPIER.Collider[];
  colliderDescs: RAPIER.ColliderDesc[];
  parts: Part[];
  meshes: THREE.Object3D[];
  initialPos: THREE.Vector3;
  initialRot: THREE.Quaternion;
  initialDynamic: boolean;
  /** relative speed needed to detach/topple/launch (0 = never) */
  detachSpeed: number;
  /** relative speed needed to shatter/break apart (0 = never) */
  breakSpeed: number;
  state: PropState;
  bonus: boolean;
  size: THREE.Vector3;
  removed: boolean;
  hits: number;
  color?: THREE.Color;
  /** velocity captured before the last physics step (dynamic props only) */
  prevVel: THREE.Vector3;
}

export interface HitOutcome {
  destroyed: boolean;
  /** 'shatter' | 'break' | 'detach' | 'shove' | 'none' */
  effect: 'shatter' | 'break' | 'detach' | 'shove' | 'none';
}

const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3(1, 1, 1);

export class PropManager {
  readonly props: Prop[] = [];
  readonly byCollider = new Map<number, Prop>();
  readonly byBody = new Map<number, Prop>();
  readonly group = new THREE.Group();
  private batches = new Map<string, InstancedBatch>();
  private nextId = 1;
  private rng = createRng(77);
  private debris: { body: RAPIER.RigidBody; part: Part; life: number }[] = [];
  private mats: Record<string, THREE.Material>;
  private geos: Record<string, THREE.BufferGeometry>;
  bonusProp: Prop | null = null;
  private bonusBeacon: THREE.Group | null = null;
  onBeacon?: (pos: THREE.Vector3) => void;

  constructor(private world: RAPIER.World, envMap: THREE.Texture | null, private quality: { fragments: number }) {
    const std = (color: number, rough = 0.6, metal = 0.1, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
      new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, envMap, ...extra });
    this.mats = {
      metal: std(0xb9bec7, 0.45, 0.7),
      darkMetal: std(0x4b5058, 0.5, 0.6),
      wood: std(0xb98652, 0.8, 0),
      barrel: std(0xffffff, 0.5, 0.3),
      car: std(0xffffff, 0.35, 0.5),
      glassDark: std(0x1c2a3a, 0.2, 0.8),
      rubber: std(0x1f1f22, 0.9, 0),
      pole: std(0x38405a, 0.6, 0.5),
      lamp: new THREE.MeshStandardMaterial({ color: 0xfff0c0, emissive: 0xffd080, emissiveIntensity: 1.6, roughness: 0.4 }),
      tank: std(0x8a5a3c, 0.8, 0.05),
      tankRoof: std(0x4a3a30, 0.8, 0.05),
      awning: std(0xd9483b, 0.85, 0),
      awning2: std(0x2f7f6f, 0.85, 0),
      scaffold: std(0xc8a24a, 0.5, 0.6),
      plank: std(0xa67a4a, 0.85, 0),
      antenna: std(0xd0d4dc, 0.5, 0.7),
      glass: new THREE.MeshStandardMaterial({
        color: 0x9fd4ff,
        roughness: 0.08,
        metalness: 0.85,
        envMap,
        transparent: true,
        opacity: 0.82,
        emissive: 0x1b4e73,
        emissiveIntensity: 0.25,
        side: THREE.DoubleSide,
      }),
      debris: std(0x8f6a45, 0.9, 0),
      beacon: new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }),
    };
    this.geos = {
      box: new THREE.BoxGeometry(1, 1, 1),
      cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 14),
      cylLow: new THREE.CylinderGeometry(0.5, 0.5, 1, 8),
      cone: new THREE.ConeGeometry(0.5, 1, 14),
      wheel: new THREE.CylinderGeometry(0.5, 0.5, 1, 12).rotateZ(Math.PI / 2),
    };
    const batch = (key: string, geo: THREE.BufferGeometry, mat: THREE.Material, cap: number, shadows = true) => {
      const b = new InstancedBatch(geo, mat, cap, shadows);
      b.mesh.name = key;
      this.batches.set(key, b);
      this.group.add(b.mesh);
      return b;
    };
    batch('hvacBody', this.geos.box, this.mats.metal, 320);
    batch('hvacFan', this.geos.cylLow, this.mats.darkMetal, 640);
    batch('crate', this.geos.box, this.mats.wood, 260);
    batch('barrel', this.geos.cyl, this.mats.barrel, 260);
    batch('carBody', this.geos.box, this.mats.car, 200);
    batch('carCabin', this.geos.box, this.mats.glassDark, 200);
    batch('wheel', this.geos.wheel, this.mats.rubber, 800, false);
    batch('pole', this.geos.cylLow, this.mats.pole, 800);
    batch('lamp', this.geos.box, this.mats.lamp, 80, false);
    batch('tank', this.geos.cyl, this.mats.tank, 90);
    batch('tankRoof', this.geos.cone, this.mats.tankRoof, 90);
    batch('tankLeg', this.geos.box, this.mats.darkMetal, 450);
    batch('antenna', this.geos.cylLow, this.mats.antenna, 300);
    batch('awning', this.geos.box, this.mats.awning, 80);
    batch('awning2', this.geos.box, this.mats.awning2, 80);
    batch('scaffold', this.geos.cylLow, this.mats.scaffold, 600, false);
    batch('plank', this.geos.box, this.mats.plank, 120);
    batch('glass', this.geos.box, this.mats.glass, 1500, false);
    batch('debris', this.geos.box, this.mats.debris, 24);
    batch('billboardBack', this.geos.box, this.mats.darkMetal, 120);
    for (let i = 0; i < 20; i++) this.makeDebris();
  }

  private batch(key: string): InstancedBatch {
    return this.batches.get(key)!;
  }

  private newProp(material: MaterialKind, pos: THREE.Vector3, rotY: number, dynamic: boolean, size: THREE.Vector3, opts: { detach?: number; break?: number; damping?: number; canSleep?: boolean } = {}): Prop {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
    const desc = (dynamic ? R.RigidBodyDesc.dynamic() : R.RigidBodyDesc.fixed())
      .setTranslation(pos.x, pos.y, pos.z)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setLinearDamping(opts.damping ?? 0.15)
      .setAngularDamping(0.6)
      .setCanSleep(true);
    const body = this.world.createRigidBody(desc);
    if (dynamic) body.sleep();
    const prop: Prop = {
      id: `${material}-${this.nextId++}`,
      material,
      body,
      colliders: [],
      colliderDescs: [],
      parts: [],
      meshes: [],
      initialPos: pos.clone(),
      initialRot: q,
      initialDynamic: dynamic,
      detachSpeed: opts.detach ?? 0,
      breakSpeed: opts.break ?? 0,
      state: 'intact',
      bonus: false,
      size,
      removed: false,
      hits: 0,
      prevVel: new THREE.Vector3(),
    };
    this.byBody.set(body.handle, prop);
    this.props.push(prop);
    return prop;
  }

  private addCollider(prop: Prop, desc: RAPIER.ColliderDesc): RAPIER.Collider {
    desc.setActiveEvents(R.ActiveEvents.COLLISION_EVENTS);
    const c = this.world.createCollider(desc, prop.body);
    prop.colliders.push(c);
    prop.colliderDescs.push(desc);
    this.byCollider.set(c.handle, prop);
    return c;
  }

  private addPart(prop: Prop, key: string, local: THREE.Matrix4, color?: THREE.Color): void {
    const b = this.batch(key);
    _m.compose(prop.initialPos, prop.initialRot, _s).multiply(local);
    const index = b.add(_m, color);
    prop.parts.push({ batch: b, index, local: local.clone() });
  }

  private local(x: number, y: number, z: number, sx: number, sy: number, sz: number, rx = 0, ry = 0, rz = 0): THREE.Matrix4 {
    return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
  }

  // ---------- Factories ----------

  hvac(pos: THREE.Vector3, rotY: number, scale = 1): Prop {
    const w = 2.4 * scale;
    const h = 1.6 * scale;
    const prop = this.newProp('hvac', pos.clone().add(new THREE.Vector3(0, h / 2, 0)), rotY, true, new THREE.Vector3(w, h, w), { detach: 0, break: 0 });
    this.addCollider(prop, R.ColliderDesc.cuboid(w / 2, h / 2, w / 2).setDensity(45).setFriction(0.8).setRestitution(0.2));
    this.addPart(prop, 'hvacBody', this.local(0, 0, 0, w, h, w));
    this.addPart(prop, 'hvacFan', this.local(0, h / 2 + 0.06, 0, w * 0.7, 0.12, w * 0.7));
    this.addPart(prop, 'hvacFan', this.local(0, -h * 0.1, w / 2 + 0.02, w * 0.6, h * 0.5, 0.05, Math.PI / 2));
    return prop;
  }

  crate(pos: THREE.Vector3, rotY: number, size = 1.4): Prop {
    const prop = this.newProp('crate', pos.clone().add(new THREE.Vector3(0, size / 2, 0)), rotY, true, new THREE.Vector3(size, size, size), { break: 11 });
    this.addCollider(prop, R.ColliderDesc.cuboid(size / 2, size / 2, size / 2).setDensity(18).setFriction(0.7).setRestitution(0.25));
    this.addPart(prop, 'crate', this.local(0, 0, 0, size, size, size));
    return prop;
  }

  barrel(pos: THREE.Vector3, color: THREE.Color): Prop {
    const prop = this.newProp('barrel', pos.clone().add(new THREE.Vector3(0, 0.6, 0)), 0, true, new THREE.Vector3(1, 1.2, 1), { detach: 18 });
    this.addCollider(prop, R.ColliderDesc.cylinder(0.6, 0.5).setDensity(30).setFriction(0.5).setRestitution(0.35));
    this.addPart(prop, 'barrel', this.local(0, 0, 0, 1, 1.2, 1), color);
    prop.color = color;
    return prop;
  }

  car(pos: THREE.Vector3, rotY: number, color: THREE.Color): Prop {
    const prop = this.newProp('car', pos.clone().add(new THREE.Vector3(0, 0.75, 0)), rotY, true, new THREE.Vector3(4.4, 1.5, 1.9), { detach: 20, damping: 0.8 });
    this.addCollider(prop, R.ColliderDesc.cuboid(2.2, 0.45, 0.95).setTranslation(0, 0.1, 0).setDensity(95).setFriction(0.9).setRestitution(0.3));
    this.addCollider(prop, R.ColliderDesc.cuboid(1.1, 0.4, 0.85).setTranslation(-0.1, 0.9, 0).setDensity(20).setFriction(0.9).setRestitution(0.3));
    this.addPart(prop, 'carBody', this.local(0, 0.1, 0, 4.4, 0.9, 1.9), color);
    this.addPart(prop, 'carCabin', this.local(-0.1, 0.9, 0, 2.2, 0.8, 1.7));
    for (const [x, z] of [
      [1.4, 0.95],
      [-1.4, 0.95],
      [1.4, -0.95],
      [-1.4, -0.95],
    ]) {
      this.addPart(prop, 'wheel', this.local(x, -0.35, z, 0.3, 0.75, 0.75));
    }
    prop.color = color;
    return prop;
  }

  streetlight(pos: THREE.Vector3, rotY: number): Prop {
    const h = 8;
    const prop = this.newProp('streetlight', pos.clone().add(new THREE.Vector3(0, h / 2, 0)), rotY, false, new THREE.Vector3(0.4, h, 0.4), { detach: 9 });
    this.addCollider(prop, R.ColliderDesc.cylinder(h / 2, 0.18).setDensity(12).setFriction(0.5).setRestitution(0.2));
    this.addCollider(prop, R.ColliderDesc.cuboid(1.4, 0.12, 0.12).setTranslation(1.3, h / 2 - 0.2, 0).setDensity(8));
    this.addPart(prop, 'pole', this.local(0, 0, 0, 0.36, h, 0.36));
    this.addPart(prop, 'pole', this.local(1.3, h / 2 - 0.2, 0, 2.8, 0.2, 0.2));
    this.addPart(prop, 'lamp', this.local(2.5, h / 2 - 0.45, 0, 0.9, 0.3, 0.5));
    return prop;
  }

  waterTower(pos: THREE.Vector3, rotY: number): Prop {
    const prop = this.newProp('watertower', pos.clone().add(new THREE.Vector3(0, 4.2, 0)), rotY, false, new THREE.Vector3(5.2, 9, 5.2), { detach: 14 });
    this.addCollider(prop, R.ColliderDesc.cylinder(2.2, 2.6).setTranslation(0, 2.2, 0).setDensity(28).setFriction(0.6).setRestitution(0.2));
    this.addCollider(prop, R.ColliderDesc.cuboid(1.8, 2.1, 1.8).setTranslation(0, -2.1, 0).setDensity(6).setFriction(0.6));
    this.addPart(prop, 'tank', this.local(0, 2.2, 0, 5.2, 4.4, 5.2));
    this.addPart(prop, 'tankRoof', this.local(0, 5.2, 0, 5.6, 1.6, 5.6));
    for (const [x, z] of [
      [1.6, 1.6],
      [-1.6, 1.6],
      [1.6, -1.6],
      [-1.6, -1.6],
    ]) {
      this.addPart(prop, 'tankLeg', this.local(x, -2.1, z, 0.32, 4.2, 0.32));
    }
    this.addPart(prop, 'tankLeg', this.local(0, -0.2, 0, 3.6, 0.2, 3.6));
    return prop;
  }

  antenna(pos: THREE.Vector3, height = 7): Prop {
    const prop = this.newProp('antenna', pos.clone().add(new THREE.Vector3(0, height / 2, 0)), 0, false, new THREE.Vector3(0.4, height, 0.4), { detach: 5 });
    this.addCollider(prop, R.ColliderDesc.cylinder(height / 2, 0.22).setDensity(6).setFriction(0.5).setRestitution(0.3));
    this.addPart(prop, 'antenna', this.local(0, 0, 0, 0.3, height, 0.3));
    this.addPart(prop, 'antenna', this.local(0, height * 0.2, 0, 1.6, 0.1, 0.1));
    this.addPart(prop, 'antenna', this.local(0, height * 0.45, 0, 1.1, 0.1, 0.1));
    return prop;
  }

  awning(pos: THREE.Vector3, rotY: number, width: number, alt: boolean): Prop {
    const prop = this.newProp('awning', pos.clone(), rotY, false, new THREE.Vector3(width, 0.2, 2.4), { detach: 7 });
    this.addCollider(prop, R.ColliderDesc.cuboid(width / 2, 0.1, 1.2).setRotation(quatX(-0.35)).setDensity(4).setFriction(0.6).setRestitution(0.4));
    this.addPart(prop, alt ? 'awning2' : 'awning', this.local(0, 0, 0, width, 0.2, 2.4, -0.35));
    this.addPart(prop, 'pole', this.local(-width / 2 + 0.3, -0.4, 0.8, 0.12, 1.2, 0.12, -0.35));
    this.addPart(prop, 'pole', this.local(width / 2 - 0.3, -0.4, 0.8, 0.12, 1.2, 0.12, -0.35));
    return prop;
  }

  plank(pos: THREE.Vector3, rotY: number, length = 3): Prop {
    const prop = this.newProp('plank', pos.clone(), rotY, true, new THREE.Vector3(length, 0.1, 0.9), { detach: 10 });
    this.addCollider(prop, R.ColliderDesc.cuboid(length / 2, 0.05, 0.45).setDensity(14).setFriction(0.7).setRestitution(0.2));
    this.addPart(prop, 'plank', this.local(0, 0, 0, length, 0.1, 0.9));
    return prop;
  }

  /** Static scaffold frame: visual bars + one fixed collider body. Scores as a hit but never moves. */
  scaffoldFrame(pos: THREE.Vector3, rotY: number, width: number, height: number, depth: number): Prop {
    const prop = this.newProp('scaffold', pos.clone().add(new THREE.Vector3(0, height / 2, 0)), rotY, false, new THREE.Vector3(width, height, depth), {});
    const cols = Math.max(2, Math.round(width / 3) + 1);
    for (let i = 0; i < cols; i++) {
      const x = -width / 2 + (width / (cols - 1)) * i;
      for (const z of [-depth / 2, depth / 2]) {
        this.addPart(prop, 'scaffold', this.local(x, 0, z, 0.14, height, 0.14));
        this.addCollider(prop, R.ColliderDesc.cylinder(height / 2, 0.08).setTranslation(x, 0, z).setFriction(0.5).setRestitution(0.5));
      }
    }
    const levels = Math.max(1, Math.floor(height / 3));
    for (let l = 0; l <= levels; l++) {
      const y = -height / 2 + l * (height / levels);
      for (const z of [-depth / 2, depth / 2]) this.addPart(prop, 'scaffold', this.local(0, y, z, width, 0.12, 0.12));
      for (let i = 0; i < cols; i++) {
        const x = -width / 2 + (width / (cols - 1)) * i;
        this.addPart(prop, 'scaffold', this.local(x, y, 0, 0.12, 0.12, depth));
      }
    }
    return prop;
  }

  billboard(pos: THREE.Vector3, rotY: number, width: number, height: number, design: { text: string; sub: string; bg: string; fg: string }, seed: number): Prop {
    const postH = 3;
    const prop = this.newProp('billboard', pos.clone().add(new THREE.Vector3(0, postH + height / 2, 0)), rotY, false, new THREE.Vector3(width, height + postH, 0.6), { detach: 13 });
    this.addCollider(prop, R.ColliderDesc.cuboid(width / 2, height / 2, 0.25).setDensity(9).setFriction(0.6).setRestitution(0.4));
    this.addCollider(prop, R.ColliderDesc.cuboid(0.2, postH / 2, 0.2).setTranslation(-width * 0.3, -height / 2 - postH / 2, 0).setDensity(6));
    this.addCollider(prop, R.ColliderDesc.cuboid(0.2, postH / 2, 0.2).setTranslation(width * 0.3, -height / 2 - postH / 2, 0).setDensity(6));
    this.addPart(prop, 'billboardBack', this.local(0, 0, -0.12, width, height, 0.3));
    this.addPart(prop, 'pole', this.local(-width * 0.3, -height / 2 - postH / 2, 0, 0.4, postH, 0.4));
    this.addPart(prop, 'pole', this.local(width * 0.3, -height / 2 - postH / 2, 0, 0.4, postH, 0.4));
    this.addPart(prop, 'pole', this.local(0, height / 2 + 0.2, 0.5, width * 0.9, 0.12, 0.12));
    // Face: individual mesh so every billboard gets its own art.
    const texture = makeBillboardTexture(seed, design.text, design.sub, design.bg, design.fg);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshStandardMaterial({ map: texture, emissiveMap: texture, emissive: 0xffffff, emissiveIntensity: 0.35, roughness: 0.6 }));
    face.position.set(0, 0, 0.06);
    const holder = new THREE.Group();
    holder.add(face);
    holder.position.copy(prop.initialPos);
    holder.quaternion.copy(prop.initialRot);
    holder.castShadow = true;
    this.group.add(holder);
    prop.meshes.push(holder);
    return prop;
  }

  neonSign(pos: THREE.Vector3, rotY: number, text: string, color: string): Prop {
    const h = 6;
    const prop = this.newProp('sign', pos.clone(), rotY, false, new THREE.Vector3(1.3, h, 0.5), { detach: 9 });
    this.addCollider(prop, R.ColliderDesc.cuboid(0.65, h / 2, 0.25).setDensity(10).setFriction(0.5).setRestitution(0.4));
    this.addCollider(prop, R.ColliderDesc.cuboid(0.1, 0.1, 0.5).setTranslation(0, h / 2 - 0.5, -0.5).setDensity(4));
    const texture = makeNeonSignTexture(text, color);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.3, h, 0.5), [
      this.mats.darkMetal,
      this.mats.darkMetal,
      this.mats.darkMetal,
      this.mats.darkMetal,
      new THREE.MeshStandardMaterial({ map: texture, emissiveMap: texture, emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.5 }),
      new THREE.MeshStandardMaterial({ map: texture, emissiveMap: texture, emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.5 }),
    ]);
    mesh.castShadow = true;
    const holder = new THREE.Group();
    holder.add(mesh);
    const bracket = new THREE.Mesh(this.geos.box, this.mats.darkMetal);
    bracket.scale.set(0.2, 0.2, 1);
    bracket.position.set(0, h / 2 - 0.5, -0.5);
    holder.add(bracket);
    holder.position.copy(prop.initialPos);
    holder.quaternion.copy(prop.initialRot);
    this.group.add(holder);
    prop.meshes.push(holder);
    return prop;
  }

  glassPanel(pos: THREE.Vector3, rotY: number, width: number, height: number): Prop {
    const prop = this.newProp('glass', pos.clone(), rotY, false, new THREE.Vector3(width, height, 0.25), { break: 7 });
    this.addCollider(prop, R.ColliderDesc.cuboid(width / 2, height / 2, 0.12).setFriction(0.2).setRestitution(0.5));
    this.addPart(prop, 'glass', this.local(0, 0, 0, width - 0.25, height - 0.25, 0.2));
    return prop;
  }

  // ---------- Behaviour ----------

  /**
   * Applies a hit to a prop. `speed` is the relative impact speed, `impulse` the momentum to inject (world space).
   * Returns the destructive outcome so the caller can score/feedback.
   */
  applyHit(prop: Prop, speed: number, impulse: THREE.Vector3, point: THREE.Vector3, direct: boolean): HitOutcome {
    if (prop.removed) return { destroyed: false, effect: 'none' };
    prop.hits++;
    const wasIntact = prop.state !== 'destroyed';
    // Glass shatters.
    if (prop.material === 'glass') {
      const threshold = direct ? prop.breakSpeed : 6;
      if (speed >= threshold) {
        this.removeProp(prop);
        prop.state = 'destroyed';
        return { destroyed: true, effect: 'shatter' };
      }
      return { destroyed: false, effect: 'none' };
    }
    // Crates break into debris.
    if (prop.breakSpeed > 0 && speed >= prop.breakSpeed) {
      const pos = prop.body.translation();
      this.removeProp(prop);
      prop.state = 'destroyed';
      this.spawnDebris(new THREE.Vector3(pos.x, pos.y, pos.z), impulse, 4);
      return { destroyed: true, effect: 'break' };
    }
    // Fixed props detach and become dynamic.
    const isFixed = prop.body.bodyType() === R.RigidBodyType.Fixed;
    if (isFixed) {
      if (prop.detachSpeed > 0 && speed >= prop.detachSpeed) {
        prop.body.setBodyType(R.RigidBodyType.Dynamic, true);
        prop.body.applyImpulseAtPoint({ x: impulse.x, y: impulse.y + Math.abs(impulse.length()) * 0.15, z: impulse.z }, point, true);
        prop.state = 'destroyed';
        return { destroyed: wasIntact, effect: 'detach' };
      }
      if (prop.state === 'intact') prop.state = 'damaged';
      return { destroyed: false, effect: 'none' };
    }
    // Dynamic props get shoved; big hits count as destroyed (launched/totaled).
    prop.body.wakeUp();
    prop.body.applyImpulseAtPoint({ x: impulse.x, y: impulse.y, z: impulse.z }, point, true);
    if (prop.material === 'car' && prop.state === 'intact') {
      prop.state = 'damaged';
      this.setDamagedColor(prop);
    }
    if (prop.detachSpeed > 0 && speed >= prop.detachSpeed && prop.state !== 'destroyed') {
      prop.state = 'destroyed';
      return { destroyed: true, effect: 'shove' };
    }
    if (prop.material === 'hvac' && speed >= 12 && prop.state !== 'destroyed') {
      prop.state = 'destroyed';
      return { destroyed: true, effect: 'shove' };
    }
    return { destroyed: false, effect: 'shove' };
  }

  private setDamagedColor(prop: Prop) {
    if (!prop.color) return;
    const c = prop.color.clone().multiplyScalar(0.55);
    for (const part of prop.parts) if (part.batch === this.batch('carBody')) part.batch.setColor(part.index, c);
  }

  private removeProp(prop: Prop) {
    prop.removed = true;
    for (const c of prop.colliders) {
      this.byCollider.delete(c.handle);
      this.world.removeCollider(c, true);
    }
    prop.colliders = [];
    for (const part of prop.parts) part.batch.hide(part.index);
    for (const m of prop.meshes) m.visible = false;
  }

  private restoreProp(prop: Prop) {
    if (!prop.removed) return;
    prop.removed = false;
    for (const desc of prop.colliderDescs) {
      const c = this.world.createCollider(desc, prop.body);
      prop.colliders.push(c);
      this.byCollider.set(c.handle, prop);
    }
    for (const m of prop.meshes) m.visible = true;
  }

  private makeDebris() {
    const desc = R.RigidBodyDesc.dynamic().setTranslation(0, -200, 0).setCanSleep(true).setLinearDamping(0.2).setAngularDamping(0.5);
    const body = this.world.createRigidBody(desc);
    this.world.createCollider(R.ColliderDesc.cuboid(0.3, 0.3, 0.3).setDensity(10).setFriction(0.7).setRestitution(0.3), body);
    body.setEnabled(false);
    const b = this.batch('debris');
    const local = this.local(0, 0, 0, 0.6, 0.6, 0.6);
    const index = b.add(new THREE.Matrix4().makeScale(0, 0, 0));
    this.debris.push({ body, part: { batch: b, index, local }, life: 0 });
  }

  spawnDebris(center: THREE.Vector3, impulse: THREE.Vector3, count: number) {
    let spawned = 0;
    for (const d of this.debris) {
      if (spawned >= count) break;
      if (d.life > 0) continue;
      d.life = 4;
      d.body.setEnabled(true);
      d.body.setTranslation({ x: center.x + (this.rng.next() - 0.5) * 0.8, y: center.y + this.rng.next() * 0.6, z: center.z + (this.rng.next() - 0.5) * 0.8 }, true);
      d.body.setLinvel({ x: impulse.x * 0.03 + (this.rng.next() - 0.5) * 4, y: 3 + this.rng.next() * 4, z: impulse.z * 0.03 + (this.rng.next() - 0.5) * 4 }, true);
      d.body.setAngvel({ x: this.rng.range(-8, 8), y: this.rng.range(-8, 8), z: this.rng.range(-8, 8) }, true);
      spawned++;
    }
  }

  setBonus(prop: Prop | null) {
    if (this.bonusProp) this.bonusProp.bonus = false;
    this.bonusProp = prop;
    if (!this.bonusBeacon) {
      this.bonusBeacon = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.RingGeometry(3.5, 4.4, 32), this.mats.beacon);
      ring.rotation.x = -Math.PI / 2;
      ring.name = 'ring';
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.6, 40, 10, 1, true), new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
      beam.position.y = 20;
      beam.name = 'beam';
      this.bonusBeacon.add(ring, beam);
      this.group.add(this.bonusBeacon);
    }
    if (prop) {
      prop.bonus = true;
      const p = prop.initialPos;
      this.bonusBeacon.position.set(p.x, p.y - prop.size.y / 2 + 0.3, p.z);
      this.bonusBeacon.visible = true;
    } else {
      this.bonusBeacon.visible = false;
    }
  }

  update(dt: number, elapsed: number) {
    // Dynamic props: sync visuals with awake bodies.
    for (const prop of this.props) {
      if (prop.removed) continue;
      const body = prop.body;
      if (body.bodyType() !== R.RigidBodyType.Dynamic || body.isSleeping()) continue;
      const t = body.translation();
      const r = body.rotation();
      _p.set(t.x, t.y, t.z);
      _q.set(r.x, r.y, r.z, r.w);
      _m.compose(_p, _q, _s);
      for (const part of prop.parts) {
        _m2.multiplyMatrices(_m, part.local);
        part.batch.set(part.index, _m2);
      }
      for (const m of prop.meshes) {
        m.position.copy(_p);
        m.quaternion.copy(_q);
      }
      // Fell off the world: freeze it.
      if (t.y < -30) {
        body.setEnabled(false);
        this.removeProp(prop);
      }
    }
    for (const d of this.debris) {
      if (d.life <= 0) continue;
      d.life -= dt;
      const t = d.body.translation();
      const r = d.body.rotation();
      _p.set(t.x, t.y, t.z);
      _q.set(r.x, r.y, r.z, r.w);
      const fade = Math.min(1, d.life);
      _m.compose(_p, _q, new THREE.Vector3(fade, fade, fade));
      d.part.batch.set(d.part.index, _m.multiply(d.part.local));
      if (d.life <= 0) {
        d.body.setEnabled(false);
        d.part.batch.hide(d.part.index);
      }
    }
    if (this.bonusBeacon && this.bonusBeacon.visible) {
      const ring = this.bonusBeacon.getObjectByName('ring');
      if (ring) {
        const s = 1 + 0.15 * Math.sin(elapsed * 4);
        ring.scale.set(s, s, 1);
        ring.rotation.z = elapsed * 0.8;
      }
      const beam = this.bonusBeacon.getObjectByName('beam') as THREE.Mesh | undefined;
      if (beam) (beam.material as THREE.MeshBasicMaterial).opacity = 0.14 + 0.08 * Math.sin(elapsed * 3);
    }
  }

  /** Restores every prop to its initial state. */
  reset() {
    for (const prop of this.props) {
      const body = prop.body;
      body.setEnabled(true);
      if (body.bodyType() === R.RigidBodyType.Dynamic && !prop.initialDynamic) body.setBodyType(R.RigidBodyType.Fixed, false);
      const p = prop.initialPos;
      const q = prop.initialRot;
      body.setTranslation({ x: p.x, y: p.y, z: p.z }, false);
      body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, false);
      if (prop.initialDynamic) {
        body.setLinvel({ x: 0, y: 0, z: 0 }, false);
        body.setAngvel({ x: 0, y: 0, z: 0 }, false);
        body.sleep();
      }
      this.restoreProp(prop);
      prop.state = 'intact';
      prop.hits = 0;
      prop.bonus = false;
      _m.compose(p, q, _s);
      for (const part of prop.parts) {
        _m2.multiplyMatrices(_m, part.local);
        part.batch.set(part.index, _m2);
        if (prop.color) part.batch.setColor(part.index, prop.color);
      }
      for (const m of prop.meshes) {
        m.position.copy(p);
        m.quaternion.copy(q);
      }
    }
    for (const d of this.debris) {
      d.life = 0;
      d.body.setEnabled(false);
      d.part.batch.hide(d.part.index);
    }
  }

  /** Captures pre-step velocities of awake dynamic props for impact-speed estimates. */
  storeVelocities() {
    for (const prop of this.props) {
      if (prop.removed) continue;
      const body = prop.body;
      if (body.bodyType() !== R.RigidBodyType.Dynamic || body.isSleeping()) {
        prop.prevVel.set(0, 0, 0);
        continue;
      }
      const v = body.linvel();
      prop.prevVel.set(v.x, v.y, v.z);
    }
  }

  /** Count of awake dynamic bodies (for resolve heuristics / perf). */
  awakeCount(): number {
    let n = 0;
    for (const prop of this.props) if (!prop.removed && prop.body.bodyType() === R.RigidBodyType.Dynamic && !prop.body.isSleeping()) n++;
    return n;
  }

  get fragmentBudget() {
    return this.quality.fragments;
  }
}

function quatX(angle: number) {
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), angle);
  return { x: q.x, y: q.y, z: q.z, w: q.w };
}

export function toVec3(v: THREE.Vector3): Vec3 {
  return { x: v.x, y: v.y, z: v.z };
}
