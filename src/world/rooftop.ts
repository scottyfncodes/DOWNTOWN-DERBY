import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { RAPIER as R } from '../engine/physics';
import { makeFacade, makeFenceTexture, makeRoofTexture } from './textures';
import { StaticRegistry } from './statics';
import { ROOF_Y } from '../logic/citylayout';

export const TOWER_W = 36;
export const TEE_POS = new THREE.Vector3(0, ROOF_Y + 1.02, -13.5);
export const BATTER_POS = new THREE.Vector3(1.25, ROOF_Y, -12.4);

export interface BatterRig {
  group: THREE.Group;
  swingPivot: THREE.Group;
  bat: THREE.Mesh;
  torso: THREE.Group;
  setPhase: (phase: 'idle' | 'windup' | 'swing' | 'follow', t: number) => void;
  setAimYaw: (yaw: number) => void;
}

export function buildRooftop(scene: THREE.Scene, world: RAPIER.World, statics: StaticRegistry, envMap: THREE.Texture | null): { group: THREE.Group; batter: BatterRig; collidable: THREE.Object3D[] } {
  const group = new THREE.Group();
  const collidable: THREE.Object3D[] = [];
  const f = makeFacade('tower', 21);
  const towerMat = new THREE.MeshStandardMaterial({ map: f.map, emissiveMap: f.emissive, emissive: 0xffffff, emissiveIntensity: 0.6, roughness: 0.35, metalness: 0.5, envMap });
  const tower = new THREE.Mesh(new THREE.BoxGeometry(TOWER_W, ROOF_Y, TOWER_W), towerMat);
  const uv = tower.geometry.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * TOWER_W) / f.tile[0], (uv.getY(i) * ROOF_Y) / f.tile[1]);
  tower.position.set(0, ROOF_Y / 2, 0);
  tower.castShadow = true;
  tower.receiveShadow = true;
  group.add(tower);
  collidable.push(tower);
  statics.register(world.createCollider(R.ColliderDesc.cuboid(TOWER_W / 2, ROOF_Y / 2, TOWER_W / 2).setTranslation(0, ROOF_Y / 2, 0).setFriction(0.7).setRestitution(0.4)), 'roof', ROOF_Y);

  // Roof surface
  const roofTex = makeRoofTexture(9);
  roofTex.repeat.set(6, 6);
  const roof = new THREE.Mesh(new THREE.PlaneGeometry(TOWER_W, TOWER_W), new THREE.MeshStandardMaterial({ map: roofTex, roughness: 0.95 }));
  roof.rotation.x = -Math.PI / 2;
  roof.position.set(0, ROOF_Y + 0.02, 0);
  roof.receiveShadow = true;
  group.add(roof);

  const trim = new THREE.MeshStandardMaterial({ color: 0x9a9184, roughness: 0.9 });
  const parapet = (w: number, d: number, x: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 1.1, d), trim);
    m.position.set(x, ROOF_Y + 0.55, z);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    statics.register(world.createCollider(R.ColliderDesc.cuboid(w / 2, 0.55, d / 2).setTranslation(x, ROOF_Y + 0.55, z).setRestitution(0.4)), 'roof', ROOF_Y + 1.1);
  };
  // Front parapet has a gap for the cage opening.
  const gap = 16;
  parapet((TOWER_W - gap) / 2, 0.6, -(gap / 2 + (TOWER_W - gap) / 4), -TOWER_W / 2 + 0.3);
  parapet((TOWER_W - gap) / 2, 0.6, gap / 2 + (TOWER_W - gap) / 4, -TOWER_W / 2 + 0.3);
  parapet(TOWER_W, 0.6, 0, TOWER_W / 2 - 0.3);
  parapet(0.6, TOWER_W, -TOWER_W / 2 + 0.3, 0);
  parapet(0.6, TOWER_W, TOWER_W / 2 - 0.3, 0);

  // Launch deck: a low rubber mat in front of the tee.
  const mat = new THREE.Mesh(new THREE.BoxGeometry(14, 0.08, 8), new THREE.MeshStandardMaterial({ color: 0x2d6a4f, roughness: 0.95 }));
  mat.position.set(0, ROOF_Y + 0.05, -14);
  mat.receiveShadow = true;
  group.add(mat);
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.04, 5), new THREE.MeshStandardMaterial({ color: 0xfff4e0, roughness: 0.8 }));
  plate.position.set(TEE_POS.x, ROOF_Y + 0.1, TEE_POS.z);
  group.add(plate);

  // Batter's box chalk lines either side of the plate.
  const chalk = new THREE.MeshStandardMaterial({ color: 0xfff4e0, roughness: 0.9 });
  for (const side of [-1, 1]) {
    const line = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.02, 2.4), chalk);
    line.position.set(TEE_POS.x + side * 1.6, ROOF_Y + 0.1, TEE_POS.z);
    group.add(line);
  }

  // Batting cage: posts + chain-link on back, sides and top. Open toward -Z.
  const cageW = 13;
  const cageD = 11;
  const cageH = 7.5;
  const cz = -9.5; // centre z
  const postMat = new THREE.MeshStandardMaterial({ color: 0x2b2f3a, roughness: 0.5, metalness: 0.7 });
  const fenceTex = makeFenceTexture();
  const fenceMat = new THREE.MeshStandardMaterial({ map: fenceTex, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.5, color: 0xd8dde6 });
  const fence = (w: number, h: number, pos: THREE.Vector3, rotY: number, rotX = 0) => {
    const g = new THREE.PlaneGeometry(w, h);
    const t = fenceTex.clone();
    t.needsUpdate = true;
    t.repeat.set(w / 1.2, h / 1.2);
    const m = new THREE.Mesh(g, fenceMat.clone());
    (m.material as THREE.MeshStandardMaterial).map = t;
    m.position.copy(pos);
    m.rotation.set(rotX, rotY, 0);
    group.add(m);
  };
  for (const [x, z] of [
    [-cageW / 2, cz + cageD / 2],
    [cageW / 2, cz + cageD / 2],
    [-cageW / 2, cz - cageD / 2],
    [cageW / 2, cz - cageD / 2],
  ]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, cageH, 8), postMat);
    p.position.set(x, ROOF_Y + cageH / 2, z);
    p.castShadow = true;
    group.add(p);
  }
  for (const [ax, az, bx, bz] of [
    [-cageW / 2, cz + cageD / 2, cageW / 2, cz + cageD / 2],
    [-cageW / 2, cz - cageD / 2, cageW / 2, cz - cageD / 2],
    [-cageW / 2, cz - cageD / 2, -cageW / 2, cz + cageD / 2],
    [cageW / 2, cz - cageD / 2, cageW / 2, cz + cageD / 2],
  ]) {
    const len = Math.hypot(bx - ax, bz - az);
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, len, 6), postMat);
    bar.position.set((ax + bx) / 2, ROOF_Y + cageH, (az + bz) / 2);
    bar.rotation.z = Math.PI / 2;
    bar.rotation.y = Math.atan2(bz - az, bx - ax) === 0 ? 0 : Math.PI / 2;
    group.add(bar);
  }
  fence(cageW, cageH, new THREE.Vector3(0, ROOF_Y + cageH / 2, cz + cageD / 2), 0); // back
  fence(cageD, cageH, new THREE.Vector3(-cageW / 2, ROOF_Y + cageH / 2, cz), Math.PI / 2); // left
  fence(cageD, cageH, new THREE.Vector3(cageW / 2, ROOF_Y + cageH / 2, cz), Math.PI / 2); // right
  // Cage colliders: back and sides only, so foul balls rattle around.
  const cageCol = (hx: number, hy: number, hz: number, x: number, y: number, z: number) =>
    statics.register(world.createCollider(R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setRestitution(0.35).setFriction(0.5)), 'cage', y + hy);
  cageCol(cageW / 2, cageH / 2, 0.05, 0, ROOF_Y + cageH / 2, cz + cageD / 2);
  cageCol(0.05, cageH / 2, cageD / 2, -cageW / 2, ROOF_Y + cageH / 2, cz);
  cageCol(0.05, cageH / 2, cageD / 2, cageW / 2, ROOF_Y + cageH / 2, cz);

  // Rooftop dressing: a shed, bench, ball bucket, light poles.
  const shed = new THREE.Mesh(new THREE.BoxGeometry(5, 3.2, 4), new THREE.MeshStandardMaterial({ color: 0x8e8578, roughness: 0.9 }));
  shed.position.set(12, ROOF_Y + 1.6, 12);
  shed.castShadow = true;
  group.add(shed);
  statics.register(world.createCollider(R.ColliderDesc.cuboid(2.5, 1.6, 2).setTranslation(12, ROOF_Y + 1.6, 12)), 'roof', ROOF_Y + 3.2);
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.3, 0.1), new THREE.MeshStandardMaterial({ color: 0x3d5a80, roughness: 0.7 }));
  door.position.set(12, ROOF_Y + 1.15, 9.95);
  group.add(door);
  const bucket = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.38, 0.7, 12, 1, true), new THREE.MeshStandardMaterial({ color: 0xffd166, roughness: 0.6, side: THREE.DoubleSide }));
  bucket.position.set(4.2, ROOF_Y + 0.35, -5);
  group.add(bucket);
  const ballMat = new THREE.MeshStandardMaterial({ color: 0xfff6e6, roughness: 0.6 });
  for (let i = 0; i < 7; i++) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), ballMat);
    b.position.set(4.2 + Math.cos(i * 1.7) * 0.22, ROOF_Y + 0.6 + (i % 2) * 0.12, -5 + Math.sin(i * 1.7) * 0.22);
    group.add(b);
  }
  const bench = new THREE.Mesh(new THREE.BoxGeometry(3, 0.12, 0.8), new THREE.MeshStandardMaterial({ color: 0xa67a4a, roughness: 0.85 }));
  bench.position.set(-6, ROOF_Y + 0.6, -3);
  bench.castShadow = true;
  group.add(bench);
  for (const [x, z] of [
    [-13, -13],
    [13, -13],
  ]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 7, 8), postMat);
    pole.position.set(x, ROOF_Y + 3.5, z);
    group.add(pole);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.4, 0.6), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff0c0, emissiveIntensity: 2 }));
    lamp.position.set(x > 0 ? x - 0.7 : x + 0.7, ROOF_Y + 7, z);
    lamp.rotation.z = x > 0 ? 0.3 : -0.3;
    group.add(lamp);
  }
  // A banner on the back fence.
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.6), new THREE.MeshStandardMaterial({ color: 0xff6b4a, roughness: 0.8, side: THREE.DoubleSide }));
  banner.position.set(0, ROOF_Y + 4.2, cz + cageD / 2 - 0.05);
  group.add(banner);

  const batter = buildBatter(envMap);
  batter.group.position.copy(BATTER_POS);
  group.add(batter.group);

  scene.add(group);
  return { group, batter, collidable };
}

function buildBatter(envMap: THREE.Texture | null): BatterRig {
  const group = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0xd8a27a, roughness: 0.7 });
  const jersey = new THREE.MeshStandardMaterial({ color: 0xfff4e0, roughness: 0.8 });
  const pants = new THREE.MeshStandardMaterial({ color: 0x3d405b, roughness: 0.8 });
  const helmetMat = new THREE.MeshStandardMaterial({ color: 0xff6b4a, roughness: 0.3, metalness: 0.2, envMap });
  const torso = new THREE.Group();
  torso.position.y = 1.0;
  group.add(torso);
  const legMat = pants;
  const leg = (x: number) => {
    const l = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.7, 4, 8), legMat);
    l.position.set(x, 0.52, 0);
    l.castShadow = true;
    group.add(l);
  };
  leg(-0.22);
  leg(0.22);
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.5, 4, 10), jersey);
  body.position.y = 0.45;
  body.castShadow = true;
  torso.add(body);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.12, 0.72), new THREE.MeshStandardMaterial({ color: 0xff6b4a }));
  stripe.position.y = 0.55;
  torso.add(stripe);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 12), skin);
  head.position.y = 1.08;
  head.castShadow = true;
  torso.add(head);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.27, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), helmetMat);
  helmet.position.y = 1.12;
  torso.add(helmet);
  const brim = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.05, 0.3), helmetMat);
  brim.position.set(0, 1.08, -0.3);
  torso.add(brim);

  // Arms + bat hang from a pivot near the shoulders.
  const swingPivot = new THREE.Group();
  swingPivot.position.set(0, 0.8, 0);
  torso.add(swingPivot);
  const armMat = jersey;
  const arm1 = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.5, 4, 8), armMat);
  arm1.position.set(-0.25, -0.1, -0.35);
  arm1.rotation.set(1.3, 0, 0.5);
  const arm2 = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.5, 4, 8), armMat);
  arm2.position.set(-0.05, -0.05, -0.45);
  arm2.rotation.set(1.3, 0, 0.2);
  swingPivot.add(arm1, arm2);
  const hands = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), skin);
  hands.position.set(-0.3, 0.05, -0.6);
  swingPivot.add(hands);
  const batMat = new THREE.MeshStandardMaterial({ color: 0xc9924e, roughness: 0.4, metalness: 0.05, envMap });
  const bat = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.028, 1.05, 12), batMat);
  const batGroup = new THREE.Group();
  batGroup.position.copy(hands.position);
  bat.position.y = 0.55;
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.22, 8), new THREE.MeshStandardMaterial({ color: 0x1f1f24, roughness: 0.9 }));
  grip.position.y = 0.05;
  const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.03, 10), new THREE.MeshStandardMaterial({ color: 0x1f1f24 }));
  knob.position.y = -0.06;
  batGroup.add(bat, grip, knob);
  bat.castShadow = true;
  batGroup.rotation.set(-0.7, 0, 0.5);
  swingPivot.add(batGroup);

  const setPhase = (phase: 'idle' | 'windup' | 'swing' | 'follow', t: number) => {
    // t = 0..1 progress within the phase
    if (phase === 'idle') {
      swingPivot.rotation.y = 0.55 + Math.sin(t * Math.PI * 2) * 0.03;
      torso.rotation.y = 0;
      batGroup.rotation.set(-0.7 + Math.sin(t * Math.PI * 2) * 0.03, 0, 0.5);
    } else if (phase === 'windup') {
      const e = 1 - Math.pow(1 - Math.min(1, t), 3);
      swingPivot.rotation.y = 0.55 + e * 0.75;
      torso.rotation.y = e * 0.35;
      batGroup.rotation.set(-0.9 - e * 0.3, 0, 0.5 + e * 0.2);
    } else if (phase === 'swing') {
      const e = Math.min(1, t);
      swingPivot.rotation.y = 1.3 - e * 3.6;
      torso.rotation.y = 0.35 - e * 1.2;
      batGroup.rotation.set(-1.2 + e * 1.0, 0, 0.7 - e * 0.9);
    } else {
      const e = Math.min(1, t);
      swingPivot.rotation.y = -2.3 + e * 2.85;
      torso.rotation.y = -0.85 + e * 0.85;
      batGroup.rotation.set(-0.2 - e * 0.5, 0, -0.2 + e * 0.7);
    }
  };
  const setAimYaw = (yaw: number) => {
    group.rotation.y = -yaw * 0.6;
  };
  return { group, swingPivot, bat, torso, setPhase, setAimYaw };
}
