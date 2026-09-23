/**
 * Vegetación: árboles colocados de forma determinista por chunk.
 * Render: InstancedMesh globales por especie y LOD (≈6 draw calls para
 * miles de árboles). Colliders de tronco solo en chunks cercanos.
 * Los árboles talados se recuerdan (persistencia) y rebrotan tras días.
 */
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Heightfield } from './Heightfield';
import { Physics, RAPIER, GROUP, groups, ALL } from '../engine/Physics';
import type { MaterialLibrary } from '../engine/placeholder/Materials';
import { Rng, hash2 } from '../core/rng';
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

const NEAR_DIST = 110;
const FAR_DIST = 360;
const COLLIDER_CHUNKS = 1;
const REGROW_DAYS = 6;

function displace(g0: THREE.BufferGeometry, amount: number, seed: number): THREE.BufferGeometry {
  // Soldar vértices para sombreado suave del follaje.
  g0.deleteAttribute('normal');
  g0.deleteAttribute('uv');
  const g = mergeVertices(g0);
  const p = g.attributes.position as THREE.BufferAttribute;
  // Desplazamiento coherente por posición (los vértices duplicados coinciden).
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = hash2(Math.round(x * 50), Math.round(y * 50) * 7 + Math.round(z * 50), seed);
    const s = 1 + (k - 0.5) * amount;
    p.setXYZ(i, x * s, y * s, z * s);
  }
  g.computeVertexNormals();
  // UV esféricas simples para la textura de hojas.
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    uv[i * 2] = Math.atan2(p.getZ(i), p.getX(i)) * 0.8;
    uv[i * 2 + 1] = p.getY(i) * 0.5;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

function colorize(g: THREE.BufferGeometry, r: number, gg: number, b: number): THREE.BufferGeometry {
  const n = g.attributes.position.count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { c[i * 3] = r; c[i * 3 + 1] = gg; c[i * 3 + 2] = b; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

function stripToPosNormUv(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(ng.attributes)) if (!['position', 'normal', 'uv'].includes(k)) ng.deleteAttribute(k);
  return ng;
}

interface SpeciesGeo {
  trunk: THREE.BufferGeometry;
  canopy: THREE.BufferGeometry;
  far: THREE.BufferGeometry;
  trunkHeight: number;
}

function buildOak(): SpeciesGeo {
  const trunk = new THREE.CylinderGeometry(0.22, 0.42, 5, 8, 3);
  trunk.translate(0, 2.5, 0);
  const b1 = new THREE.CylinderGeometry(0.08, 0.16, 2.6, 5);
  b1.rotateZ(0.9); b1.translate(0.9, 4.2, 0);
  const b2 = new THREE.CylinderGeometry(0.08, 0.15, 2.4, 5);
  b2.rotateX(-0.8); b2.translate(0, 4.4, -0.8);
  const trunkAll = mergeGeometries([stripToPosNormUv(trunk), stripToPosNormUv(b1), stripToPosNormUv(b2)])!;
  const blobs: THREE.BufferGeometry[] = [];
  const spots: [number, number, number, number][] = [[0, 6.4, 0, 2.6], [1.5, 5.6, 0.6, 1.9], [-1.3, 5.8, -0.5, 2.0], [0.3, 7.6, -0.9, 1.7], [-0.4, 5.5, 1.5, 1.7]];
  spots.forEach(([x, y, z, r], i) => {
    const g = displace(new THREE.IcosahedronGeometry(r, 1), 0.35, 100 + i);
    g.translate(x, y, z);
    blobs.push(stripToPosNormUv(g));
  });
  const canopy = mergeGeometries(blobs)!;
  const farT = colorize(stripToPosNormUv(new THREE.CylinderGeometry(0.25, 0.4, 5, 5).translate(0, 2.5, 0)), 0.25, 0.19, 0.13);
  const farC = colorize(stripToPosNormUv(displace(new THREE.IcosahedronGeometry(2.9, 0), 0.25, 7).translate(0, 6.4, 0)), 0.16, 0.22, 0.08);
  return { trunk: trunkAll, canopy, far: mergeGeometries([farT, farC])!, trunkHeight: 5 };
}

function buildPine(): SpeciesGeo {
  const trunk = stripToPosNormUv(new THREE.CylinderGeometry(0.13, 0.32, 10, 7, 3).translate(0, 5, 0));
  const cones: THREE.BufferGeometry[] = [];
  const layers = 5;
  for (let i = 0; i < layers; i++) {
    const t = i / (layers - 1);
    const r = 2.4 - t * 1.7;
    const h = 3.2 - t * 0.9;
    const g = displace(new THREE.ConeGeometry(r, h, 9, 2, true), 0.18, 200 + i);
    g.translate(0, 3 + i * 1.65 + h / 2, 0);
    cones.push(stripToPosNormUv(g));
  }
  const canopy = mergeGeometries(cones)!;
  const farT = colorize(stripToPosNormUv(new THREE.CylinderGeometry(0.15, 0.3, 10, 4).translate(0, 5, 0)), 0.22, 0.16, 0.11);
  const farC = colorize(stripToPosNormUv(new THREE.ConeGeometry(2.4, 8.5, 6).translate(0, 7.2, 0)), 0.07, 0.13, 0.07);
  return { trunk, canopy, far: mergeGeometries([farT, farC])!, trunkHeight: 10 };
}

interface SpeciesRender {
  geo: SpeciesGeo;
  nearTrunk: THREE.InstancedMesh;
  nearCanopy: THREE.InstancedMesh;
  far: THREE.InstancedMesh;
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
  ) {
    const farMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
    const mk = (geo: SpeciesGeo, canopyMat: THREE.Material): SpeciesRender => {
      const nearTrunk = new THREE.InstancedMesh(geo.trunk, mats.get('bark'), MAX_NEAR);
      const nearCanopy = new THREE.InstancedMesh(geo.canopy, canopyMat, MAX_NEAR);
      const far = new THREE.InstancedMesh(geo.far, farMat, MAX_FAR);
      for (const m of [nearTrunk, nearCanopy, far]) {
        m.frustumCulled = false;
        m.count = 0;
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        scene.add(m);
      }
      nearTrunk.castShadow = nearCanopy.castShadow = true;
      nearTrunk.receiveShadow = nearCanopy.receiveShadow = true;
      far.receiveShadow = true;
      // Color por instancia (variación de follaje).
      nearCanopy.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_NEAR * 3), 3);
      far.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_FAR * 3), 3);
      return { geo, nearTrunk, nearCanopy, far };
    };
    this.species = { oak: mk(buildOak(), mats.get('leaves')), pine: mk(buildPine(), mats.get('pine')) };
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
          if (d < NEAR_DIST && c.near < MAX_NEAR) {
            sp.nearTrunk.setMatrixAt(c.near, this.tmpM);
            sp.nearCanopy.setMatrixAt(c.near, this.tmpM);
            sp.nearCanopy.setColorAt(c.near, this.tmpC);
            c.near++;
          } else if (c.far < MAX_FAR) {
            sp.far.setMatrixAt(c.far, this.tmpM);
            sp.far.setColorAt(c.far, this.tmpC);
            c.far++;
          }
        }
      }
    }
    let near = 0, far = 0;
    for (const s of ['oak', 'pine'] as TreeSpecies[]) {
      const sp = this.species[s];
      sp.nearTrunk.count = sp.nearCanopy.count = counts[s].near;
      sp.far.count = counts[s].far;
      sp.nearTrunk.instanceMatrix.needsUpdate = true;
      sp.nearCanopy.instanceMatrix.needsUpdate = true;
      sp.far.instanceMatrix.needsUpdate = true;
      if (sp.nearCanopy.instanceColor) sp.nearCanopy.instanceColor.needsUpdate = true;
      if (sp.far.instanceColor) sp.far.instanceColor.needsUpdate = true;
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
