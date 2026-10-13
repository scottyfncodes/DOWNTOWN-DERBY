/**
 * Structural model for destructible buildings. Pure and deterministic: no physics engine, no renderer.
 *
 * A building is a stack of floors. Each floor is made of modular cells: facade panels around the perimeter, four corner
 * columns, an optional central core and a floor slab. Cells have hit points and a load-bearing weight. When the remaining
 * bearing capacity of any floor drops below the building's threshold, that floor and everything above it collapses:
 * the cells are removed from the model (the world state changes) and handed back so the caller can turn them into debris.
 */

export type CellMaterial = 'glass' | 'brick' | 'concrete' | 'steel' | 'slab' | 'column';
export type CellKind = 'facade' | 'corner' | 'core' | 'slab';
export type CellState = 'intact' | 'cracked' | 'broken';
export type BuildingStyle = 'brick' | 'concrete' | 'glass' | 'tower';

/** Hit points per material. Damage units: a perfect league-ball hit is ~10. */
export const CELL_HP: Record<CellMaterial, number> = {
  glass: 2,
  brick: 7,
  concrete: 12,
  steel: 10,
  slab: 14,
  column: 24,
};

/** Load-bearing weight per cell kind/material (slabs bear nothing). */
export const WEIGHT_FACADE: Record<CellMaterial, number> = { glass: 0.3, brick: 1, concrete: 1, steel: 1.2, slab: 0, column: 1 };
export const WEIGHT_CORNER = 2.5;
export const WEIGHT_CORE = 6;

/** Fraction of a floor's bearing capacity below which it fails, per style. */
export const COLLAPSE_THRESHOLD: Record<BuildingStyle, number> = { brick: 0.55, concrete: 0.5, glass: 0.55, tower: 0.45 };
/** Column hit points scale per style (brick corners crumble, tower steel is tough). */
export const COLUMN_HP_SCALE: Record<BuildingStyle, number> = { brick: 0.55, concrete: 1, glass: 0.9, tower: 1.3 };
/** How far above the threshold a floor counts as "unstable" (visibly leaning, groaning). */
export const UNSTABLE_MARGIN = 0.16;

export const WALL_T = 2.4;
export const SLAB_T = 0.5;

export interface BuildingSpec {
  id: number;
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  style: BuildingStyle;
  floors: number;
  nx: number;
  nz: number;
  /** low-rises have no core */
  core: boolean;
}

export interface StructureCell {
  id: number;
  building: number;
  ix: number;
  iy: number;
  iz: number;
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  material: CellMaterial;
  kind: CellKind;
  hp: number;
  maxHp: number;
  weight: number;
  state: CellState;
  /** outward normal for facade cells (0 for others) */
  nx: number;
  nz: number;
}

export interface DamageResult {
  cell: StructureCell;
  before: CellState;
  after: CellState;
  /** the cell was destroyed by this hit */
  broke: boolean;
  /** state changed intact → cracked */
  cracked: boolean;
  /** hit points actually consumed */
  absorbed: number;
}

export interface Collapse {
  building: number;
  /** lowest floor that failed */
  floor: number;
  /** cells removed by the collapse (for debris spawning), excluding already-broken ones */
  cells: StructureCell[];
  /** horizontal direction the mass leans toward (unit length or zero = straight down) */
  lean: { x: number; z: number };
  /** true when nothing is left standing */
  total: boolean;
  floorsDropped: number;
  /** height (y) of the failure plane */
  y: number;
}

/** Kinetic-energy style impact damage. mass ≈ kg, speed m/s. `penetrator` multiplies (rockets, dense balls). */
export function impactDamage(speed: number, mass: number, penetrator = 1): number {
  return 0.0005 * mass * speed * speed * penetrator;
}

/** Fraction of speed a projectile keeps after breaking through a cell with `hpBefore` hit points. 0 when it fails to break through. */
export function penetrationRetention(damage: number, hpBefore: number): number {
  if (damage <= hpBefore) return 0;
  return Math.sqrt(1 - hpBefore / damage) * 0.92;
}

/** Radial blast damage with linear falloff: a blast inside a room reaches every wall, one outside only scars a face. */
export function blastDamage(dist: number, radius: number, power: number): number {
  if (dist >= radius) return 0;
  return power * (1 - dist / radius);
}

/** Distance from a point to the surface of an axis-aligned box (0 when inside). */
export function distanceToBox(px: number, py: number, pz: number, c: { x: number; y: number; z: number; sx: number; sy: number; sz: number }): number {
  const dx = Math.max(0, Math.abs(px - c.x) - c.sx / 2);
  const dy = Math.max(0, Math.abs(py - c.y) - c.sy / 2);
  const dz = Math.max(0, Math.abs(pz - c.z) - c.sz / 2);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export class Structure {
  readonly spec: BuildingSpec;
  readonly cells: StructureCell[] = [];
  /** floors still standing: floors with index < topFloor exist */
  topFloor: number;
  /** nothing left standing */
  collapsed = false;
  /** at least one cell has taken damage */
  damaged = false;
  /** number of collapse events this structure has suffered */
  collapses = 0;
  readonly threshold: number;
  readonly floorHeight: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  private capacity: number[] = [];
  private byFloor: StructureCell[][] = [];

  constructor(spec: BuildingSpec) {
    this.spec = spec;
    this.topFloor = spec.floors;
    this.threshold = COLLAPSE_THRESHOLD[spec.style];
    this.floorHeight = spec.h / spec.floors;
    this.minX = spec.x - spec.w / 2;
    this.maxX = spec.x + spec.w / 2;
    this.minZ = spec.z - spec.d / 2;
    this.maxZ = spec.z + spec.d / 2;
    this.build();
  }

  private facadeMaterial(): CellMaterial {
    switch (this.spec.style) {
      case 'brick':
        return 'brick';
      case 'concrete':
        return 'concrete';
      default:
        return 'glass';
    }
  }

  private columnMaterial(): CellMaterial {
    return this.spec.style === 'tower' || this.spec.style === 'glass' ? 'steel' : 'column';
  }

  private build() {
    const s = this.spec;
    const t = WALL_T;
    const fh = this.floorHeight;
    const cw = (s.w - 2 * t) / s.nx;
    const cd = (s.d - 2 * t) / s.nz;
    const fac = this.facadeMaterial();
    const colMat = this.columnMaterial();
    const colHp = CELL_HP[colMat === 'steel' ? 'column' : 'column'] * COLUMN_HP_SCALE[s.style];
    const steelPanelFloor = (iy: number) => s.style === 'tower' && iy % 3 === 2;
    const add = (ix: number, iy: number, iz: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, material: CellMaterial, kind: CellKind, hp: number, weight: number, nx = 0, nz = 0) => {
      const cell: StructureCell = { id: this.cells.length, building: s.id, ix, iy, iz, x, y, z, sx, sy, sz, material, kind, hp, maxHp: hp, weight, state: 'intact', nx, nz };
      this.cells.push(cell);
      this.byFloor[iy].push(cell);
      if (kind !== 'slab') this.capacity[iy] += weight;
    };
    for (let iy = 0; iy < s.floors; iy++) {
      this.byFloor.push([]);
      this.capacity.push(0);
      const y0 = iy * fh;
      const cy = y0 + fh / 2;
      // Corners
      for (const [sx, sz] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ]) {
        add(sx < 0 ? 0 : s.nx + 1, iy, sz < 0 ? 0 : s.nz + 1, s.x + sx * (s.w / 2 - t / 2), cy, s.z + sz * (s.d / 2 - t / 2), t, fh, t, colMat, 'corner', colHp, WEIGHT_CORNER, sx * 0.7071, sz * 0.7071);
      }
      // Front / back facades (z faces)
      const facMat: CellMaterial = steelPanelFloor(iy) ? 'steel' : fac;
      for (let ix = 0; ix < s.nx; ix++) {
        const x = s.x - s.w / 2 + t + (ix + 0.5) * cw;
        for (const sz of [-1, 1]) {
          add(ix + 1, iy, sz < 0 ? 0 : s.nz + 1, x, cy, s.z + sz * (s.d / 2 - t / 2), cw, fh, t, facMat, 'facade', CELL_HP[facMat], WEIGHT_FACADE[facMat], 0, sz);
        }
      }
      // Side facades (x faces)
      for (let iz = 0; iz < s.nz; iz++) {
        const z = s.z - s.d / 2 + t + (iz + 0.5) * cd;
        for (const sx of [-1, 1]) {
          add(sx < 0 ? 0 : s.nx + 1, iy, iz + 1, s.x + sx * (s.w / 2 - t / 2), cy, z, t, fh, cd, facMat, 'facade', CELL_HP[facMat], WEIGHT_FACADE[facMat], sx, 0);
        }
      }
      // Core
      if (s.core) {
        const cc = Math.max(2.4, Math.min(6, Math.min(s.w, s.d) * 0.2));
        add(Math.ceil(s.nx / 2), iy, Math.ceil(s.nz / 2), s.x, cy, s.z, cc, fh, cc, colMat, 'core', colHp * 1.25, WEIGHT_CORE);
      }
      // Ceiling slab
      const iw = s.w - 2 * t - 0.1;
      const id = s.d - 2 * t - 0.1;
      if (iw > 1 && id > 1) {
        add(Math.ceil(s.nx / 2), iy, Math.ceil(s.nz / 2), s.x, y0 + fh - SLAB_T / 2, s.z, iw, SLAB_T, id, 'slab', 'slab', CELL_HP.slab, 0);
      }
    }
  }

  /** Current standing height in metres. */
  get height(): number {
    return this.topFloor * this.floorHeight;
  }

  cellAt(id: number): StructureCell | undefined {
    return this.cells[id];
  }

  /** 0..1 fraction of a floor's bearing capacity that is still intact (cracked counts half). */
  floorIntegrity(iy: number): number {
    if (iy < 0 || iy >= this.spec.floors) return 0;
    const cap = this.capacity[iy];
    if (cap <= 0) return 1;
    let have = 0;
    for (const c of this.byFloor[iy]) {
      if (c.kind === 'slab') continue;
      if (c.state === 'intact') have += c.weight;
      else if (c.state === 'cracked') have += c.weight * 0.5;
    }
    return have / cap;
  }

  /** Lowest standing floor that is close to failing, or null. */
  unstableFloor(): number | null {
    for (let iy = 0; iy < this.topFloor; iy++) {
      const f = this.floorIntegrity(iy);
      if (f >= this.threshold && f < this.threshold + UNSTABLE_MARGIN) return iy;
    }
    return null;
  }

  /** Applies damage to one cell. Idempotent on broken cells. */
  damage(cellId: number, amount: number): DamageResult | null {
    const cell = this.cells[cellId];
    if (!cell || amount <= 0) return null;
    const before = cell.state;
    if (before === 'broken') return { cell, before, after: before, broke: false, cracked: false, absorbed: 0 };
    const absorbed = Math.min(amount, cell.hp);
    cell.hp = Math.max(0, cell.hp - amount);
    this.damaged = true;
    let after: CellState = before;
    if (cell.hp <= 0) after = 'broken';
    else if (cell.hp <= cell.maxHp * 0.5) after = 'cracked';
    cell.state = after;
    return { cell, before, after, broke: after === 'broken', cracked: before === 'intact' && after === 'cracked', absorbed };
  }

  /** Non-broken cells whose box comes within `r` of the point. */
  cellsNear(x: number, y: number, z: number, r: number): StructureCell[] {
    const out: StructureCell[] = [];
    if (x < this.minX - r || x > this.maxX + r || z < this.minZ - r || z > this.maxZ + r) return out;
    if (y > this.spec.h + r || y < -r) return out;
    for (const c of this.cells) {
      if (c.state === 'broken') continue;
      if (distanceToBox(x, y, z, c) <= r) out.push(c);
    }
    return out;
  }

  /** Neighbouring facade/corner cells on the same floor within one cell of the given one. */
  neighbours(cell: StructureCell, reach = 1): StructureCell[] {
    const out: StructureCell[] = [];
    for (const c of this.byFloor[cell.iy]) {
      if (c === cell || c.state === 'broken' || c.kind === 'slab' || c.kind === 'core') continue;
      if (Math.abs(c.ix - cell.ix) <= reach && Math.abs(c.iz - cell.iz) <= reach) out.push(c);
    }
    // the cell directly above / below
    for (const dy of [-1, 1]) {
      const fl = this.byFloor[cell.iy + dy];
      if (!fl) continue;
      for (const c of fl) if (c.ix === cell.ix && c.iz === cell.iz && c.kind === cell.kind && c.state !== 'broken') out.push(c);
    }
    return out;
  }

  /**
   * Checks every standing floor bottom-up. The first floor below the threshold fails: it and everything above are removed
   * from the model and returned as a Collapse. Returns null when the structure holds.
   */
  evaluate(): Collapse | null {
    if (this.collapsed) return null;
    for (let iy = 0; iy < this.topFloor; iy++) {
      if (this.floorIntegrity(iy) >= this.threshold) continue;
      // Lean toward the side that lost its support.
      let wx = 0;
      let wz = 0;
      let wsum = 0;
      for (const c of this.byFloor[iy]) {
        if (c.kind === 'slab') continue;
        const k = c.state === 'intact' ? 1 : c.state === 'cracked' ? 0.5 : 0;
        wx += (c.x - this.spec.x) * c.weight * k;
        wz += (c.z - this.spec.z) * c.weight * k;
        wsum += c.weight * k;
      }
      let lean = { x: 0, z: 0 };
      if (wsum > 0) {
        const cx = wx / wsum;
        const cz = wz / wsum;
        const len = Math.hypot(cx, cz);
        if (len > 0.3) lean = { x: -cx / len, z: -cz / len };
      }
      const removed: StructureCell[] = [];
      for (let f = iy; f < this.topFloor; f++) {
        for (const c of this.byFloor[f]) {
          if (c.state !== 'broken') {
            c.state = 'broken';
            c.hp = 0;
            removed.push(c);
          }
        }
      }
      const floorsDropped = this.topFloor - iy;
      const y = iy * this.floorHeight;
      this.topFloor = iy;
      this.collapses++;
      this.damaged = true;
      if (iy === 0) this.collapsed = true;
      return { building: this.spec.id, floor: iy, cells: removed, lean, total: iy === 0, floorsDropped, y };
    }
    return null;
  }

  /** Count of cells by state (for summaries and tests). */
  count(state: CellState): number {
    let n = 0;
    for (const c of this.cells) if (c.state === state) n++;
    return n;
  }

  /** Restores the structure to pristine. */
  reset() {
    for (const c of this.cells) {
      c.hp = c.maxHp;
      c.state = 'intact';
    }
    this.topFloor = this.spec.floors;
    this.collapsed = false;
    this.damaged = false;
    this.collapses = 0;
  }
}

/** Debris chunk description produced from collapsed cells: a few boxes per floor instead of one per cell. */
export interface ChunkSpec {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  material: CellMaterial;
  vx: number;
  vy: number;
  vz: number;
}

/**
 * Groups a collapse into rigid-body-sized chunks: per dropped floor, up to four quadrant chunks that take the floor's
 * remaining material. Caps the total so a skyscraper never spawns hundreds of bodies.
 */
export function chunksForCollapse(s: Structure, collapse: Collapse, maxChunks = 36, speed = 7): ChunkSpec[] {
  const spec = s.spec;
  const floors = collapse.floorsDropped;
  const fh = s.floorHeight;
  const perFloor = floors <= 4 ? 4 : floors <= 9 ? 2 : 1;
  const stride = Math.max(1, Math.ceil((floors * perFloor) / maxChunks));
  const out: ChunkSpec[] = [];
  const cellsByFloor = new Map<number, StructureCell[]>();
  for (const c of collapse.cells) {
    const arr = cellsByFloor.get(c.iy) ?? [];
    arr.push(c);
    cellsByFloor.set(c.iy, arr);
  }
  for (let f = collapse.floor; f < collapse.floor + floors; f += stride) {
    const cells = cellsByFloor.get(f) ?? [];
    if (!cells.length) continue;
    const material = cells.find((c) => c.kind === 'facade')?.material ?? cells[0].material;
    const y = f * fh + (fh * stride) / 2;
    const lift = (f - collapse.floor) / Math.max(1, floors);
    const quads = perFloor === 4 ? [[-1, -1], [1, -1], [-1, 1], [1, 1]] : perFloor === 2 ? [[-1, 0], [1, 0]] : [[0, 0]];
    for (const [qx, qz] of quads) {
      const sx = perFloor === 1 ? spec.w * 0.55 : spec.w * 0.42;
      const sz = perFloor === 4 ? spec.d * 0.42 : spec.d * 0.55;
      out.push({
        x: spec.x + qx * spec.w * 0.24,
        y,
        z: spec.z + qz * spec.d * 0.24,
        sx: Math.min(sx, 12),
        sy: Math.min(fh * stride * 0.8, 9),
        sz: Math.min(sz, 12),
        material,
        vx: collapse.lean.x * speed * (0.6 + lift) + qx * 1.5,
        vy: -1 - lift * 2,
        vz: collapse.lean.z * speed * (0.6 + lift) + qz * 1.5,
      });
      if (out.length >= maxChunks) return out;
    }
  }
  return out;
}
