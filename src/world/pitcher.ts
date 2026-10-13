import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { StaticRegistry } from './statics';
import { ROOF_Y } from '../logic/citylayout';

/**
 * The pitcher works from a construction scaffold deck across the street, level with the batter's roof.
 * The deck is open underneath, so line drives fly between the scaffold legs; the deck itself has no collider
 * (a ball that clips it smashes through the plywood, see DECK_BOX).
 */
export const MOUND_W = 8;
export const MOUND_D = 6;
export const MOUND_Z = -29;
/** Same plane as the batter. */
export const MOUND_Y = ROOF_Y;
export const PITCHER_POS = new THREE.Vector3(0.4, MOUND_Y, MOUND_Z + 0.6);
/** Where the ball leaves the pitcher's hand. */
export const RELEASE_POS = new THREE.Vector3(0.75, MOUND_Y + 2.05, MOUND_Z + 2.2);
const DECK_T = 0.45;
/** Deck volume for the "ball smashed through the scaffold" effect. */
export const DECK_BOX = {
  minX: -MOUND_W / 2,
  maxX: MOUND_W / 2,
  minY: MOUND_Y - DECK_T,
  maxY: MOUND_Y + 1.1,
  minZ: MOUND_Z - MOUND_D / 2,
  maxZ: MOUND_Z + MOUND_D / 2,
};

export type PitcherPhase = 'idle' | 'windup' | 'release' | 'follow';

export interface PitcherRig {
  group: THREE.Group;
  setPhase: (phase: PitcherPhase, t: number) => void;
  /** glove-hand ball shown before release */
  heldBall: THREE.Mesh;
}

export function buildPitcherMound(scene: THREE.Scene, _world: RAPIER.World, _statics: StaticRegistry, envMap: THREE.Texture | null): { group: THREE.Group; pitcher: PitcherRig; collidable: THREE.Object3D[] } {
  const group = new THREE.Group();
  const collidable: THREE.Object3D[] = [];
  const steel = new THREE.MeshStandardMaterial({ color: 0xd9a514, roughness: 0.5, metalness: 0.55, envMap });
  const plywood = new THREE.MeshStandardMaterial({ color: 0xb08a5a, roughness: 0.9 });
  // Deck
  const deck = new THREE.Mesh(new THREE.BoxGeometry(MOUND_W, DECK_T, MOUND_D), plywood);
  deck.position.set(0, MOUND_Y - DECK_T / 2, MOUND_Z);
  deck.castShadow = true;
  deck.receiveShadow = true;
  group.add(deck);
  collidable.push(deck);
  // Edge beams
  for (const z of [MOUND_Z - MOUND_D / 2, MOUND_Z + MOUND_D / 2]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(MOUND_W + 0.3, 0.35, 0.3), steel);
    beam.position.set(0, MOUND_Y - DECK_T - 0.15, z);
    group.add(beam);
  }
  // Scaffold legs to the street, with diagonal bracing on the side faces only (the shooting lane stays open).
  const legH = MOUND_Y - DECK_T;
  const legGeo = new THREE.CylinderGeometry(0.16, 0.16, legH, 8);
  for (const x of [-MOUND_W / 2 + 0.2, MOUND_W / 2 - 0.2]) {
    for (const z of [MOUND_Z - MOUND_D / 2 + 0.2, MOUND_Z + MOUND_D / 2 - 0.2]) {
      const leg = new THREE.Mesh(legGeo, steel);
      leg.position.set(x, legH / 2, z);
      leg.castShadow = true;
      group.add(leg);
    }
    const span = MOUND_D - 0.4;
    const lift = 6;
    const diag = Math.hypot(span, lift);
    for (let y = 2; y + lift <= legH; y += lift) {
      const brace = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, diag, 6), steel);
      brace.position.set(x, y + lift / 2, MOUND_Z);
      brace.rotation.x = (Math.floor(y / lift) % 2 ? 1 : -1) * Math.atan2(span, lift);
      group.add(brace);
      const tie = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, span, 6), steel);
      tie.rotation.x = Math.PI / 2;
      tie.position.set(x, y, MOUND_Z);
      group.add(tie);
    }
  }
  // Guard rails along the sides, toe boards, and a hoist arm.
  for (const x of [-MOUND_W / 2 + 0.1, MOUND_W / 2 - 0.1]) {
    for (const h of [0.55, 1.05]) {
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, MOUND_D, 6), steel);
      rail.rotation.x = Math.PI / 2;
      rail.position.set(x, MOUND_Y + h, MOUND_Z);
      group.add(rail);
    }
    for (const z of [MOUND_Z - MOUND_D / 2 + 0.2, MOUND_Z + MOUND_D / 2 - 0.2]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.1, 6), steel);
      post.position.set(x, MOUND_Y + 0.55, z);
      group.add(post);
    }
    const toe = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.2, MOUND_D), plywood);
    toe.position.set(x, MOUND_Y + 0.1, MOUND_Z);
    group.add(toe);
  }
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 5, 8), steel);
  mast.position.set(-MOUND_W / 2 + 0.4, MOUND_Y + 2.5, MOUND_Z - MOUND_D / 2 + 0.4);
  group.add(mast);
  const jib = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.18, 0.18), steel);
  jib.position.set(-MOUND_W / 2 - 1, MOUND_Y + 4.9, MOUND_Z - MOUND_D / 2 + 0.4);
  group.add(jib);
  const hook = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 3, 4), new THREE.MeshStandardMaterial({ color: 0x222222 }));
  hook.position.set(-MOUND_W / 2 - 2.4, MOUND_Y + 3.4, MOUND_Z - MOUND_D / 2 + 0.4);
  group.add(hook);
  // Hazard stripes along the front edge so the deck reads as a work platform.
  const stripeTex = (() => {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 8;
    const g = c.getContext('2d')!;
    g.fillStyle = '#1a1a1a';
    g.fillRect(0, 0, 64, 8);
    g.fillStyle = '#ffc21a';
    for (let x = -8; x < 72; x += 16) {
      g.beginPath();
      g.moveTo(x, 8);
      g.lineTo(x + 8, 0);
      g.lineTo(x + 16, 0);
      g.lineTo(x + 8, 8);
      g.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = THREE.RepeatWrapping;
    t.repeat.set(MOUND_W / 2, 1);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const hazard = new THREE.Mesh(new THREE.PlaneGeometry(MOUND_W, DECK_T), new THREE.MeshStandardMaterial({ map: stripeTex, roughness: 0.7 }));
  hazard.position.set(0, MOUND_Y - DECK_T / 2, MOUND_Z + MOUND_D / 2 + 0.01);
  group.add(hazard);
  // Mound: a low dirt disc + rubber.
  const mound = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.6, 0.25, 20), new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 1 }));
  mound.position.set(PITCHER_POS.x, MOUND_Y + 0.12, PITCHER_POS.z - 0.3);
  mound.receiveShadow = true;
  group.add(mound);
  const rubber = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.05, 0.15), new THREE.MeshStandardMaterial({ color: 0xfff4e0 }));
  rubber.position.set(PITCHER_POS.x, MOUND_Y + 0.26, PITCHER_POS.z - 0.6);
  group.add(rubber);
  // Bucket of balls (a paint bucket, naturally) and a work lamp clamped to the rail.
  const bucket = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.3, 0.55, 12, 1, true), new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.6, side: THREE.DoubleSide }));
  bucket.position.set(PITCHER_POS.x - 2.4, MOUND_Y + 0.28, PITCHER_POS.z - 1.2);
  group.add(bucket);
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.45, 0.3), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff0c0, emissiveIntensity: 2 }));
  lamp.position.set(MOUND_W / 2 - 0.1, MOUND_Y + 1.3, MOUND_Z - MOUND_D / 2 + 0.6);
  lamp.rotation.y = -0.6;
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
  // Work clothes: navy long-sleeve shirt under a hi-vis vest, white hard hat.
  const jersey = new THREE.MeshStandardMaterial({ color: 0x2c3448, roughness: 0.85 });
  const vestMat = new THREE.MeshStandardMaterial({ color: 0xff6a00, emissive: 0xff5500, emissiveIntensity: 0.45, roughness: 0.6 });
  const reflective = new THREE.MeshStandardMaterial({ color: 0xe8ecf0, emissive: 0xc8d0d8, emissiveIntensity: 0.35, roughness: 0.25, metalness: 0.6, envMap });
  const hatMat = new THREE.MeshStandardMaterial({ color: 0xf6f6f2, emissive: 0xffffff, emissiveIntensity: 0.32, roughness: 0.3, metalness: 0.05, envMap });
  const pants = new THREE.MeshStandardMaterial({ color: 0xd9d4c7, roughness: 0.85 });
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
  // Hi-vis vest: a slightly larger shell over the torso with two reflective bands and shoulder straps.
  const vest = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.37, 0.72, 16, 1, true), vestMat);
  vest.material.side = THREE.DoubleSide;
  vest.position.y = 0.42;
  vest.castShadow = true;
  torso.add(vest);
  for (const y of [0.2, 0.42]) {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.375, 0.38, 0.07, 16, 1, true), reflective);
    band.position.y = y;
    torso.add(band);
  }
  for (const x of [-0.17, 0.17]) {
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.05, 0.62), vestMat);
    strap.position.set(x, 0.8, 0);
    torso.add(strap);
    const strapBand = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.055, 0.63), reflective);
    strapBand.position.set(x, 0.805, 0);
    torso.add(strapBand);
  }
  // Back panel: an X of reflective tape.
  for (const r of [0.6, -0.6]) {
    const tape = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.5, 0.02), reflective);
    tape.position.set(0, 0.55, -0.375);
    tape.rotation.z = r;
    torso.add(tape);
  }
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 12), skin);
  head.position.y = 1.08;
  head.castShadow = true;
  torso.add(head);
  // White hard hat: dome, full brim with a longer peak at the front, and a centre ridge.
  const hat = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), hatMat);
  hat.position.y = 1.13;
  hat.scale.set(1, 0.9, 1.08);
  hat.castShadow = true;
  torso.add(hat);
  const hatBrim = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.03, 20), hatMat);
  hatBrim.position.set(0, 1.13, 0.03);
  hatBrim.scale.set(1, 1, 1.12);
  torso.add(hatBrim);
  const peak = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.03, 0.14), hatMat);
  peak.position.set(0, 1.125, 0.38);
  torso.add(peak);
  const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.48), hatMat);
  ridge.position.set(0, 1.38, 0.02);
  torso.add(ridge);
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
