// Small, shared Blender fixtures. All pads cost three instanced draws, not one per lamp.
import * as THREE from 'three/webgpu';
import type { MapDef, V3 } from '../maps/types';
import { padLightOffsets, padWorld } from '../maps/padLayout';
import { loadGltf } from './gltf';

type Fixture = 'lamp_housing' | 'lamp_lens' | 'tie_ring';

export class PadDetails {
  readonly group = new THREE.Group();
  readonly ready: Promise<void>;
  loaded = false;
  private disposed = false;
  private meshes: THREE.InstancedMesh[] = [];
  private lens: THREE.MeshStandardMaterial | null = null;
  private light = 0;
  private readonly positions: Record<Fixture, V3[]> = { lamp_housing: [], lamp_lens: [], tie_ring: [] };

  constructor(map: MapDef) {
    for (const pad of map.pads) {
      if (pad.style === 'field') continue;
      for (const [x, z] of padLightOffsets(pad.size)) {
        const pos = padWorld(pad, x, 0.015, z);
        this.positions.lamp_housing.push(pos);
        this.positions.lamp_lens.push(pos);
      }
      // Four flush fittings outside the touchdown circle. No new collision obstacles.
      const e = pad.size * 0.39;
      for (const [x, z] of [[-e, -e], [e, -e], [e, e], [-e, e]]) this.positions.tie_ring.push(padWorld(pad, x, 0.015, z));
    }
    this.group.name = 'Helipad fixtures';
    this.group.userData.modelLoaded = false;
    this.fallback();
    this.ready = this.load();
  }

  private batch(name: Fixture, geometry: THREE.BufferGeometry, material: THREE.Material): THREE.InstancedMesh {
    const points = this.positions[name];
    const mesh = new THREE.InstancedMesh(geometry, material, points.length);
    mesh.name = name;
    const matrix = new THREE.Matrix4();
    points.forEach((p, i) => mesh.setMatrixAt(i, matrix.makeTranslation(...p)));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.receiveShadow = true;
    // Tiny fixtures have no useful distant shadow; avoid duplicating them in all CSM passes.
    mesh.castShadow = false;
    return mesh;
  }

  private fallback(): void {
    const housing = new THREE.CylinderGeometry(0.11, 0.18, 0.1, 12).translate(0, 0.05, 0);
    const lens = new THREE.SphereGeometry(0.10, 12, 6).scale(1, 0.58, 1).translate(0, 0.113, 0);
    const ring = new THREE.TorusGeometry(0.085, 0.014, 4, 12).rotateX(-Math.PI / 2).translate(0, 0.035, 0);
    this.lens = new THREE.MeshStandardMaterial({ color: 0x8adbb0, emissive: 0x50e697, roughness: 0.16, metalness: 0.1 });
    this.meshes = [
      this.batch('lamp_housing', housing, new THREE.MeshStandardMaterial({ color: 0xbba345, roughness: 0.48, metalness: 0.45 })),
      this.batch('lamp_lens', lens, this.lens),
      this.batch('tie_ring', ring, new THREE.MeshStandardMaterial({ color: 0x59636b, roughness: 0.43, metalness: 0.8 })),
    ];
    this.group.add(...this.meshes);
    this.update(0);
  }

  private async load(): Promise<void> {
    try {
      const gltf = await loadGltf('models/pad_fixtures.glb');
      const geometries = new Set<THREE.BufferGeometry>();
      const materials = new Set<THREE.Material>();
      gltf.scene.traverse((o) => {
        if (!(o as THREE.Mesh).isMesh) return;
        const mesh = o as THREE.Mesh;
        geometries.add(mesh.geometry);
        for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(mat);
      });
      const release = () => { geometries.forEach((g) => g.dispose()); materials.forEach((m) => m.dispose()); };
      if (this.disposed) { release(); return; }
      const names: Fixture[] = ['lamp_housing', 'lamp_lens', 'tie_ring'];
      const sources = names.map((name) => gltf.scene.getObjectByName(name) as THREE.Mesh | undefined);
      if (sources.some((m) => !m?.isMesh || Array.isArray(m.material))) {
        release();
        throw new Error('Helipad fixture model is missing its named material batches');
      }
      gltf.scene.updateMatrixWorld(true);
      const next = sources.map((m, i) => {
        const source = m!;
        source.geometry.applyMatrix4(source.matrixWorld);
        geometries.delete(source.geometry);
        materials.delete(source.material as THREE.Material);
        return this.batch(names[i], source.geometry, source.material as THREE.Material);
      });
      release();
      this.releaseMeshes();
      this.meshes = next;
      this.lens = next[1].material as THREE.MeshStandardMaterial;
      this.group.add(...next);
      this.loaded = true;
      this.group.userData.modelLoaded = true;
      this.update(this.light);
    } catch (error) {
      if (!this.disposed) console.warn('Helipad fixtures: using built-in geometry.', error);
    }
  }

  update(night: number): void {
    this.light = Math.max(0, Math.min(1, night));
    if (this.lens) this.lens.emissiveIntensity = 0.12 + this.light * 2.2;
  }

  private releaseMeshes(): void {
    for (const mesh of this.meshes) {
      mesh.removeFromParent();
      mesh.dispose();
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.meshes = [];
  }

  dispose(): void {
    this.disposed = true;
    this.releaseMeshes();
    this.lens = null;
  }
}
