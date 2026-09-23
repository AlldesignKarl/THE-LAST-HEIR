/**
 * Terreno por chunks con streaming, LOD y colliders bajo demanda (ADR-004).
 * - Mallas visuales: radio `viewChunks`, 3 niveles de detalle + faldones.
 * - Colliders (heightfield de Rapier): solo chunks a distancia ≤ 1.
 * - El chunk con la boca de la cueva usa trimesh para poder tener hueco.
 * - Fondo lejano: una malla de baja resolución de todo el valle.
 */
import * as THREE from 'three';
import type { Heightfield } from './Heightfield';
import { Physics, RAPIER, GROUP, groups, ALL } from '../engine/Physics';
import type { TextureLibrary } from '../engine/placeholder/Textures';
import { GlobalUniforms } from '../engine/placeholder/Materials';
import { CAVE, WORLD_HALF } from './WorldLayout';
import { clamp, smoothstep } from '../core/math';

export const CHUNK = 64;
const LOD_SEGS = [32, 16, 8];
const COLLIDER_SEGS = 32;
const SKIRT = 2.5;

interface Chunk {
  cx: number;
  cz: number;
  lod: number;
  mesh: THREE.Mesh | null;
  collider: RAPIER.Collider | null;
}

export class Terrain {
  readonly material: THREE.MeshStandardMaterial;
  private chunks = new Map<string, Chunk>();
  private group = new THREE.Group();
  private far: THREE.Mesh;
  viewChunks: number;
  /** Chunks construidos por frame (presupuesto de streaming). */
  buildBudget = 3;
  stats = { meshes: 0, colliders: 0, built: 0 };

  constructor(
    private readonly hf: Heightfield,
    private readonly physics: Physics,
    scene: THREE.Scene,
    textures: TextureLibrary,
    viewChunks: number,
  ) {
    this.viewChunks = viewChunks;
    this.material = createTerrainMaterial(textures);
    scene.add(this.group);
    this.far = this.buildFarMesh();
    scene.add(this.far);
  }

  private key(cx: number, cz: number): string {
    return `${cx},${cz}`;
  }

  /** Fuerza la carga síncrona alrededor de un punto (arranque/teletransporte). */
  preload(x: number, z: number): void {
    this.update(x, z, 1e9);
  }

  update(x: number, z: number, budget = this.buildBudget): void {
    const ccx = Math.floor(x / CHUNK), ccz = Math.floor(z / CHUNK);
    const R = this.viewChunks;
    const maxC = Math.floor(WORLD_HALF / CHUNK);
    const wanted: { cx: number; cz: number; d: number }[] = [];
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        const cx = ccx + dx, cz = ccz + dz;
        if (cx < -maxC || cx >= maxC || cz < -maxC || cz >= maxC) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dz));
        if (d > R) continue;
        wanted.push({ cx, cz, d });
      }
    }
    wanted.sort((a, b) => a.d - b.d);
    const keep = new Set<string>();
    let built = 0;
    for (const w of wanted) {
      const k = this.key(w.cx, w.cz);
      keep.add(k);
      const lod = w.d <= 1 ? 0 : w.d <= 2 ? 1 : 2;
      const needCollider = w.d <= 1;
      let c = this.chunks.get(k);
      if (!c) {
        c = { cx: w.cx, cz: w.cz, lod: -1, mesh: null, collider: null };
        this.chunks.set(k, c);
      }
      if (c.lod !== lod && built < budget) {
        this.buildMesh(c, lod);
        built++;
      }
      // Solo los chunks cercanos proyectan sombra (el mapa de sombras cubre ~70 m).
      if (c.mesh) c.mesh.castShadow = w.d <= 1;
      if (needCollider && !c.collider) this.buildCollider(c); // los colliders no esperan
      if (!needCollider && c.collider) {
        this.physics.removeCollider(c.collider);
        c.collider = null;
      }
    }
    for (const [k, c] of this.chunks) {
      if (!keep.has(k)) this.disposeChunk(k, c);
    }
    this.stats.built += built;
    this.stats.meshes = this.group.children.length;
    let cols = 0;
    for (const c of this.chunks.values()) if (c.collider) cols++;
    this.stats.colliders = cols;
  }

  private disposeChunk(k: string, c: Chunk): void {
    if (c.mesh) {
      this.group.remove(c.mesh);
      c.mesh.geometry.dispose();
    }
    if (c.collider) this.physics.removeCollider(c.collider);
    this.chunks.delete(k);
  }

  private chunkHasHole(cx: number, cz: number): boolean {
    const x0 = cx * CHUNK, z0 = cz * CHUNK;
    const h = CAVE.hole;
    return h.x1 >= x0 && h.x0 <= x0 + CHUNK && h.z1 >= z0 && h.z0 <= z0 + CHUNK;
  }

  private buildMesh(c: Chunk, lod: number): void {
    const segs = LOD_SEGS[lod];
    const geo = this.buildGeometry(c.cx * CHUNK, c.cz * CHUNK, CHUNK, segs, lod === 0, true);
    if (c.mesh) {
      c.mesh.geometry.dispose();
      c.mesh.geometry = geo;
    } else {
      c.mesh = new THREE.Mesh(geo, this.material);
      c.mesh.receiveShadow = true;
      c.mesh.castShadow = true;
      c.mesh.matrixAutoUpdate = false;
      this.group.add(c.mesh);
    }
    c.lod = lod;
  }

  /**
   * Genera la geometría de un parche de terreno. Muestrea un borde extra
   * para calcular normales continuas entre chunks.
   */
  buildGeometry(x0: number, z0: number, size: number, segs: number, holes: boolean, skirt: boolean, drop = 0): THREE.BufferGeometry {
    const hf = this.hf;
    const step = size / segs;
    const S = segs + 3; // con borde
    const hs = new Float32Array(S * S);
    for (let j = 0; j < S; j++) {
      for (let i = 0; i < S; i++) {
        hs[j * S + i] = hf.heightAt(x0 + (i - 1) * step, z0 + (j - 1) * step) - drop;
      }
    }
    const V = segs + 1;
    const extra = skirt ? 4 * V : 0;
    const count = V * V + extra;
    const pos = new Float32Array(count * 3);
    const nor = new Float32Array(count * 3);
    const splat = new Float32Array(count * 4);
    const col = new Float32Array(count * 3);
    const H = (i: number, j: number) => hs[(j + 1) * S + (i + 1)];
    for (let j = 0; j < V; j++) {
      for (let i = 0; i < V; i++) {
        const idx = j * V + i;
        const x = x0 + i * step, z = z0 + j * step;
        const h = H(i, j);
        pos[idx * 3] = x; pos[idx * 3 + 1] = h; pos[idx * 3 + 2] = z;
        let nx = H(i - 1, j) - H(i + 1, j), ny = 2 * step, nz = H(i, j - 1) - H(i, j + 1);
        const l = Math.hypot(nx, ny, nz);
        nx /= l; ny /= l; nz /= l;
        nor[idx * 3] = nx; nor[idx * 3 + 1] = ny; nor[idx * 3 + 2] = nz;
        const w = hf.surfaceWeights(x, z);
        const rock = smoothstep(0.82, 0.62, ny) + smoothstep(90, 160, h) * 0.6;
        splat[idx * 4] = clamp(Math.max(w.road, w.village * 0.8, w.camp * 0.9), 0, 1);
        splat[idx * 4 + 1] = clamp(rock, 0, 1);
        splat[idx * 4 + 2] = clamp(w.mud, 0, 1);
        splat[idx * 4 + 3] = clamp(w.field * (1 - w.road), 0, 1);
        // Tinte macro para romper la repetición.
        const tint = 0.85 + 0.3 * (Math.sin(x * 0.013 + z * 0.021) * 0.5 + 0.5) * (Math.cos(z * 0.017 - x * 0.009) * 0.5 + 0.5);
        col[idx * 3] = tint; col[idx * 3 + 1] = tint; col[idx * 3 + 2] = tint * 0.97;
      }
    }
    const indices: number[] = [];
    const hole = holes && this.chunkHasHole(Math.floor(x0 / CHUNK), Math.floor(z0 / CHUNK));
    for (let j = 0; j < segs; j++) {
      for (let i = 0; i < segs; i++) {
        const a = j * V + i, b = a + 1, c = a + V, d = c + 1;
        if (hole) {
          const mx = x0 + (i + 0.5) * step, mz = z0 + (j + 0.5) * step;
          if (hf.isHole(mx, mz)) continue;
        }
        indices.push(a, c, b, b, c, d);
      }
    }
    if (skirt) {
      let k = V * V;
      const edges: number[][] = [[], [], [], []];
      for (let i = 0; i < V; i++) {
        edges[0].push(i); // norte (j=0)
        edges[1].push(segs * V + i); // sur
        edges[2].push(i * V); // oeste
        edges[3].push(i * V + segs); // este
      }
      for (let e = 0; e < 4; e++) {
        const start = k;
        for (const src of edges[e]) {
          pos[k * 3] = pos[src * 3]; pos[k * 3 + 1] = pos[src * 3 + 1] - SKIRT; pos[k * 3 + 2] = pos[src * 3 + 2];
          nor[k * 3] = nor[src * 3]; nor[k * 3 + 1] = nor[src * 3 + 1]; nor[k * 3 + 2] = nor[src * 3 + 2];
          for (let q = 0; q < 4; q++) splat[k * 4 + q] = splat[src * 4 + q];
          col[k * 3] = col[src * 3]; col[k * 3 + 1] = col[src * 3 + 1]; col[k * 3 + 2] = col[src * 3 + 2];
          k++;
        }
        for (let i = 0; i < V - 1; i++) {
          const a = edges[e][i], b = edges[e][i + 1], sa = start + i, sb = start + i + 1;
          // Doble cara para no depender del orden.
          indices.push(a, sa, b, b, sa, sb, a, b, sa, b, sb, sa);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('aSplat', new THREE.BufferAttribute(splat, 4));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(indices);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }

  private buildCollider(c: Chunk): void {
    const x0 = c.cx * CHUNK, z0 = c.cz * CHUNK;
    const n = COLLIDER_SEGS;
    const step = CHUNK / n;
    let desc: RAPIER.ColliderDesc;
    if (this.chunkHasHole(c.cx, c.cz)) {
      // Trimesh con hueco sobre la boca de la cueva.
      const V = n + 1;
      const verts = new Float32Array(V * V * 3);
      for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
        const idx = (j * V + i) * 3;
        verts[idx] = i * step; verts[idx + 1] = this.hf.heightAt(x0 + i * step, z0 + j * step); verts[idx + 2] = j * step;
      }
      const idxs: number[] = [];
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        if (this.hf.isHole(x0 + (i + 0.5) * step, z0 + (j + 0.5) * step)) continue;
        const a = j * V + i, b = a + 1, cc = a + V, d = cc + 1;
        idxs.push(a, cc, b, b, cc, d);
      }
      desc = RAPIER.ColliderDesc.trimesh(verts, new Uint32Array(idxs)).setTranslation(x0, 0, z0);
    } else {
      const heights = new Float32Array((n + 1) * (n + 1));
      for (let j = 0; j <= n; j++) {
        for (let i = 0; i <= n; i++) {
          heights[j * (n + 1) + i] = this.hf.heightAt(x0 + j * step, z0 + i * step);
        }
      }
      desc = RAPIER.ColliderDesc.heightfield(n, n, heights, { x: CHUNK, y: 1, z: CHUNK })
        .setTranslation(x0 + CHUNK / 2, 0, z0 + CHUNK / 2);
    }
    desc.setCollisionGroups(groups(GROUP.TERRAIN, ALL)).setFriction(0.9);
    c.collider = this.physics.world.createCollider(desc);
    this.physics.tag(c.collider, { kind: 'terrain', id: `${c.cx},${c.cz}` });
  }

  private buildFarMesh(): THREE.Mesh {
    const size = WORLD_HALF * 2;
    const g = this.buildGeometry(-WORLD_HALF, -WORLD_HALF, size, 128, false, false, 1.6);
    const m = new THREE.Mesh(g, this.material);
    m.receiveShadow = false;
    m.castShadow = false;
    m.matrixAutoUpdate = false;
    m.renderOrder = -2;
    return m;
  }
}

function createTerrainMaterial(textures: TextureLibrary): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  const grass = textures.get('grass'), dirt = textures.get('dirt'), rock = textures.get('rock');
  const mud = textures.get('mud'), field = textures.get('field');
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.tGrass = { value: grass.map };
    shader.uniforms.tDirt = { value: dirt.map };
    shader.uniforms.tRock = { value: rock.map };
    shader.uniforms.tMud = { value: mud.map };
    shader.uniforms.tField = { value: field.map };
    shader.uniforms.uWetness = GlobalUniforms.uWetness;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aSplat;\nvarying vec4 vSplat;\nvarying vec3 vWPos;\nvarying vec3 vWN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSplat = aSplat;\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWN = normalize(mat3(modelMatrix) * objectNormal);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D tGrass; uniform sampler2D tDirt; uniform sampler2D tRock; uniform sampler2D tMud; uniform sampler2D tField;
        uniform float uWetness;
        varying vec4 vSplat; varying vec3 vWPos; varying vec3 vWN;
        vec3 sampleAT(sampler2D t, vec2 p) {
          // Dos escalas para reducir la repetición visible.
          return texture2D(t, p * 0.28).rgb * mix(0.85, 1.15, texture2D(t, p * 0.041 + 0.37).g);
        }`)
      .replace('#include <map_fragment>', `
        vec3 cg = sampleAT(tGrass, vWPos.xz);
        vec3 cd = sampleAT(tDirt, vWPos.xz);
        vec3 cm = sampleAT(tMud, vWPos.xz);
        vec3 cf = sampleAT(tField, vWPos.xz * vec2(1.0, 0.5));
        vec3 an = abs(normalize(vWN));
        an /= (an.x + an.y + an.z);
        vec3 cr = texture2D(tRock, vWPos.zy * 0.14).rgb * an.x + texture2D(tRock, vWPos.xz * 0.14).rgb * an.y + texture2D(tRock, vWPos.xy * 0.14).rgb * an.z;
        float nmod = texture2D(tGrass, vWPos.xz * 0.07).g - 0.5;
        float wd = smoothstep(0.25, 0.75, vSplat.x + nmod * 0.5);
        float wr = smoothstep(0.3, 0.7, vSplat.y + nmod * 0.3);
        float wm = smoothstep(0.2, 0.8, vSplat.z + nmod * 0.4);
        float wf = smoothstep(0.3, 0.7, vSplat.w);
        vec3 terr = cg;
        terr = mix(terr, cf, wf);
        terr = mix(terr, cd, wd);
        terr = mix(terr, cm, wm);
        terr = mix(terr, cr, wr);
        float wet = uWetness * (1.0 - wr * 0.6) + wm * 0.5;
        terr *= mix(1.0, 0.62, clamp(wet, 0.0, 1.0));
        diffuseColor.rgb *= terr;
      `)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.35, clamp(uWetness * (1.0 - wr) * 0.9 + wm * 0.4, 0.0, 1.0));`);
  };
  mat.customProgramCacheKey = () => 'terrain-splat';
  return mat;
}
