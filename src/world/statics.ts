import type RAPIER from '@dimforge/rapier3d-compat';
import type { MaterialKind } from '../logic/types';

export interface StaticInfo {
  material: MaterialKind;
  /** top surface height, used to tell roof bounces from wall bounces */
  top: number;
  id: string;
}

/** Registry of non-prop colliders (buildings, ground, viaduct, cage). */
export class StaticRegistry {
  readonly byCollider = new Map<number, StaticInfo>();
  private n = 0;
  register(collider: RAPIER.Collider, material: MaterialKind, top: number): void {
    this.byCollider.set(collider.handle, { material, top, id: `${material}-s${this.n++}` });
  }
}
