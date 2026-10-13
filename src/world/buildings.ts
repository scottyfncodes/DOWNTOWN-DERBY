import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { RAPIER as R } from '../engine/physics';
import { InstancedBatch } from './batch';
import { makeCellTexture, makeInteriorTexture, makeRawEdgeTexture, CRACKED_TINT } from './textures';
import {
  Structure,
  chunksForCollapse,
  blastDamage,
  distanceToBox,
  craterDamageList,
  type Crater,
  type BuildingSpec,
  type Collapse,
  type DamageResult,
  type StructureCell,
  type CellMaterial,
  type ChunkSpec,
} from '../logic/structure';
import { createRng } from '../logic/rng';

export type DamageCause = 'ball' | 'rocket' | 'blast' | 'debris';

export interface CellRef {
  structure: Structure;
  cell: StructureCell;
}

export interface Chunk {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider | null;
  index: number;
  life: number;
  /** remaining damage this chunk can still deal to structures */
  budget: number;
  /** building the chunk came from (so its own rubble does not count as a chain reaction) */
  source: number;
  material: CellMaterial;
  size: THREE.Vector3;
  massEq: number;
  prevVel: THREE.Vector3;
  /** true when freshly spawned this frame (skip its first contact with its own building) */
  grace: number;
}

export interface CollapseEvent {
  structure: Structure;
  collapse: Collapse;
  cause: DamageCause;
  chain: boolean;
  chunks: number;
}

export interface BlastResult {
  results: DamageResult[];
  structures: Set<Structure>;
  /** the blast point was inside a standing building footprint */
  interior: Structure | null;
}

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _white = new THREE.Color(0xffffff);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const LEAN_RAD = 0.022;
const CHUNK_LIFE = 8;
const FRAGMENT_LIFE = 4.5;
/** Most wall fragments thrown by one impact (keeps big hits cheap on phones). */
const MAX_FRAGMENTS_PER_HIT = 7;

type BatchKey = 'brick0' | 'brick1' | 'concrete0' | 'concrete1' | 'glass0' | 'glass1' | 'steel' | 'column' | 'steelcol' | 'slab';

/**
 * Destructible downtown: structural model + physics colliders + instanced visuals + debris. Every facade panel, column and
 * slab is a fixed Rapier cuboid; when the model says a cell is broken the collider is removed and the instance hidden, so the
 * ball (and the camera) see the hole. Collapses hand their mass to a pooled set of rigid-body chunks.
 */
export class DestructibleCity {
  readonly structures: Structure[] = [];
  readonly group = new THREE.Group();
  readonly byCollider = new Map<number, CellRef>();
  readonly chunkByCollider = new Map<number, Chunk>();
  readonly chunks: Chunk[] = [];
  /** cause of the most recent damage per structure (for chain-reaction attribution) */
  readonly lastCause = new Map<Structure, DamageCause>();
  private colliders: (RAPIER.Collider | null)[][] = [];
  private instances: { batch: InstancedBatch; index: number }[][] = [];
  private batches = new Map<BatchKey, InstancedBatch>();
  private chunkBatch: InstancedBatch;
  private rng = createRng(913);
  private leaning = new Map<Structure, number | null>();
  private materialColor: Record<CellMaterial, THREE.Color> = {
    glass: new THREE.Color(0x7fb2d8),
    brick: new THREE.Color(0x9a5d48),
    concrete: new THREE.Color(0xb3a99a),
    steel: new THREE.Color(0x3a4252),
    slab: new THREE.Color(0x9b958a),
    column: new THREE.Color(0xa49d90),
  };
  onDust?: (pos: THREE.Vector3, material: CellMaterial, count: number, speed: number) => void;

  constructor(private world: RAPIER.World, specs: BuildingSpec[], envMap: THREE.Texture | null, maxChunks: number) {
    // Count cells per batch to size the instanced meshes.
    const counts = new Map<BatchKey, number>();
    const keyFor = (cell: StructureCell, style: BuildingSpec['style']): BatchKey => {
      if (cell.kind === 'slab') return 'slab';
      if (cell.kind === 'corner' || cell.kind === 'core') return cell.material === 'steel' ? 'steelcol' : 'column';
      if (cell.material === 'steel') return 'steel';
      const v = (cell.ix + cell.iy + cell.iz) % 2;
      const base = cell.material === 'glass' ? 'glass' : style === 'brick' ? 'brick' : 'concrete';
      return `${base}${v}` as BatchKey;
    };
    for (const spec of specs) {
      const s = new Structure(spec);
      this.structures.push(s);
      for (const c of s.cells) {
        const k = keyFor(c, spec.style);
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
    }
    const interior = new THREE.MeshStandardMaterial({ map: makeInteriorTexture(), roughness: 0.95 });
    const facadeMats = (style: 'brick' | 'concrete' | 'glass' | 'steel', variant: number): THREE.Material[] => {
      const t = makeCellTexture(style, variant);
      const edge = new THREE.MeshStandardMaterial({ map: makeRawEdgeTexture(style), roughness: 0.95 });
      const face = new THREE.MeshStandardMaterial({
        map: t.map,
        emissiveMap: t.emissive,
        emissive: 0xffffff,
        emissiveIntensity: 0.85,
        roughness: style === 'glass' ? 0.25 : style === 'steel' ? 0.4 : 0.88,
        metalness: style === 'glass' ? 0.7 : style === 'steel' ? 0.6 : 0.02,
        envMap,
        envMapIntensity: style === 'glass' ? 1.2 : 0.5,
      });
      // local +z is the outward face; -z faces the interior; x ends and y caps are raw edges.
      return [edge, edge, edge, edge, face, interior];
    };
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mk = (key: BatchKey, mats: THREE.Material | THREE.Material[]) => {
      const cap = Math.max(1, counts.get(key) ?? 0);
      const b = new InstancedBatch(geo, mats as THREE.Material, cap, true);
      b.mesh.name = `cells-${key}`;
      this.batches.set(key, b);
      this.group.add(b.mesh);
    };
    mk('brick0', facadeMats('brick', 0));
    mk('brick1', facadeMats('brick', 1));
    mk('concrete0', facadeMats('concrete', 0));
    mk('concrete1', facadeMats('concrete', 1));
    mk('glass0', facadeMats('glass', 0));
    mk('glass1', facadeMats('glass', 1));
    mk('steel', facadeMats('steel', 0));
    mk('column', new THREE.MeshStandardMaterial({ map: makeRawEdgeTexture('concrete'), color: 0xcfc8bb, roughness: 0.9 }));
    mk('steelcol', new THREE.MeshStandardMaterial({ color: 0x4a5264, roughness: 0.45, metalness: 0.7, envMap }));
    mk('slab', new THREE.MeshStandardMaterial({ color: 0x8f8a80, roughness: 0.95 }));

    // Create colliders + instances.
    for (const s of this.structures) {
      const cols: (RAPIER.Collider | null)[] = [];
      const inst: { batch: InstancedBatch; index: number }[] = [];
      for (const c of s.cells) {
        const key = keyFor(c, s.spec.style);
        const b = this.batches.get(key)!;
        this.cellMatrix(c, 0, 0, 0, _m);
        const index = b.add(_m, _white);
        inst.push({ batch: b, index });
        const desc = R.ColliderDesc.cuboid(c.sx / 2, c.sy / 2, c.sz / 2).setTranslation(c.x, c.y, c.z).setFriction(0.6).setRestitution(c.material === 'glass' ? 0.3 : 0.42);
        const col = this.world.createCollider(desc);
        cols.push(col);
        this.byCollider.set(col.handle, { structure: s, cell: c });
      }
      this.colliders.push(cols);
      this.instances.push(inst);
      this.leaning.set(s, null);
    }

    // Debris chunk pool.
    this.chunkBatch = new InstancedBatch(geo, new THREE.MeshStandardMaterial({ map: makeRawEdgeTexture('concrete'), roughness: 0.92 }), maxChunks, true);
    this.chunkBatch.mesh.name = 'chunks';
    this.group.add(this.chunkBatch.mesh);
    for (let i = 0; i < maxChunks; i++) {
      const body = this.world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(0, -500, 0).setCanSleep(true).setLinearDamping(0.05).setAngularDamping(0.8).setCcdEnabled(false));
      body.setEnabled(false);
      const index = this.chunkBatch.add(new THREE.Matrix4().makeScale(0, 0, 0), _white);
      this.chunks.push({ body, collider: null, index, life: 0, budget: 0, source: -1, material: 'concrete', size: new THREE.Vector3(1, 1, 1), massEq: 40, prevVel: new THREE.Vector3(), grace: 0 });
    }
  }

  /** Composes a cell's instance matrix, rotated so local +z faces outward, with an optional lean offset. */
  private cellMatrix(c: StructureCell, dx: number, dz: number, _dy: number, out: THREE.Matrix4): THREE.Matrix4 {
    let angle = 0;
    let sx = c.sx;
    let sz = c.sz;
    if (c.kind === 'facade') {
      if (c.nx > 0.5) angle = Math.PI / 2;
      else if (c.nx < -0.5) angle = -Math.PI / 2;
      else if (c.nz < -0.5) angle = Math.PI;
      if (Math.abs(c.nx) > 0.5) {
        sx = c.sz;
        sz = c.sx;
      }
    }
    _p.set(c.x + dx, c.y, c.z + dz);
    _q.setFromAxisAngle(Y_AXIS, angle);
    _s.set(sx, c.sy, sz);
    return out.compose(_p, _q, _s);
  }

  private hideCell(s: Structure, c: StructureCell) {
    const inst = this.instances[s.spec.id][c.id];
    inst.batch.hide(inst.index);
    const col = this.colliders[s.spec.id][c.id];
    if (col) {
      this.byCollider.delete(col.handle);
      this.world.removeCollider(col, false);
      this.colliders[s.spec.id][c.id] = null;
    }
  }

  private tintCell(s: Structure, c: StructureCell) {
    const inst = this.instances[s.spec.id][c.id];
    if (c.state === 'cracked') {
      _c.setHex(CRACKED_TINT);
      inst.batch.setColor(inst.index, _c);
    } else inst.batch.setColor(inst.index, _white);
  }

  /** Applies damage to a cell and syncs visuals/colliders. */
  damageCell(s: Structure, c: StructureCell, amount: number, cause: DamageCause): DamageResult | null {
    if (c.state === 'broken') return null;
    const r = s.damage(c.id, amount);
    if (!r) return null;
    this.lastCause.set(s, cause);
    if (r.broke) {
      this.hideCell(s, c);
      this.onDust?.(_p.set(c.x, c.y, c.z), c.material, c.kind === 'slab' ? 10 : 14, 6);
    } else if (r.cracked) this.tintCell(s, c);
    return r;
  }

  /**
   * A projectile struck a cell collider. The struck cell takes the full crater power; every cell inside the crater radius
   * takes falloff damage, so a clean hit tears a chunk out of the wall rather than knocking out one panel. Broken
   * facade/column cells throw physical fragments along the shot. Returns how much speed the projectile keeps
   * (0 = it bounced) and every section that cracked or broke.
   */
  projectileHit(
    colliderHandle: number,
    crater: Crater,
    cause: DamageCause,
    point: THREE.Vector3,
    dir: THREE.Vector3,
    speed: number,
  ): { ref: CellRef; result: DamageResult; retention: number; hpBefore: number; damage: number; craterResults: DamageResult[] } | null {
    const ref = this.byCollider.get(colliderHandle);
    if (!ref) return null;
    const { structure: s, cell: c } = ref;
    const hpBefore = c.hp;
    const damage = crater.power;
    const result = this.damageCell(s, c, damage, cause);
    if (!result) return null;
    const retention = result.broke ? Math.sqrt(Math.max(0, 1 - hpBefore / Math.max(damage, 1e-6))) * 0.92 : 0;
    const craterResults: DamageResult[] = [];
    const broken: StructureCell[] = result.broke ? [c] : [];
    for (const { cell, damage: d } of craterDamageList(s, point.x, point.y, point.z, crater)) {
      if (cell === c) continue;
      const r = this.damageCell(s, cell, d, cause);
      if (r && (r.broke || r.cracked)) {
        craterResults.push(r);
        if (r.broke) broken.push(cell);
      }
    }
    // Neighbouring buildings inside a big crater (alleys are narrow) take the hit too.
    if (crater.radius > 3) {
      for (const other of this.structures) {
        if (other === s || other.collapsed) continue;
        for (const { cell, damage: d } of craterDamageList(other, point.x, point.y, point.z, crater)) {
          const r = this.damageCell(other, cell, d, cause);
          if (r && (r.broke || r.cracked)) {
            craterResults.push(r);
            if (r.broke) broken.push(cell);
          }
        }
      }
    }
    this.throwFragments(broken, dir, speed, s.spec.id);
    return { ref, result, retention, hpBefore, damage, craterResults };
  }

  /** Physical chunks of wall blown out of broken cells, nearest-first, capped per hit. */
  private throwFragments(cells: StructureCell[], dir: THREE.Vector3, speed: number, source: number) {
    let n = 0;
    for (const c of cells) {
      if (n >= MAX_FRAGMENTS_PER_HIT) break;
      if (c.kind === 'slab') continue;
      const pieces = c.kind === 'facade' ? 2 : 1;
      for (let i = 0; i < pieces && n < MAX_FRAGMENTS_PER_HIT; i++) {
        // Sized to fit inside the emptied cell so it never spawns overlapping a standing neighbour.
        const sx = Math.min(c.sx * 0.45, this.rng.range(1.1, 2.6));
        const sy = Math.min(c.sy * 0.45, this.rng.range(0.8, 2));
        const sz = Math.min(c.sz * 0.6, this.rng.range(0.7, 1.4));
        const push = Math.min(30, speed * 0.3);
        if (this.spawnChunk(
          {
            x: c.x + (this.rng.next() - 0.5) * c.sx * 0.4,
            y: c.y + (this.rng.next() - 0.5) * c.sy * 0.4,
            z: c.z + (this.rng.next() - 0.5) * c.sz * 0.3,
            sx,
            sy,
            sz,
            material: c.material,
            vx: dir.x * push + this.rng.range(-4, 4) + c.nx * this.rng.range(0, 3),
            vy: dir.y * push * 0.5 + this.rng.range(1, 5),
            vz: dir.z * push + this.rng.range(-4, 4) + c.nz * this.rng.range(0, 3),
          },
          source,
          { life: FRAGMENT_LIFE, budget: 6, spin: 5 },
        ))
          n++;
      }
    }
  }

  /** Standing structure whose footprint contains the point (below its current height). */
  structureAt(x: number, y: number, z: number): Structure | null {
    for (const s of this.structures) {
      if (s.collapsed) continue;
      if (x >= s.minX && x <= s.maxX && z >= s.minZ && z <= s.maxZ && y >= 0 && y <= s.height) return s;
    }
    return null;
  }

  /** Radial blast against every structure in range. `interiorMult` boosts a confined blast. */
  blast(x: number, y: number, z: number, radius: number, power: number, interiorMult = 1.35): BlastResult {
    const results: DamageResult[] = [];
    const structures = new Set<Structure>();
    const interior = this.structureAt(x, y, z);
    const p = interior ? power * interiorMult : power;
    for (const s of this.structures) {
      if (s.collapsed) continue;
      const cells = s.cellsNear(x, y, z, radius);
      if (!cells.length) continue;
      // Sort by distance so the structure-changing hits read inside-out.
      for (const c of cells) {
        const d = distanceToBox(x, y, z, c);
        const r = this.damageCell(s, c, blastDamage(d, radius, p), 'blast');
        if (r && (r.broke || r.cracked)) {
          results.push(r);
          structures.add(s);
        }
      }
    }
    return { results, structures, interior };
  }

  /**
   * Re-evaluates the given structures for collapse; removes failed cells from the world and spawns debris chunks.
   * Returns the collapse events for scoring/feedback.
   */
  settle(changed: Iterable<Structure>): CollapseEvent[] {
    const events: CollapseEvent[] = [];
    for (const s of changed) {
      let collapse = s.evaluate();
      let guard = 0;
      while (collapse && guard++ < 3) {
        for (const c of collapse.cells) this.hideCell(s, c);
        const cause = this.lastCause.get(s) ?? 'ball';
        const specs = chunksForCollapse(s, collapse, Math.min(this.chunks.length, 28), 7);
        let spawned = 0;
        for (const spec of specs) if (this.spawnChunk(spec, s.spec.id)) spawned++;
        this.onDust?.(_p.set(s.spec.x, collapse.y + 1, s.spec.z), s.cells[0]?.material ?? 'concrete', 60, 14);
        events.push({ structure: s, collapse, cause, chain: cause === 'debris', chunks: spawned });
        this.refreshLean(s);
        collapse = s.evaluate();
      }
      this.refreshLean(s);
    }
    return events;
  }

  /** Recomputes the lean offset of a structure's cells above its most unstable floor. */
  refreshLean(s: Structure) {
    const unstable = s.collapsed ? null : s.unstableFloor();
    const prev = this.leaning.get(s);
    if (prev === unstable && unstable === null) return;
    this.leaning.set(s, unstable);
    const lean = unstable === null ? null : this.supportLean(s, unstable);
    const baseY = unstable === null ? 0 : (unstable + 1) * s.floorHeight;
    const inst = this.instances[s.spec.id];
    for (const c of s.cells) {
      if (c.state === 'broken') continue;
      let dx = 0;
      let dz = 0;
      if (lean && c.y > baseY) {
        const k = (c.y - baseY) * LEAN_RAD;
        dx = lean.x * k;
        dz = lean.z * k;
      }
      this.cellMatrix(c, dx, dz, 0, _m);
      inst[c.id].batch.set(inst[c.id].index, _m);
    }
  }

  private supportLean(s: Structure, iy: number): { x: number; z: number } | null {
    let wx = 0;
    let wz = 0;
    let wsum = 0;
    for (const c of s.cells) {
      if (c.iy !== iy || c.kind === 'slab') continue;
      const k = c.state === 'intact' ? 1 : c.state === 'cracked' ? 0.5 : 0;
      wx += (c.x - s.spec.x) * c.weight * k;
      wz += (c.z - s.spec.z) * c.weight * k;
      wsum += c.weight * k;
    }
    if (wsum <= 0) return null;
    const cx = wx / wsum;
    const cz = wz / wsum;
    const len = Math.hypot(cx, cz);
    if (len < 0.3) return null;
    return { x: -cx / len, z: -cz / len };
  }

  /** Structures currently flagged unstable (for dust/groans). */
  unstableStructures(): { structure: Structure; floor: number }[] {
    const out: { structure: Structure; floor: number }[] = [];
    for (const [s, f] of this.leaning) if (f !== null && !s.collapsed) out.push({ structure: s, floor: f });
    return out;
  }

  // ---------- Chunks ----------

  private spawnChunk(spec: ChunkSpec, source: number, opts: { life?: number; budget?: number; spin?: number } = {}): boolean {
    let chunk = this.chunks.find((c) => c.life <= 0);
    if (!chunk) {
      // Recycle the oldest live chunk so a huge collapse still reads.
      chunk = this.chunks.reduce((a, b) => (a.life < b.life ? a : b));
      if (chunk.life > CHUNK_LIFE * 0.6) return false;
      this.retireChunk(chunk);
    }
    const body = chunk.body;
    if (chunk.collider) {
      this.chunkByCollider.delete(chunk.collider.handle);
      this.world.removeCollider(chunk.collider, false);
    }
    chunk.size.set(spec.sx, spec.sy, spec.sz);
    body.setEnabled(true);
    body.setTranslation({ x: spec.x + (this.rng.next() - 0.5) * 0.5, y: spec.y, z: spec.z + (this.rng.next() - 0.5) * 0.5 }, true);
    body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    body.setLinvel({ x: spec.vx, y: spec.vy, z: spec.vz }, true);
    const spin = opts.spin ?? 1.2;
    body.setAngvel({ x: this.rng.range(-spin, spin), y: this.rng.range(-spin * 0.7, spin * 0.7), z: this.rng.range(-spin, spin) }, true);
    const desc = R.ColliderDesc.cuboid(spec.sx / 2, spec.sy / 2, spec.sz / 2).setDensity(1.4).setFriction(0.8).setRestitution(0.12).setActiveEvents(R.ActiveEvents.COLLISION_EVENTS);
    chunk.collider = this.world.createCollider(desc, body);
    this.chunkByCollider.set(chunk.collider.handle, chunk);
    chunk.life = opts.life ?? CHUNK_LIFE;
    chunk.budget = opts.budget ?? 26;
    chunk.source = source;
    chunk.material = spec.material;
    chunk.massEq = 30 + Math.min(60, spec.sx * spec.sy * spec.sz * 0.12);
    chunk.grace = 0.25;
    chunk.prevVel.set(spec.vx, spec.vy, spec.vz);
    _c.copy(this.materialColor[spec.material]).multiplyScalar(0.9);
    this.chunkBatch.setColor(chunk.index, _c);
    return true;
  }

  private retireChunk(chunk: Chunk) {
    chunk.life = 0;
    chunk.body.setEnabled(false);
    this.chunkBatch.hide(chunk.index);
    if (chunk.collider) {
      this.chunkByCollider.delete(chunk.collider.handle);
      this.world.removeCollider(chunk.collider, false);
      chunk.collider = null;
    }
  }

  /** A debris chunk struck a structure cell: deals debris damage within the chunk's remaining budget. */
  chunkHitCell(chunk: Chunk, cellHandle: number): { ref: CellRef; result: DamageResult; chain: boolean } | null {
    const ref = this.byCollider.get(cellHandle);
    if (!ref || chunk.budget <= 0) return null;
    if (chunk.grace > 0 && ref.structure.spec.id === chunk.source) return null;
    const speed = chunk.prevVel.length();
    if (speed < 4) return null;
    const dmg = Math.min(chunk.budget, 0.0005 * chunk.massEq * speed * speed);
    if (dmg < 0.5) return null;
    chunk.budget -= dmg;
    const result = this.damageCell(ref.structure, ref.cell, dmg, 'debris');
    if (!result) return null;
    return { ref, result, chain: ref.structure.spec.id !== chunk.source };
  }

  /** A dynamic prop (falling water tower, car) struck a cell. */
  propHitCell(cellHandle: number, speed: number, mass: number): { ref: CellRef; result: DamageResult } | null {
    const ref = this.byCollider.get(cellHandle);
    if (!ref || speed < 5) return null;
    const dmg = 0.0005 * Math.min(80, mass * 0.1) * speed * speed;
    if (dmg < 0.5) return null;
    const result = this.damageCell(ref.structure, ref.cell, dmg, 'debris');
    return result ? { ref, result } : null;
  }

  /** Performance governor: retire the oldest chunks down to `keep` live ones. */
  trimChunks(keep: number) {
    const live = this.chunks.filter((c) => c.life > 0).sort((a, b) => a.life - b.life);
    for (let i = 0; i < live.length - keep; i++) this.retireChunk(live[i]);
  }

  get activeChunks(): number {
    let n = 0;
    for (const c of this.chunks) if (c.life > 0) n++;
    return n;
  }

  /** Captures chunk velocities before the physics step for impact estimates. */
  storeVelocities() {
    for (const c of this.chunks) {
      if (c.life <= 0) continue;
      const v = c.body.linvel();
      c.prevVel.set(v.x, v.y, v.z);
    }
  }

  update(dt: number) {
    for (const c of this.chunks) {
      if (c.life <= 0) continue;
      c.life -= dt;
      if (c.grace > 0) c.grace -= dt;
      const t = c.body.translation();
      if (c.life <= 0 || t.y < -30) {
        this.retireChunk(c);
        continue;
      }
      const r = c.body.rotation();
      _p.set(t.x, t.y, t.z);
      _q.set(r.x, r.y, r.z, r.w);
      const fade = c.life < 1 ? c.life : 1;
      _s.copy(c.size).multiplyScalar(fade);
      _m.compose(_p, _q, _s);
      this.chunkBatch.set(c.index, _m);
    }
  }

  /** Axis-aligned ray vs standing building boxes, for camera clipping avoidance. Returns the nearest hit distance or null. */
  rayHit(origin: THREE.Vector3, dir: THREE.Vector3, far: number): number | null {
    let best: number | null = null;
    for (const s of this.structures) {
      if (s.collapsed) continue;
      const h = s.height;
      let tmin = 0;
      let tmax = far;
      const axes: [number, number, number, number][] = [
        [origin.x, dir.x, s.minX, s.maxX],
        [origin.y, dir.y, 0, h],
        [origin.z, dir.z, s.minZ, s.maxZ],
      ];
      let ok = true;
      for (const [o, d, lo, hi] of axes) {
        if (Math.abs(d) < 1e-6) {
          if (o < lo || o > hi) {
            ok = false;
            break;
          }
          continue;
        }
        let t1 = (lo - o) / d;
        let t2 = (hi - o) / d;
        if (t1 > t2) [t1, t2] = [t2, t1];
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) {
          ok = false;
          break;
        }
      }
      if (ok && tmin < far && (best === null || tmin < best)) best = tmin;
    }
    return best;
  }

  /** Bounding boxes of standing buildings (for prop detachment on collapse). */
  footprint(s: Structure): { minX: number; maxX: number; minZ: number; maxZ: number } {
    return { minX: s.minX, maxX: s.maxX, minZ: s.minZ, maxZ: s.maxZ };
  }

  /** Total damage summary for HUD/debug. */
  stats(): { damaged: number; collapsed: number; broken: number } {
    let damaged = 0;
    let collapsed = 0;
    let broken = 0;
    for (const s of this.structures) {
      if (s.damaged) damaged++;
      if (s.collapsed) collapsed++;
      broken += s.count('broken');
    }
    return { damaged, collapsed, broken };
  }

  /** Restores every building and clears debris. */
  reset() {
    for (const s of this.structures) {
      const cols = this.colliders[s.spec.id];
      const inst = this.instances[s.spec.id];
      s.reset();
      this.leaning.set(s, null);
      this.lastCause.delete(s);
      for (const c of s.cells) {
        if (!cols[c.id]) {
          const desc = R.ColliderDesc.cuboid(c.sx / 2, c.sy / 2, c.sz / 2).setTranslation(c.x, c.y, c.z).setFriction(0.6).setRestitution(c.material === 'glass' ? 0.3 : 0.42);
          const col = this.world.createCollider(desc);
          cols[c.id] = col;
          this.byCollider.set(col.handle, { structure: s, cell: c });
        }
        this.cellMatrix(c, 0, 0, 0, _m);
        inst[c.id].batch.set(inst[c.id].index, _m);
        inst[c.id].batch.setColor(inst[c.id].index, _white);
      }
    }
    for (const c of this.chunks) this.retireChunk(c);
  }
}
