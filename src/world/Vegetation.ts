/**
 * Vegetación: árboles colocados de forma determinista por chunk.
 * Render: InstancedMesh globales por especie y LOD (≈6 draw calls para
 * miles de árboles). Colliders de tronco solo en chunks cercanos.
 * Los árboles talados se recuerdan (persistencia) y rebrotan tras días.
 */
import * as THREE from 'three';
import type { Heightfield } from './Heightfield';
import { Physics, RAPIER, GROUP, groups, ALL } from '../engine/Physics';
import type { MaterialLibrary } from '../engine/placeholder/Materials';
import { Rng, hash2 } from '../core/rng';
import { buildOak, buildPine, foliageMaterial, type SpeciesGeo } from './TreeModels';
import { oakFoliage, pineFoliage } from '../engine/placeholder/FoliageTextures';
import { CHUNK } from './Terrain';
import { WORLD_HALF } from './WorldLayout';

export type TreeSpecies = 'oak' | 'pine';

export interface Tree {
  id: string;
  x: number;
  y: number;
  z: number;
  species: TreeSpecies;
  scale: number;
  rot: number;
  tint: number;
  health: number;
  maxHealth: number;
  radius: number;
}

const FAR_DIST = 360;
const COLLIDER_CHUNKS = 1;
const REGROW_DAYS = 6;

interface SpeciesRender {
  geo: SpeciesGeo;
  trunkMat: THREE.Material;
  canopyMat: THREE.Material;
  nearTrunk: THREE.InstancedMesh;
  nearCanopy: THREE.InstancedMesh;
  farTrunk: THREE.InstancedMesh;
  farCanopy: THREE.InstancedMesh;
}

const MAX_NEAR = 1600;
const MAX_FAR = 9000;

export class Vegetation {
  private trees = new Map<string, Tree>();
  private chunkTrees = new Map<string, Tree[]>();
  private chunkColliders = new Map<string, RAPIER.Collider[]>();
  private colliderTree = new Map<number, string>();
  /** id → día en que fue talado. */
  felled = new Map<string, number>();
  private species: Record<TreeSpecies, SpeciesRender>;
  private lastRebuild = new THREE.Vector3(1e9, 0, 1e9);
  private dirty = true;
  private tmpM = new THREE.Matrix4();
  private tmpQ = new THREE.Quaternion();
  private tmpS = new THREE.Vector3();
  private tmpP = new THREE.Vector3();
  private tmpC = new THREE.Color();
  stats = { near: 0, far: 0, colliders: 0 };

  constructor(
    private readonly hf: Heightfield,
    private readonly physics: Physics,
    scene: THREE.Scene,
    mats: MaterialLibrary,
    /** Detalle del follaje 0..1 y distancia de árboles completos (calidad). */
    detail = 0.7,
    private readonly nearDist = 100,
  ) {
    const barkMat = (id: 'bark' | 'pineBark') => {
      const m = mats.get(id).clone();
      m.vertexColors = true; // oclusión en la base del tronco
      return m;
    };
    const mk = (geo: SpeciesGeo, trunkMat: THREE.Material, canopyMat: THREE.Material): SpeciesRender => {
      const nearTrunk = new THREE.InstancedMesh(geo.trunk, trunkMat, MAX_NEAR);
      const nearCanopy = new THREE.InstancedMesh(geo.canopy, canopyMat, MAX_NEAR);
      const farTrunk = new THREE.InstancedMesh(geo.farTrunk, trunkMat, MAX_FAR);
      const farCanopy = new THREE.InstancedMesh(geo.farCanopy, canopyMat, MAX_FAR);
      for (const m of [nearTrunk, nearCanopy, farTrunk, farCanopy]) {
        m.frustumCulled = false;
        m.count = 0;
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        scene.add(m);
      }
      nearTrunk.castShadow = nearCanopy.castShadow = true;
      nearTrunk.receiveShadow = nearCanopy.receiveShadow = true;
      farCanopy.receiveShadow = farTrunk.receiveShadow = true;
      // Color por instancia (variación de follaje).
      nearCanopy.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_NEAR * 3), 3);
      farCanopy.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_FAR * 3), 3);
      return { geo, trunkMat, canopyMat, nearTrunk, nearCanopy, farTrunk, farCanopy };
    };
    const texSize = detail > 0.5 ? 512 : 256;
    this.species = {
      oak: mk(buildOak(detail), barkMat('bark'), foliageMaterial(oakFoliage(texSize), 1)),
      pine: mk(buildPine(detail), barkMat('pineBark'), foliageMaterial(pineFoliage(texSize, texSize / 2), 0.6)),
    };
  }

  private chunkKey(cx: number, cz: number): string {
    return `${cx},${cz}`;
  }

  /** Árboles de un chunk (generación determinista perezosa). */
  treesInChunk(cx: number, cz: number): Tree[] {
    const k = this.chunkKey(cx, cz);
    let list = this.chunkTrees.get(k);
    if (list) return list;
    list = [];
    const rng = new Rng((cx * 73856093) ^ (cz * 19349663) ^ 0x5eed);
    const spacing = 5.5;
    const n = Math.floor(CHUNK / spacing);
    let idx = 0;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = cx * CHUNK + (i + rng.range(0.1, 0.9)) * spacing;
        const z = cz * CHUNK + (j + rng.range(0.1, 0.9)) * spacing;
        const r = rng.next();
        const d = this.hf.forestDensity(x, z);
        if (r > d * 0.85) continue;
        const pineBias = z < -250 ? 0.7 : 0.25 + (hash2(Math.floor(x / 90), Math.floor(z / 90), 3) - 0.5) * 0.5;
        const species: TreeSpecies = rng.next() < pineBias ? 'pine' : 'oak';
        const scale = rng.range(0.8, 1.3);
        const id = `t:${cx}:${cz}:${idx++}`;
        const maxHealth = species === 'oak' ? 100 : 70;
        list.push({
          id, x, z, y: this.hf.heightAt(x, z) - 0.1, species, scale, rot: rng.range(0, Math.PI * 2),
          tint: rng.range(0.75, 1.15), health: maxHealth, maxHealth,
          radius: (species === 'oak' ? 0.4 : 0.3) * scale,
        });
      }
    }
    for (const t of list) this.trees.set(t.id, t);
    this.chunkTrees.set(k, list);
    return list;
  }

  isStanding(t: Tree): boolean {
    return !this.felled.has(t.id);
  }

  getTree(id: string): Tree | undefined {
    if (!this.trees.has(id)) {
      const [, cx, cz] = id.split(':');
      this.treesInChunk(Number(cx), Number(cz));
    }
    return this.trees.get(id);
  }

  treeIdForCollider(handle: number): string | undefined {
    return this.colliderTree.get(handle);
  }

  /** Árboles en pie cerca de un punto (para evitar obstáculos en IA). */
  nearbyTrees(x: number, z: number, r: number, out: Tree[] = []): Tree[] {
    out.length = 0;
    const c0x = Math.floor((x - r) / CHUNK), c1x = Math.floor((x + r) / CHUNK);
    const c0z = Math.floor((z - r) / CHUNK), c1z = Math.floor((z + r) / CHUNK);
    for (let cz = c0z; cz <= c1z; cz++) for (let cx = c0x; cx <= c1x; cx++) {
      for (const t of this.treesInChunk(cx, cz)) {
        if (!this.isStanding(t)) continue;
        if (Math.abs(t.x - x) < r && Math.abs(t.z - z) < r) out.push(t);
      }
    }
    return out;
  }

  /** Marca un árbol como talado (quita collider y render). */
  fell(id: string, day: number): Tree | undefined {
    const t = this.getTree(id);
    if (!t || this.felled.has(id)) return undefined;
    this.felled.set(id, day);
    // Quitar su collider si existe.
    const k = this.chunkKey(Math.floor(t.x / CHUNK), Math.floor(t.z / CHUNK));
    const cols = this.chunkColliders.get(k);
    if (cols) {
      const i = cols.findIndex((c) => this.colliderTree.get(c.handle) === id);
      if (i >= 0) {
        this.colliderTree.delete(cols[i].handle);
        this.physics.removeCollider(cols[i]);
        cols.splice(i, 1);
      }
    }
    this.dirty = true;
    return t;
  }

  /** Rebrote de árboles tras REGROW_DAYS. */
  regrow(currentDay: number): void {
    for (const [id, day] of this.felled) {
      if (currentDay - day >= REGROW_DAYS) {
        this.felled.delete(id);
        const t = this.getTree(id);
        if (t) {
          t.health = t.maxHealth;
          // Forzar recreación de colliders del chunk.
          const k = this.chunkKey(Math.floor(t.x / CHUNK), Math.floor(t.z / CHUNK));
          const cols = this.chunkColliders.get(k);
          if (cols) {
            for (const c of cols) { this.colliderTree.delete(c.handle); this.physics.removeCollider(c); }
            this.chunkColliders.delete(k);
          }
        }
        this.dirty = true;
      }
    }
  }

  update(camX: number, camZ: number, force = false): void {
    // Colliders de troncos en chunks cercanos.
    const ccx = Math.floor(camX / CHUNK), ccz = Math.floor(camZ / CHUNK);
    const keep = new Set<string>();
    for (let dz = -COLLIDER_CHUNKS; dz <= COLLIDER_CHUNKS; dz++) {
      for (let dx = -COLLIDER_CHUNKS; dx <= COLLIDER_CHUNKS; dx++) {
        const cx = ccx + dx, cz = ccz + dz;
        const k = this.chunkKey(cx, cz);
        keep.add(k);
        if (this.chunkColliders.has(k)) continue;
        const cols: RAPIER.Collider[] = [];
        for (const t of this.treesInChunk(cx, cz)) {
          if (!this.isStanding(t)) continue;
          const h = (t.species === 'oak' ? 5 : 10) * t.scale;
          const desc = RAPIER.ColliderDesc.cylinder(h / 2, t.radius)
            .setTranslation(t.x, t.y + h / 2, t.z)
            .setCollisionGroups(groups(GROUP.STATIC, ALL));
          const c = this.physics.world.createCollider(desc);
          this.physics.tag(c, { kind: 'tree', id: t.id });
          this.colliderTree.set(c.handle, t.id);
          cols.push(c);
        }
        this.chunkColliders.set(k, cols);
      }
    }
    for (const [k, cols] of this.chunkColliders) {
      if (keep.has(k)) continue;
      for (const c of cols) { this.colliderTree.delete(c.handle); this.physics.removeCollider(c); }
      this.chunkColliders.delete(k);
    }
    let nc = 0;
    for (const cols of this.chunkColliders.values()) nc += cols.length;
    this.stats.colliders = nc;

    // Reconstrucción de instancias cuando la cámara se mueve lo suficiente.
    const moved = Math.hypot(camX - this.lastRebuild.x, camZ - this.lastRebuild.z);
    if (!force && !this.dirty && moved < 12) return;
    this.lastRebuild.set(camX, 0, camZ);
    this.dirty = false;
    this.rebuildInstances(camX, camZ);
  }

  private rebuildInstances(camX: number, camZ: number): void {
    const counts: Record<TreeSpecies, { near: number; far: number }> = { oak: { near: 0, far: 0 }, pine: { near: 0, far: 0 } };
    const R = Math.ceil(FAR_DIST / CHUNK);
    const ccx = Math.floor(camX / CHUNK), ccz = Math.floor(camZ / CHUNK);
    const maxC = Math.floor(WORLD_HALF / CHUNK);
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        const cx = ccx + dx, cz = ccz + dz;
        if (cx < -maxC || cx >= maxC || cz < -maxC || cz >= maxC) continue;
        for (const t of this.treesInChunk(cx, cz)) {
          if (!this.isStanding(t)) continue;
          const d = Math.hypot(t.x - camX, t.z - camZ);
          if (d > FAR_DIST) continue;
          const sp = this.species[t.species];
          const c = counts[t.species];
          this.tmpQ.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, t.rot);
          this.tmpS.setScalar(t.scale);
          this.tmpP.set(t.x, t.y, t.z);
          this.tmpM.compose(this.tmpP, this.tmpQ, this.tmpS);
          this.tmpC.setRGB(t.tint, t.tint * (0.95 + (t.tint - 0.75) * 0.2), t.tint * 0.9);
          if (d < this.nearDist && c.near < MAX_NEAR) {
            sp.nearTrunk.setMatrixAt(c.near, this.tmpM);
            sp.nearCanopy.setMatrixAt(c.near, this.tmpM);
            sp.nearCanopy.setColorAt(c.near, this.tmpC);
            c.near++;
          } else if (c.far < MAX_FAR) {
            sp.farTrunk.setMatrixAt(c.far, this.tmpM);
            sp.farCanopy.setMatrixAt(c.far, this.tmpM);
            sp.farCanopy.setColorAt(c.far, this.tmpC);
            c.far++;
          }
        }
      }
    }
    let near = 0, far = 0;
    for (const s of ['oak', 'pine'] as TreeSpecies[]) {
      const sp = this.species[s];
      sp.nearTrunk.count = sp.nearCanopy.count = counts[s].near;
      sp.farTrunk.count = sp.farCanopy.count = counts[s].far;
      for (const m of [sp.nearTrunk, sp.nearCanopy, sp.farTrunk, sp.farCanopy]) m.instanceMatrix.needsUpdate = true;
      if (sp.nearCanopy.instanceColor) sp.nearCanopy.instanceColor.needsUpdate = true;
      if (sp.farCanopy.instanceColor) sp.farCanopy.instanceColor.needsUpdate = true;
      near += counts[s].near;
      far += counts[s].far;
    }
    this.stats.near = near;
    this.stats.far = far;
  }

  /** Geometrías de la especie (para el árbol que cae). */
  speciesGeometry(s: TreeSpecies): SpeciesGeo {
    return this.species[s].geo;
  }

  /** Materiales de la especie (para el árbol que cae). */
  speciesMaterials(s: TreeSpecies): { trunk: THREE.Material; canopy: THREE.Material } {
    return { trunk: this.species[s].trunkMat, canopy: this.species[s].canopyMat };
  }

  serialize(): object {
    return { felled: [...this.felled.entries()] };
  }

  deserialize(d: { felled: [string, number][] }): void {
    // Restaurar colliders: limpiar todo y dejar que update los recree.
    for (const cols of this.chunkColliders.values()) {
      for (const c of cols) { this.colliderTree.delete(c.handle); this.physics.removeCollider(c); }
    }
    this.chunkColliders.clear();
    this.felled = new Map(d.felled);
    for (const t of this.trees.values()) t.health = t.maxHealth;
    this.dirty = true;
  }
}
