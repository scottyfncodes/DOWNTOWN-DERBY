import RAPIER from '@dimforge/rapier3d-compat';

export const GRAVITY = 11.5;
export const FIXED_DT = 1 / 60;

let initialized: Promise<typeof RAPIER> | null = null;

export function loadRapier(): Promise<typeof RAPIER> {
  if (!initialized) initialized = RAPIER.init().then(() => RAPIER);
  return initialized;
}

export interface CollisionPair {
  a: number;
  b: number;
}

export class PhysicsWorld {
  readonly world: RAPIER.World;
  readonly events: RAPIER.EventQueue;
  private accumulator = 0;
  readonly started: CollisionPair[] = [];

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
    this.world.timestep = FIXED_DT;
    this.events = new RAPIER.EventQueue(true);
  }

  /** Steps the world with a fixed timestep. Calls `beforeStep` before each substep and `afterStep` after. */
  step(dt: number, beforeStep: () => void, afterStep: () => void): void {
    this.accumulator = Math.min(this.accumulator + dt, FIXED_DT * 4);
    while (this.accumulator >= FIXED_DT) {
      beforeStep();
      this.started.length = 0;
      this.world.step(this.events);
      this.events.drainCollisionEvents((h1, h2, began) => {
        if (began) this.started.push({ a: h1, b: h2 });
      });
      afterStep();
      this.accumulator -= FIXED_DT;
    }
  }

  dispose(): void {
    this.events.free();
    this.world.free();
  }
}

export { RAPIER };
