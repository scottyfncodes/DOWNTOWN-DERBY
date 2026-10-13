import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { RAPIER as R } from '../engine/physics';
import { StaticRegistry } from './statics';
import { makeRawEdgeTexture } from './textures';

const _m = new THREE.Matrix4();
const _hidden = new THREE.Matrix4().makeScale(0, 0, 0);

/**
 * Persistent rubble: debris that has come to rest is frozen here as a static instanced box with a fixed collider, so it
 * stays for the whole round, the ball bounces off it, and later debris piles on top of it. One draw call for all of it.
 * If the (large) budget is ever exhausted the oldest piece is reused rather than dropping new rubble.
 */
export class RubbleField {
  readonly mesh: THREE.InstancedMesh;
  private colliders: (RAPIER.Collider | null)[];
  private next = 0;
  private used = 0;
  readonly capacity: number;

  constructor(private world: RAPIER.World, private statics: StaticRegistry, capacity: number) {
    this.capacity = capacity;
    const mat = new THREE.MeshStandardMaterial({ map: makeRawEdgeTexture('concrete'), roughness: 0.95 });
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, capacity);
    this.mesh.name = 'rubble';
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    this.colliders = new Array(capacity).fill(null);
  }

  /** Pieces currently lying in the city. */
  get count(): number {
    return this.used;
  }

  /** Freezes one piece of rubble in place. `collide` adds a fixed collider (skip it for tiny bits). */
  add(pos: THREE.Vector3, quat: THREE.Quaternion, size: THREE.Vector3, color: THREE.Color, collide: boolean): number {
    if (size.x < 0.05 || size.y < 0.05 || size.z < 0.05) return -1;
    const i = this.next;
    this.next = (this.next + 1) % this.capacity;
    if (this.used < this.capacity) this.used++;
    this.removeCollider(i);
    _m.compose(pos, quat, size);
    this.mesh.setMatrixAt(i, _m);
    this.mesh.setColorAt(i, color);
    this.mesh.count = Math.max(this.mesh.count, i + 1);
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    if (collide) {
      const desc = R.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2)
        .setTranslation(pos.x, pos.y, pos.z)
        .setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w })
        .setFriction(0.9)
        .setRestitution(0.15);
      const col = this.world.createCollider(desc);
      this.colliders[i] = col;
      this.statics.register(col, 'rubble', pos.y + size.y / 2);
    }
    return i;
  }

  private removeCollider(i: number) {
    const col = this.colliders[i];
    if (!col) return;
    this.statics.unregister(col.handle);
    this.world.removeCollider(col, false);
    this.colliders[i] = null;
  }

  /** New round: the city is rebuilt, so its rubble goes too. */
  clear() {
    for (let i = 0; i < this.capacity; i++) {
      this.removeCollider(i);
      if (i < this.mesh.count) this.mesh.setMatrixAt(i, _hidden);
    }
    this.mesh.count = 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.next = 0;
    this.used = 0;
  }
}
