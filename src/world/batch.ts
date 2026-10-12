import * as THREE from 'three';

/** A growable InstancedMesh wrapper so hundreds of props cost one draw call per part type. */
export class InstancedBatch {
  readonly mesh: THREE.InstancedMesh;
  private count = 0;
  private static zero = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(geometry: THREE.BufferGeometry, material: THREE.Material, capacity: number, shadows = true) {
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = shadows;
    this.mesh.receiveShadow = shadows;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }

  add(matrix: THREE.Matrix4, color?: THREE.Color): number {
    const idx = this.count++;
    if (idx >= (this.mesh.instanceMatrix.count ?? 0)) {
      console.warn('InstancedBatch capacity exceeded', this.mesh.name);
      return -1;
    }
    this.mesh.count = this.count;
    this.mesh.setMatrixAt(idx, matrix);
    if (color) this.mesh.setColorAt(idx, color);
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    return idx;
  }

  set(idx: number, matrix: THREE.Matrix4): void {
    if (idx < 0) return;
    this.mesh.setMatrixAt(idx, matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  setColor(idx: number, color: THREE.Color): void {
    if (idx < 0) return;
    this.mesh.setColorAt(idx, color);
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  hide(idx: number): void {
    this.set(idx, InstancedBatch.zero);
  }
}
