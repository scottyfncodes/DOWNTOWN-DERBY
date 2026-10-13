import { createRng, type Rng } from './rng';
import { WALL_T, type BuildingSpec, type BuildingStyle } from './structure';

export const PITCH = 72;
export const BLOCK = 56;
export const ROWS = 8;
export const COLS = 9;
export const ROOF_Y = 46;
export const CITY_SEED = 20261012;
/** Centre z of the first row of blocks (negative z is away from the batter). */
export const CITY_Z0 = 76;
/**
 * Every building in the grid is destructible. The near blocks (in front of the batter) use fine sections; everything
 * further out uses sections twice as wide and twice as tall (textures tile to match) to keep the city phone-sized.
 */
export const NEAR_ROWS = 4;
export const NEAR_COL_MIN = 2;
export const NEAR_COL_MAX = 6;
/** Section size multiplier for buildings outside the near blocks. */
export const FAR_GRAIN = 2;
/** Target cell footprint (m) and floor height (m). */
export const CELL_W = 9;
export const FLOOR_H = 4.8;
export const FLOOR_H_TALL = 6.4;

export type Style = BuildingStyle;

export interface Building {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  style: Style;
  row: number;
  col: number;
  destructible: boolean;
  /** section size multiplier (1 = near detail, FAR_GRAIN = distant buildings) */
  grain: number;
}

function rowHeight(rng: Rng, row: number): number {
  const ranges: [number, number][] = [
    [40, 66],
    [20, 58],
    [26, 90],
    [48, 115],
    [50, 130],
    [70, 160],
    [90, 190],
    [110, 225],
  ];
  const [lo, hi] = ranges[Math.min(ROWS - 1, row)];
  let h = rng.range(lo, hi);
  if (rng.chance(0.12)) h *= 1.3;
  return Math.min(240, Math.round(h));
}

function pickStyle(rng: Rng, row: number): Style {
  const r = rng.next();
  if (row <= 1) return r < 0.38 ? 'concrete' : r < 0.74 ? 'brick' : r < 0.9 ? 'glass' : 'tower';
  if (row <= 4) return r < 0.25 ? 'concrete' : r < 0.4 ? 'brick' : r < 0.75 ? 'glass' : 'tower';
  return r < 0.15 ? 'concrete' : r < 0.55 ? 'glass' : 'tower';
}

export function isNearLot(row: number, col: number): boolean {
  return row < NEAR_ROWS && col >= NEAR_COL_MIN && col <= NEAR_COL_MAX;
}

/** Every lot is destructible; kept as a function so callers read clearly. */
export function isDestructibleLot(_row: number, _col: number): boolean {
  return true;
}

export function lotGrain(row: number, col: number): number {
  return isNearLot(row, col) ? 1 : FAR_GRAIN;
}

/** Procedural lot layout for the whole grid. Deterministic for a seed. */
export function generateLayout(seed = CITY_SEED): Building[] {
  const rng = createRng(seed);
  const buildings: Building[] = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const cx = (col - (COLS - 1) / 2) * PITCH;
      const cz = -(CITY_Z0 + row * PITCH);
      const destructible = isDestructibleLot(row, col);
      const near = isNearLot(row, col);
      const grain = lotGrain(row, col);
      const split = rng.next();
      const lots: [number, number, number, number][] = [];
      const half = BLOCK / 2;
      // Near blocks favour one or two bigger lots: fewer, more convincing buildings.
      const one = near ? 0.42 : 0.3;
      const two = near ? 0.9 : 0.8;
      if (split < one) lots.push([cx, cz, BLOCK, BLOCK]);
      else if (split < (one + two) / 2) lots.push([cx - half / 2, cz, half, BLOCK], [cx + half / 2, cz, half, BLOCK]);
      else if (split < two) lots.push([cx, cz - half / 2, BLOCK, half], [cx, cz + half / 2, BLOCK, half]);
      else lots.push([cx - half / 2, cz - half / 2, half, half], [cx + half / 2, cz - half / 2, half, half], [cx - half / 2, cz + half / 2, half, half], [cx + half / 2, cz + half / 2, half, half]);
      for (const [lx, lz, lw, ld] of lots) {
        const inset = rng.range(2, 5);
        const w = Math.round(lw - inset * 2);
        const d = Math.round(ld - inset * 2);
        buildings.push({ x: lx, z: lz, w, d, h: rowHeight(rng, row), style: pickStyle(rng, row), row, col, destructible, grain });
      }
    }
  }
  return buildings;
}

/** Converts a lot into a structural spec: floors, cell counts, core. Snaps height to whole floors. */
export function toBuildingSpec(b: Building, id: number): BuildingSpec {
  const g = b.grain ?? 1;
  const fh = (b.h > 56 ? FLOOR_H_TALL : FLOOR_H) * g;
  const floors = Math.max(2, Math.round(b.h / fh));
  const h = floors * fh;
  const nx = Math.max(2, Math.round((b.w - 2 * WALL_T) / (CELL_W * g)));
  const nz = Math.max(2, Math.round((b.d - 2 * WALL_T) / (CELL_W * g)));
  const lowRise = (floors <= 4 && (b.style === 'brick' || b.style === 'concrete')) || (floors <= 6 && b.style === 'brick');
  const core = !lowRise && Math.min(b.w, b.d) >= 14;
  return { id, x: b.x, z: b.z, w: b.w, d: b.d, h, style: b.style, floors, nx, nz, core, grain: g };
}

export interface CityPlan {
  /** destructible buildings (structural specs) */
  destructible: BuildingSpec[];
  /** static backdrop buildings */
  backdrop: Building[];
  /** every lot, for prop placement */
  all: Building[];
}

export function planCity(seed = CITY_SEED): CityPlan {
  const all = generateLayout(seed);
  const destructible: BuildingSpec[] = [];
  const backdrop: Building[] = [];
  for (const b of all) {
    if (b.destructible) {
      const spec = toBuildingSpec(b, destructible.length);
      b.h = spec.h;
      destructible.push(spec);
    } else backdrop.push(b);
  }
  return { destructible, backdrop, all };
}

/** Rough cell count for a spec (perimeter + corners + core + slab per floor). */
export function estimateCells(spec: BuildingSpec): number {
  return spec.floors * (2 * (spec.nx + spec.nz) + 4 + (spec.core ? 1 : 0) + 1);
}
