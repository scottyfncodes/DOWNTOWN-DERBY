import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type RAPIER from '@dimforge/rapier3d-compat';
import { RAPIER as R } from '../engine/physics';
import { createRng, type Rng } from '../logic/rng';
import { PITCH, CITY_Z0 } from '../logic/citylayout';
import { makeFacade, makeRoofTexture, makeStreetTexture, type FacadeTextures } from './textures';
import { PropManager, type Prop } from './props';
import { StaticRegistry } from './statics';

export { PITCH, BLOCK, ROWS, COLS, ROOF_Y, CITY_SEED, generateLayout, type Building, type Style } from '../logic/citylayout';
import { planCity, CITY_SEED, type Building, type Style } from '../logic/citylayout';
import { DestructibleCity } from './buildings';

const BILLBOARD_DESIGNS = [
  { text: 'DERBY COLA', sub: 'ICE COLD · ALL SUMMER', bg: '#d7263d', fg: '#fff4e0' },
  { text: 'HAVE AN APP', sub: 'WE BUILD WHAT YOU DREAM', bg: '#1b1a4d', fg: '#ffd166' },
  { text: 'SLUGGER', sub: 'PREMIUM MAPLE BATS', bg: '#f4a261', fg: '#1a1024' },
  { text: 'SKYLINE', sub: 'ROOFTOP LOUNGE · OPEN LATE', bg: '#2a9d8f', fg: '#fff4e0' },
  { text: 'NIGHT OWL', sub: 'COFFEE · 24 HOURS', bg: '#264653', fg: '#5ec6ff' },
  { text: 'GRAND SLAM', sub: 'INSURANCE FOR BIG SWINGS', bg: '#ffd166', fg: '#1a1024' },
  { text: 'MOONSHOT', sub: 'SNEAKERS THAT FLY', bg: '#6a4c93', fg: '#ffe29a' },
  { text: 'HOT DOGS', sub: 'FRANK’S FAMOUS · SINCE 1952', bg: '#e76f51', fg: '#fff4e0' },
  { text: 'ROCKET BALL', sub: 'TAP TO DETONATE', bg: '#ff6b4a', fg: '#1a1024' },
];
const SIGN_WORDS = ['HOTEL', 'DINER', 'BOWL', 'PIZZA', 'RADIO', 'NEON', 'JAZZ', 'TACOS', 'ARCADE'];
const SIGN_COLORS = ['#ff4fa3', '#5ec6ff', '#4ee6b0', '#ffd166', '#ff6b4a'];
const CAR_COLORS = [0xe63946, 0xf1faee, 0xa8dadc, 0x457b9d, 0xffd166, 0x2a9d8f, 0xf4a261, 0x3d405b, 0xffffff, 0x222222];

/** Scales box UVs so a facade texture tile covers `tile` metres, with a random offset so lit windows do not repeat in lockstep. */
function scaleBoxUVs(geo: THREE.BoxGeometry, w: number, h: number, d: number, tile: [number, number], ox: number, oy: number) {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const faces: [number, number][] = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];
  for (let f = 0; f < 6; f++) {
    const [fw, fh] = faces[f];
    for (let i = 0; i < 4; i++) {
      const vi = f * 4 + i;
      const u = uv.getX(vi);
      const v = uv.getY(vi);
      if (f === 2 || f === 3) uv.setXY(vi, (u * fw) / 8, (v * fh) / 8);
      else uv.setXY(vi, ox + (u * fw) / tile[0], oy + (v * fh) / tile[1]);
    }
  }
}

export interface CityBuild {
  buildings: Building[];
  group: THREE.Group;
  collidable: THREE.Object3D[];
  destructible: DestructibleCity;
}

export function buildCity(scene: THREE.Scene, world: RAPIER.World, props: PropManager, statics: StaticRegistry, envMap: THREE.Texture | null, maxChunks: number, rubbleCapacity: number, seed = CITY_SEED): CityBuild {
  const rng = createRng(seed + 1);
  const plan = planCity(seed);
  const buildings = plan.all;
  const destructible = new DestructibleCity(world, plan.destructible, envMap, maxChunks, statics, rubbleCapacity);
  const group = new THREE.Group();
  const collidable: THREE.Object3D[] = [];
  const facades: Record<Style, FacadeTextures> = {
    concrete: makeFacade('concrete', 11),
    brick: makeFacade('brick', 12),
    glass: makeFacade('glass', 13),
    tower: makeFacade('tower', 14),
  };
  const roofTex = makeRoofTexture(5);
  const roofMat = new THREE.MeshStandardMaterial({ map: roofTex, roughness: 0.95, metalness: 0 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x8e8578, roughness: 0.9 });
  const geosByStyle: Record<Style, THREE.BufferGeometry[]> = { concrete: [], brick: [], glass: [], tower: [] };
  const trims: THREE.BufferGeometry[] = [];

  const addBuildingGeometry = (b: Building) => {
    const geo = new THREE.BoxGeometry(b.w, b.h, b.d);
    scaleBoxUVs(geo, b.w, b.h, b.d, facades[b.style].tile, rng.int(0, 3) * 0.25, rng.int(0, 3) * 0.25);
    geo.translate(b.x, b.h / 2, b.z);
    geosByStyle[b.style].push(geo);
    if (b.row <= 5) {
      const t = 0.5;
      const ph = 1.1;
      const ring = [
        new THREE.BoxGeometry(b.w + t, ph, t).translate(b.x, b.h + ph / 2, b.z - b.d / 2),
        new THREE.BoxGeometry(b.w + t, ph, t).translate(b.x, b.h + ph / 2, b.z + b.d / 2),
        new THREE.BoxGeometry(t, ph, b.d + t).translate(b.x - b.w / 2, b.h + ph / 2, b.z),
        new THREE.BoxGeometry(t, ph, b.d + t).translate(b.x + b.w / 2, b.h + ph / 2, b.z),
      ];
      trims.push(...ring);
    }
    if (rng.chance(0.5)) {
      const pw = Math.max(4, b.w * 0.28);
      const pd = Math.max(4, b.d * 0.28);
      const px = b.x + (rng.chance(0.5) ? -1 : 1) * (b.w / 2 - pw / 2 - 2);
      const pz = b.z + (rng.chance(0.5) ? -1 : 1) * (b.d / 2 - pd / 2 - 2);
      trims.push(new THREE.BoxGeometry(pw, 3.2, pd).translate(px, b.h + 1.6, pz));
      const c = R.ColliderDesc.cuboid(pw / 2, 1.6, pd / 2).setTranslation(px, b.h + 1.6, pz).setFriction(0.6).setRestitution(0.4);
      statics.register(world.createCollider(c), 'concrete', b.h + 3.2);
    }
    if (b.row >= 5 && b.h > 120 && rng.chance(0.5)) {
      trims.push(new THREE.CylinderGeometry(0.4, 1.2, 24, 6).translate(b.x, b.h + 12, b.z));
    }
    const col = R.ColliderDesc.cuboid(b.w / 2, b.h / 2, b.d / 2).setTranslation(b.x, b.h / 2, b.z).setFriction(0.6).setRestitution(0.45);
    statics.register(world.createCollider(col), 'concrete', b.h);
  };

  // Ground
  const groundTex = makeStreetTexture();
  groundTex.repeat.set(1400 / PITCH, 1400 / PITCH);
  groundTex.offset.set(0.5 - (CITY_Z0 - PITCH / 2) / PITCH, 0.5);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, 0, -300);
  ground.receiveShadow = true;
  group.add(ground);
  statics.register(world.createCollider(R.ColliderDesc.cuboid(900, 1, 900).setTranslation(0, -1, -300).setFriction(0.7).setRestitution(0.4)), 'ground', 0);

  const lightCandidates: Prop[] = [];
  let glassCount = 0;

  for (const b of buildings) {
    if (!b.destructible) addBuildingGeometry(b);
    const zf = b.z + b.d / 2; // player-facing face
    const dyn = b.destructible; // facade-mounted props are skipped on destructible buildings (their walls are the targets)
    const roofSlots: THREE.Vector3[] = [];
    for (let gx = -b.w / 2 + 4; gx <= b.w / 2 - 4; gx += 5) for (let gz = -b.d / 2 + 4; gz <= b.d / 2 - 4; gz += 5) roofSlots.push(new THREE.Vector3(b.x + gx, b.h, b.z + gz));
    for (let i = roofSlots.length - 1; i > 0; i--) {
      const j = rng.int(0, i);
      [roofSlots[i], roofSlots[j]] = [roofSlots[j], roofSlots[i]];
    }
    const take = () => roofSlots.pop();
    const row = b.row;
    if (row <= 5) {
      const hvacN = row <= 1 ? rng.int(2, 4) : row <= 3 ? rng.int(2, 4) : rng.int(1, 2);
      for (let i = 0; i < hvacN; i++) {
        const s = take();
        if (s) props.hvac(s, rng.range(0, Math.PI), rng.range(0.85, 1.3));
      }
      const towerChance = [0.45, 0.5, 0.45, 0.35, 0.3, 0.2][row];
      if (b.w >= 16 && b.d >= 16 && rng.chance(towerChance)) {
        const s = take();
        if (s) lightCandidates.push(props.waterTower(s, rng.range(0, Math.PI)));
      }
      const bbChance = [0.45, 0.55, 0.6, 0.55, 0.45, 0.3][row];
      if (rng.chance(bbChance) && b.w >= 14) {
        const width = Math.min(row <= 1 ? 10 : 16, b.w * 0.7);
        const height = width * 0.5;
        const bx = b.x + rng.range(-(b.w / 2 - width / 2 - 1), b.w / 2 - width / 2 - 1);
        const design = rng.pick(BILLBOARD_DESIGNS);
        lightCandidates.push(props.billboard(new THREE.Vector3(bx, b.h, zf - 1.6), 0, width, height, design, rng.int(0, 9999)));
      }
      if (rng.chance(0.5)) {
        const s = take();
        if (s) props.antenna(s, rng.range(5, 10));
      }
      if (row <= 4 && rng.chance(0.65)) {
        const s = take();
        if (s) {
          const n = rng.int(3, 6);
          for (let i = 0; i < n; i++) {
            const p = s.clone().add(new THREE.Vector3(rng.range(-2, 2), 0, rng.range(-2, 2)));
            if (rng.chance(0.5)) props.crate(p, rng.range(0, Math.PI), rng.range(1.1, 1.6));
            else props.barrel(p, new THREE.Color(rng.pick([0x3a86ff, 0xd62828, 0x2a9d8f, 0xf77f00])));
          }
        }
      }
      // Facade glass: curtain-wall grids on glass/tower styles, plus side-face panels for angled shots.
      if (!dyn && (b.style === 'glass' || b.style === 'tower') && b.h >= 24 && glassCount < 1300) {
        const size = 4.4;
        const cols = Math.min(5, Math.floor((b.w - 2) / (size + 0.3)));
        const rows = Math.min(4, Math.floor((b.h - 6) / (size + 0.3)));
        const totalW = cols * (size + 0.3);
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const x = b.x - totalW / 2 + (c + 0.5) * (size + 0.3);
            const y = b.h - 2 - (r + 0.5) * (size + 0.3);
            props.glassPanel(new THREE.Vector3(x, y, zf + 0.2), 0, size, size);
            glassCount++;
          }
        }
        if (row <= 4) {
          const sideCols = Math.min(3, Math.floor((b.d - 2) / (size + 0.3)));
          const sideW = sideCols * (size + 0.3);
          for (const side of [-1, 1]) {
            for (let r = 0; r < Math.min(2, rows); r++) {
              for (let c = 0; c < sideCols; c++) {
                const z = b.z - sideW / 2 + (c + 0.5) * (size + 0.3);
                const y = b.h - 2 - (r + 0.5) * (size + 0.3);
                props.glassPanel(new THREE.Vector3(b.x + side * (b.w / 2 + 0.2), y, z), Math.PI / 2, size, size);
                glassCount++;
              }
            }
          }
        }
      }
      // Street-level storefront glass on every near building: where rolling and bouncing balls end up.
      if (!dyn && row <= 4 && glassCount < 1400) {
        const sw = 4.2;
        const cols = Math.min(6, Math.floor((b.w - 3) / (sw + 0.4)));
        const totalW = cols * (sw + 0.4);
        for (let c = 0; c < cols; c++) {
          const x = b.x - totalW / 2 + (c + 0.5) * (sw + 0.4);
          props.glassPanel(new THREE.Vector3(x, 2.4, zf + 0.2), 0, sw, 3.6);
          glassCount++;
        }
        if (row <= 2) {
          const sideCols = Math.min(3, Math.floor((b.d - 3) / (sw + 0.4)));
          const sideW = sideCols * (sw + 0.4);
          for (const side of [-1, 1]) {
            for (let c = 0; c < sideCols; c++) {
              const z = b.z - sideW / 2 + (c + 0.5) * (sw + 0.4);
              props.glassPanel(new THREE.Vector3(b.x + side * (b.w / 2 + 0.2), 2.4, z), Math.PI / 2, sw, 3.6);
              glassCount++;
            }
          }
        }
      }
      if (!dyn && row <= 3 && b.style !== 'glass' && b.style !== 'tower' && rng.chance(0.4)) {
        const side = rng.chance(0.5) ? -1 : 1;
        const y = Math.min(b.h - 4, Math.max(5, b.h * 0.55));
        props.neonSign(new THREE.Vector3(b.x + side * (b.w / 2 - 1.5), y, zf + 0.85), 0, rng.pick(SIGN_WORDS), rng.pick(SIGN_COLORS));
      }
      if (!dyn && row <= 2 && (b.style === 'concrete' || b.style === 'brick') && rng.chance(0.6)) {
        const width = rng.range(5, Math.min(9, b.w * 0.5));
        const ax = b.x + rng.range(-(b.w / 2 - width / 2 - 0.5), b.w / 2 - width / 2 - 0.5);
        props.awning(new THREE.Vector3(ax, 3.8, zf + 1.2), 0, width, rng.chance(0.5));
      }
      if (!dyn && row <= 2 && rng.chance(0.18)) {
        const width = Math.min(b.w * 0.8, 15);
        const height = Math.min(b.h * 0.8, 15);
        const depth = 2.2;
        props.scaffoldFrame(new THREE.Vector3(b.x, 0, zf + 0.3 + depth / 2), 0, width, height, depth);
        const levels = Math.max(1, Math.floor(height / 3));
        for (let l = 1; l <= levels; l++) {
          const y = (height / levels) * l + 0.1;
          const n = rng.int(1, 3);
          for (let i = 0; i < n; i++) {
            props.plank(new THREE.Vector3(b.x + rng.range(-width / 2 + 2, width / 2 - 2), y, zf + 0.3 + depth / 2), rng.range(-0.1, 0.1), 3);
          }
        }
      }
    }
    // Street life
    if (row <= 3) {
      const streetZ = zf + 4.5;
      const n = rng.chance(0.8) ? rng.int(1, 2) : 0;
      for (let i = 0; i < n; i++) {
        const cx = b.x + rng.range(-b.w / 2 + 3, b.w / 2 - 3);
        props.car(new THREE.Vector3(cx, 0, streetZ), rng.chance(0.5) ? 0 : Math.PI, new THREE.Color(rng.pick(CAR_COLORS)));
      }
      if (rng.chance(0.55)) {
        const sx = b.x + rng.range(-b.w / 2 + 3, b.w / 2 - 3);
        const n2 = rng.int(2, 4);
        for (let i = 0; i < n2; i++) {
          const p = new THREE.Vector3(sx + rng.range(-1.8, 1.8), 0, zf + 2.2 + rng.range(-0.6, 0.6));
          if (rng.chance(0.5)) props.crate(p, rng.range(0, Math.PI), rng.range(1, 1.5));
          else props.barrel(p, new THREE.Color(rng.pick([0x3a86ff, 0xd62828, 0x2a9d8f, 0xf77f00])));
        }
      }
      if (rng.chance(0.3)) {
        const side = rng.chance(0.5) ? -1 : 1;
        props.car(new THREE.Vector3(b.x + side * (b.w / 2 + 4.5), 0, b.z + rng.range(-b.d / 2 + 3, b.d / 2 - 3)), Math.PI / 2, new THREE.Color(rng.pick(CAR_COLORS)));
      }
    }
    if (row <= 4 && rng.chance(0.7)) {
      const side = rng.chance(0.5) ? -1 : 1;
      props.streetlight(new THREE.Vector3(b.x + side * (b.w / 2 - 1), 0, zf + 1.4), side > 0 ? Math.PI : 0);
    }
  }

  // Elevated roadway between rows 2 and 3.
  const viaZ = -(CITY_Z0 + PITCH * 2.5);
  const deckY = 11;
  const deck = new THREE.Mesh(new THREE.BoxGeometry(640, 1.4, 14), new THREE.MeshStandardMaterial({ color: 0x7a7570, roughness: 0.9 }));
  deck.position.set(0, deckY, viaZ);
  deck.castShadow = true;
  deck.receiveShadow = true;
  group.add(deck);
  collidable.push(deck);
  statics.register(world.createCollider(R.ColliderDesc.cuboid(320, 0.7, 7).setTranslation(0, deckY, viaZ).setFriction(0.7).setRestitution(0.4)), 'concrete', deckY + 0.7);
  for (const dz of [-6.6, 6.6]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(640, 1.1, 0.4), trimMat);
    rail.position.set(0, deckY + 1.2, viaZ + dz);
    group.add(rail);
    statics.register(world.createCollider(R.ColliderDesc.cuboid(320, 0.55, 0.2).setTranslation(0, deckY + 1.2, viaZ + dz).setRestitution(0.5)), 'concrete', deckY + 1.75);
  }
  for (let x = -312; x <= 312; x += 24) {
    trims.push(new THREE.BoxGeometry(1.6, deckY, 1.6).translate(x, deckY / 2, viaZ));
    statics.register(world.createCollider(R.ColliderDesc.cuboid(0.8, deckY / 2, 0.8).setTranslation(x, deckY / 2, viaZ).setRestitution(0.4)), 'concrete', deckY);
    if (x % 48 === 0) props.streetlight(new THREE.Vector3(x, deckY + 0.7, viaZ - 5.5), 0);
  }
  for (let i = 0; i < 14; i++) {
    props.car(new THREE.Vector3(rng.range(-300, 300), deckY + 0.7, viaZ + rng.pick([-3.2, 3.2])), rng.chance(0.5) ? 0 : Math.PI, new THREE.Color(rng.pick(CAR_COLORS)));
  }

  // Merge building geometry per style.
  for (const style of Object.keys(geosByStyle) as Style[]) {
    const list = geosByStyle[style];
    if (!list.length) continue;
    const merged = mergeGeometries(list, true)!;
    list.forEach((g) => g.dispose());
    const f = facades[style];
    const facadeMat = new THREE.MeshStandardMaterial({
      map: f.map,
      emissiveMap: f.emissive,
      emissive: 0xffffff,
      emissiveIntensity: 0.9,
      roughness: style === 'glass' ? 0.25 : style === 'tower' ? 0.35 : 0.85,
      metalness: style === 'glass' ? 0.7 : style === 'tower' ? 0.5 : 0.02,
      envMap,
      envMapIntensity: style === 'glass' ? 1.2 : 0.6,
    });
    // BoxGeometry groups: px, nx, py, ny, pz, nz per box → material 1 for the roof (py).
    const mats = [facadeMat, roofMat];
    for (let i = 0; i < merged.groups.length; i++) merged.groups[i].materialIndex = i % 6 === 2 ? 1 : 0;
    const mesh = new THREE.Mesh(merged, mats);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    collidable.push(mesh);
  }
  if (trims.length) {
    const merged = mergeGeometries(trims, false)!;
    trims.forEach((g) => g.dispose());
    const mesh = new THREE.Mesh(merged, trimMat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // Backdrop skyline: far silhouettes, no physics.
  const backdrop: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 70; i++) {
    const a = Math.PI * (0.08 + 0.84 * (i / 69)); // sweep across the -Z half
    const radius = rng.range(720, 980);
    const x = Math.cos(a) * radius;
    const z = -Math.sin(a) * radius - 60;
    const w = rng.range(30, 70);
    const h = rng.range(90, 320);
    const geo = new THREE.BoxGeometry(w, h, w);
    scaleBoxUVs(geo, w, h, w, facades.tower.tile, 0, 0);
    geo.translate(x, h / 2, z);
    backdrop.push(geo);
  }
  const bd = mergeGeometries(backdrop, false)!;
  const bdMat = new THREE.MeshStandardMaterial({ map: facades.tower.map, emissiveMap: facades.tower.emissive, emissive: 0xffd9a0, emissiveIntensity: 0.6, color: 0x5a5678, roughness: 0.8 });
  const bdMesh = new THREE.Mesh(bd, bdMat);
  group.add(bdMesh);

  group.add(destructible.group);
  group.add(props.group);
  scene.add(group);
  return { buildings, group, collidable: [...collidable, props.group], destructible };
}

export function pickBonusTarget(props: PropManager, rng: Rng): Prop | null {
  const cands = props.props.filter((p) => (p.material === 'billboard' || p.material === 'watertower') && p.initialPos.z > -(CITY_Z0 + PITCH * 3.8));
  if (!cands.length) return null;
  return rng.pick(cands);
}
