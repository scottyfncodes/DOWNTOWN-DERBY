import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { RAPIER as R } from '../engine/physics';
import { makeFacade, makeRoofTexture } from './textures';
import { StaticRegistry } from './statics';
import { ROOF_Y } from '../logic/citylayout';

/** The pitcher's rooftop: a narrow tower across the street from the batting cage. */
export const MOUND_W = 9;
export const MOUND_D = 8;
export const MOUND_Z = -29;
/** A storey below the cage so line drives clear it. */
export const MOUND_Y = ROOF_Y - 5.5;
export const PITCHER_POS = new THREE.Vector3(0.4, MOUND_Y, MOUND_Z + 0.6);
/** Where the ball leaves the pitcher's hand. */
export const RELEASE_POS = new THREE.Vector3(0.75, MOUND_Y + 2.05, MOUND_Z + 2.2);

export type PitcherPhase = 'idle' | 'windup' | 'release' | 'follow';

export interface PitcherRig {
  group: THREE.Group;
  setPhase: (phase: PitcherPhase, t: number) => void;
  /** glove-hand ball shown before release */
  heldBall: THREE.Mesh;
}

export function buildPitcherMound(scene: THREE.Scene, world: RAPIER.World, statics: StaticRegistry, envMap: THREE.Texture | null): { group: THREE.Group; pitcher: PitcherRig; collidable: THREE.Object3D[] } {
  const group = new THREE.Group();
  const collidable: THREE.Object3D[] = [];
  const f = makeFacade('concrete', 23);
  const mat = new THREE.MeshStandardMaterial({ map: f.map, emissiveMap: f.emissive, emissive: 0xffffff, emissiveIntensity: 0.5, roughness: 0.85 });
  const tower = new THREE.Mesh(new THREE.BoxGeometry(MOUND_W, MOUND_Y, MOUND_D), mat);
  const uv = tower.geometry.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * MOUND_W) / f.tile[0], (uv.getY(i) * MOUND_Y) / f.tile[1]);
  tower.position.set(0, MOUND_Y / 2, MOUND_Z);
  tower.castShadow = true;
  tower.receiveShadow = true;
  group.add(tower);
  collidable.push(tower);
  statics.register(world.createCollider(R.ColliderDesc.cuboid(MOUND_W / 2, MOUND_Y / 2, MOUND_D / 2).setTranslation(0, MOUND_Y / 2, MOUND_Z).setFriction(0.7).setRestitution(0.4)), 'roof', MOUND_Y);
  const roofTex = makeRoofTexture(11);
  roofTex.repeat.set(2, 2);
  const roof = new THREE.Mesh(new THREE.PlaneGeometry(MOUND_W, MOUND_D), new THREE.MeshStandardMaterial({ map: roofTex, roughness: 0.95 }));
  roof.rotation.x = -Math.PI / 2;
  roof.position.set(0, MOUND_Y + 0.02, MOUND_Z);
  roof.receiveShadow = true;
  group.add(roof);
  // Low side rails only: the front and back edges stay clear of the line of fire.
  const trim = new THREE.MeshStandardMaterial({ color: 0x8e8578, roughness: 0.9 });
  for (const x of [-MOUND_W / 2 + 0.2, MOUND_W / 2 - 0.2]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, MOUND_D), trim);
    m.position.set(x, MOUND_Y + 0.25, MOUND_Z);
    m.castShadow = true;
    group.add(m);
  }
  // Mound: a low dirt disc + rubber.
  const mound = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.6, 0.25, 20), new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 1 }));
  mound.position.set(PITCHER_POS.x, MOUND_Y + 0.12, PITCHER_POS.z - 0.3);
  mound.receiveShadow = true;
  group.add(mound);
  const rubber = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.05, 0.15), new THREE.MeshStandardMaterial({ color: 0xfff4e0 }));
  rubber.position.set(PITCHER_POS.x, MOUND_Y + 0.26, PITCHER_POS.z - 0.6);
  group.add(rubber);
  // Ball bucket beside the mound.
  const bucket = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.34, 0.6, 12, 1, true), new THREE.MeshStandardMaterial({ color: 0x5ec6ff, roughness: 0.6, side: THREE.DoubleSide }));
  bucket.position.set(PITCHER_POS.x - 2.6, MOUND_Y + 0.3, PITCHER_POS.z - 0.8);
  group.add(bucket);
  // Rooftop light pole aimed at the plate.
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 6, 8), new THREE.MeshStandardMaterial({ color: 0x2b2f3a, roughness: 0.5, metalness: 0.7 }));
  pole.position.set(-3.8, MOUND_Y + 3, MOUND_Z - 3.2);
  group.add(pole);
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.35, 0.5), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff0c0, emissiveIntensity: 2 }));
  lamp.position.set(-3.5, MOUND_Y + 6, MOUND_Z - 2.9);
  lamp.rotation.y = 0.5;
  group.add(lamp);

  const pitcher = buildPitcher(envMap);
  pitcher.group.position.copy(PITCHER_POS);
  group.add(pitcher.group);
  scene.add(group);
  return { group, pitcher, collidable };
}

function buildPitcher(envMap: THREE.Texture | null): PitcherRig {
  const group = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0x8d5a3b, roughness: 0.7 });
  const jersey = new THREE.MeshStandardMaterial({ color: 0x3d405b, roughness: 0.8 });
  const pants = new THREE.MeshStandardMaterial({ color: 0xd9d4c7, roughness: 0.85 });
  const capMat = new THREE.MeshStandardMaterial({ color: 0x1b1a4d, roughness: 0.5, envMap });
  const hips = new THREE.Group();
  hips.position.y = 1.0;
  group.add(hips);
  const legL = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.7, 4, 8), pants);
  legL.position.set(-0.2, 0.52, 0);
  const legR = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.7, 4, 8), pants);
  legR.position.set(0.2, 0.52, 0);
  legL.castShadow = legR.castShadow = true;
  group.add(legL, legR);
  const torso = new THREE.Group();
  hips.add(torso);
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.33, 0.5, 4, 10), jersey);
  body.position.y = 0.45;
  body.castShadow = true;
  torso.add(body);
  const number = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), new THREE.MeshStandardMaterial({ color: 0xffd166 }));
  number.position.set(0, 0.55, -0.34);
  number.rotation.y = Math.PI;
  torso.add(number);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 12), skin);
  head.position.y = 1.08;
  head.castShadow = true;
  torso.add(head);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), capMat);
  cap.position.y = 1.14;
  torso.add(cap);
  const brim = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.04, 0.26), capMat);
  brim.position.set(0, 1.12, 0.3);
  torso.add(brim);
  // Throwing arm: shoulder pivot on the right, forearm segment, hand with the ball.
  const shoulder = new THREE.Group();
  shoulder.position.set(0.38, 0.78, 0);
  torso.add(shoulder);
  const upperArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.42, 4, 8), jersey);
  upperArm.position.set(0, -0.26, 0);
  shoulder.add(upperArm);
  const elbow = new THREE.Group();
  elbow.position.set(0, -0.5, 0);
  shoulder.add(elbow);
  const forearm = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.38, 4, 8), skin);
  forearm.position.set(0, -0.24, 0);
  elbow.add(forearm);
  const hand = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), skin);
  hand.position.set(0, -0.48, 0);
  elbow.add(hand);
  const heldBall = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), new THREE.MeshStandardMaterial({ color: 0xfff6e6, roughness: 0.6 }));
  heldBall.position.set(0, -0.6, 0.06);
  elbow.add(heldBall);
  // Glove arm
  const gloveShoulder = new THREE.Group();
  gloveShoulder.position.set(-0.38, 0.78, 0);
  torso.add(gloveShoulder);
  const gArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.42, 4, 8), jersey);
  gArm.position.set(0, -0.26, 0);
  gloveShoulder.add(gArm);
  const glove = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), new THREE.MeshStandardMaterial({ color: 0x6b3f2a, roughness: 0.9 }));
  glove.position.set(0, -0.6, 0.05);
  gloveShoulder.add(glove);

  const ease = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
  const setPhase = (phase: PitcherPhase, t: number) => {
    if (phase === 'idle') {
      const sway = Math.sin(t * Math.PI * 2) * 0.03;
      torso.rotation.set(0, 0, sway);
      hips.position.y = 1.0;
      shoulder.rotation.set(0.35, 0, -0.25);
      elbow.rotation.set(-1.3, 0, 0);
      gloveShoulder.rotation.set(0.6, 0, 0.3);
      legL.rotation.set(0, 0, 0);
      legL.position.set(-0.2, 0.52, 0);
      group.rotation.y = 0;
      heldBall.visible = true;
    } else if (phase === 'windup') {
      // Leg lift, torso coils back, arm comes up behind the head.
      const e = ease(t);
      hips.position.y = 1.0 + Math.sin(e * Math.PI) * 0.08;
      torso.rotation.set(-0.15 * e, -0.5 * e, 0);
      shoulder.rotation.set(-2.4 * e + 0.35 * (1 - e), 0, -0.5 * e - 0.25 * (1 - e));
      elbow.rotation.set(-1.3 + 0.2 * e, 0, 0);
      gloveShoulder.rotation.set(0.6 - 1.6 * e, 0, 0.3 + 0.3 * e);
      legL.rotation.set(-1.4 * Math.sin(e * Math.PI), 0, 0);
      legL.position.set(-0.2, 0.52 + 0.35 * Math.sin(e * Math.PI), 0.25 * Math.sin(e * Math.PI));
      group.rotation.y = -0.35 * e;
      heldBall.visible = true;
    } else if (phase === 'release') {
      // Arm whips forward over the top; the stride leg plants.
      const e = Math.min(1, t);
      hips.position.y = 1.0 - 0.18 * e;
      torso.rotation.set(0.45 * e - 0.15 * (1 - e), 0.9 * e - 0.5 * (1 - e), 0);
      shoulder.rotation.set(-2.4 + 3.6 * e, 0, -0.5 + 0.35 * e);
      elbow.rotation.set(-1.1 + 1.0 * e, 0, 0);
      gloveShoulder.rotation.set(-1.0 + 1.6 * e, 0, 0.6 - 0.3 * e);
      legL.rotation.set(-1.4 * (1 - e) * 0.3, 0, 0);
      legL.position.set(-0.2, 0.52, 0.25 + 0.4 * e);
      group.rotation.y = -0.35 + 0.55 * e;
      heldBall.visible = e < 0.72;
    } else {
      const e = ease(t);
      hips.position.y = 0.82 + 0.18 * e;
      torso.rotation.set(0.45 - 0.45 * e, 0.4 - 0.4 * e, 0);
      shoulder.rotation.set(1.2 - 0.85 * e, 0, -0.15 - 0.1 * e);
      elbow.rotation.set(-0.1 - 1.2 * e, 0, 0);
      gloveShoulder.rotation.set(0.6, 0, 0.3);
      legL.rotation.set(0, 0, 0);
      legL.position.set(-0.2, 0.52, 0.65 - 0.65 * e);
      group.rotation.y = 0.2 - 0.2 * e;
      heldBall.visible = e > 0.85;
    }
  };
  setPhase('idle', 0);
  return { group, setPhase, heldBall };
}
