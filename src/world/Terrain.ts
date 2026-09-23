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
    lowQuality = false,
  ) {
    this.viewChunks = viewChunks;
    this.material = createTerrainMaterial(textures, lowQuality);
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
    const splat2 = new Float32Array(count * 4);
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
        // Suelo de bosque (hojarasca bajo los árboles) y tinte macro.
        splat2[idx * 4] = hf.forestDensity(x, z);
        splat2[idx * 4 + 1] = 0.9 + 0.2 * (Math.sin(x * 0.013 + z * 0.021) * 0.5 + 0.5) * (Math.cos(z * 0.017 - x * 0.009) * 0.5 + 0.5);
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
          for (let q = 0; q < 4; q++) splat2[k * 4 + q] = splat2[src * 4 + q];
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
    g.setAttribute('aSplat2', new THREE.BufferAttribute(splat2, 4));
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
    const g = this.buildGeometry(-WORLD_HALF, -WORLD_HALF, size, 256, false, false, 1.6);
    const m = new THREE.Mesh(g, this.material);
    m.receiveShadow = false;
    m.castShadow = false;
    m.matrixAutoUpdate = false;
    m.renderOrder = -2;
    return m;
  }
}

function createTerrainMaterial(textures: TextureLibrary, lowQuality: boolean): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 });
  const grass = textures.get('grass'), dirt = textures.get('dirt'), rock = textures.get('rock');
  const mud = textures.get('mud'), field = textures.get('field'), forest = textures.get('forestFloor');
  mat.onBeforeCompile = (shader) => {
    const u = shader.uniforms;
    u.tGrass = { value: grass.map }; u.tGrassN = { value: grass.normalMap };
    u.tForest = { value: forest.map }; u.tForestN = { value: forest.normalMap };
    u.tDirt = { value: dirt.map }; u.tDirtN = { value: dirt.normalMap };
    u.tRock = { value: rock.map }; u.tRockN = { value: rock.normalMap };
    u.tMud = { value: mud.map }; u.tMudN = { value: mud.normalMap };
    u.tField = { value: field.map }; u.tFieldN = { value: field.normalMap };
    u.uWetness = GlobalUniforms.uWetness;
    if (lowQuality) shader.defines = { ...(shader.defines ?? {}), TERRAIN_LQ: '' };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aSplat;\nattribute vec4 aSplat2;\nvarying vec4 vSplat;\nvarying vec4 vSplat2;\nvarying vec3 vWPos;\nvarying vec3 vWN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSplat = aSplat;\nvSplat2 = aSplat2;\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWN = normalize(mat3(modelMatrix) * objectNormal);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D tGrass; uniform sampler2D tGrassN; uniform sampler2D tForest; uniform sampler2D tForestN;
        uniform sampler2D tDirt; uniform sampler2D tDirtN; uniform sampler2D tRock; uniform sampler2D tRockN;
        uniform sampler2D tMud; uniform sampler2D tMudN; uniform sampler2D tField; uniform sampler2D tFieldN;
        uniform float uWetness;
        varying vec4 vSplat; varying vec4 vSplat2; varying vec3 vWPos; varying vec3 vWN;
        vec2 rot2(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
        // Mezcla por altura: la capa con más relieve "gana" en la transición.
        float hblend(float t, float hBase, float hLayer) {
          float a = (hBase + 0.1) * (1.0 - t), b = (hLayer + 0.1) * t;
          float m = max(a, b) - 0.14;
          a = max(a - m, 0.0); b = max(b - m, 0.0);
          return b / (a + b + 1e-5);
        }
        // Muestra con anti-repetición (dos escalas/rotaciones mezcladas por ruido macro).
        void sampleAT(sampler2D tc, sampler2D tn, vec2 p, float scale, float mixK, out vec4 col, out vec2 nrm) {
          vec2 u1 = p * scale;
          col = texture2D(tc, u1);
          nrm = texture2D(tn, u1).xy * 2.0 - 1.0;
          #ifndef TERRAIN_LQ
          vec2 u2 = rot2(p * scale * 0.61, 1.9) + 0.37;
          vec4 c2 = texture2D(tc, u2);
          vec2 n2 = rot2(texture2D(tn, u2).xy * 2.0 - 1.0, -1.9);
          col = mix(col, c2, mixK);
          nrm = mix(nrm, n2, mixK);
          #endif
        }`)
      .replace('#include <map_fragment>', `
        vec2 wp = vWPos.xz;
        float macro = texture2D(tGrass, wp * 0.0071).a;
        float macro2 = texture2D(tDirt, wp * 0.0029 + 0.31).a;
        float mixK = smoothstep(0.38, 0.62, macro);
        float nmod = macro2 - 0.5;
        vec4 cA; vec2 nA; vec4 cB; vec2 nB;
        // Base: hierba.
        sampleAT(tGrass, tGrassN, wp, 0.3, mixK, cA, nA);
        vec3 terr = cA.rgb; vec2 tn = nA; float hh = cA.a;
        // Suelo de bosque.
        float wfo = smoothstep(0.15, 0.7, vSplat2.x + nmod * 0.6) * 0.9;
        if (wfo > 0.001) {
          sampleAT(tForest, tForestN, wp, 0.34, mixK, cB, nB);
          float k = hblend(wfo, hh, cB.a);
          terr = mix(terr, cB.rgb, k); tn = mix(tn, nB, k); hh = mix(hh, cB.a, k);
        }
        // Campo arado.
        float wf = smoothstep(0.3, 0.7, vSplat.w);
        if (wf > 0.001) {
          vec2 fu = wp * vec2(0.18, 0.09);
          cB = texture2D(tField, fu); nB = texture2D(tFieldN, fu).xy * 2.0 - 1.0;
          float k = hblend(wf, hh, cB.a);
          terr = mix(terr, cB.rgb, k); tn = mix(tn, nB, k); hh = mix(hh, cB.a, k);
        }
        // Tierra / camino / pueblo.
        float wd = smoothstep(0.22, 0.7, vSplat.x + nmod * 0.45);
        if (wd > 0.001) {
          sampleAT(tDirt, tDirtN, wp, 0.28, mixK, cB, nB);
          float k = hblend(wd, hh, cB.a);
          terr = mix(terr, cB.rgb, k); tn = mix(tn, nB, k); hh = mix(hh, cB.a, k);
        }
        // Barro de la orilla.
        float wm = smoothstep(0.2, 0.8, vSplat.z + nmod * 0.4);
        if (wm > 0.001) {
          vec2 mu = wp * 0.25;
          cB = texture2D(tMud, mu); nB = texture2D(tMudN, mu).xy * 2.0 - 1.0;
          float k = hblend(wm, hh, cB.a);
          terr = mix(terr, cB.rgb, k); tn = mix(tn, nB, k); hh = mix(hh, cB.a, k);
        }
        // Roca en pendientes (triplanar).
        float wr = smoothstep(0.3, 0.7, vSplat.y + nmod * 0.3);
        vec3 rockWN = vec3(0.0, 1.0, 0.0);
        if (wr > 0.001) {
          vec3 N0 = normalize(vWN);
          #ifndef TERRAIN_LQ
          vec3 an = pow(abs(N0), vec3(4.0));
          an /= (an.x + an.y + an.z);
          vec2 ux = vWPos.zy * 0.12, uy = vWPos.xz * 0.12, uz = vWPos.xy * 0.12;
          vec4 rx = texture2D(tRock, ux), ry = texture2D(tRock, uy), rz = texture2D(tRock, uz);
          vec2 nx = texture2D(tRockN, ux).xy * 2.0 - 1.0, ny = texture2D(tRockN, uy).xy * 2.0 - 1.0, nz = texture2D(tRockN, uz).xy * 2.0 - 1.0;
          cB = rx * an.x + ry * an.y + rz * an.z;
          rockWN = normalize(N0 + (vec3(0.0, nx.y, nx.x) * sign(N0.x) * an.x + vec3(ny.x, 0.0, ny.y) * an.y + vec3(nz.x, nz.y, 0.0) * sign(N0.z) * an.z) * 0.9);
          #else
          cB = texture2D(tRock, vWPos.xz * 0.12);
          rockWN = N0;
          #endif
          float k = hblend(wr, hh, cB.a);
          terr = mix(terr, cB.rgb, k); hh = mix(hh, cB.a, k); wr = k;
        }
        // Nieve en las cumbres (en zonas no demasiado empinadas).
        float snow = smoothstep(175.0, 235.0, vWPos.y + nmod * 50.0) * smoothstep(0.5, 0.8, normalize(vWN).y);
        terr = mix(terr, vec3(0.82, 0.85, 0.9) * (0.9 + 0.1 * hh), snow);
        wr *= 1.0 - snow;
        // Variación macro de tono y brillo (rompe la repetición a distancia).
        terr *= mix(0.84, 1.1, macro2);
        terr = mix(terr, terr * vec3(1.08, 1.02, 0.86), smoothstep(0.55, 0.8, macro) * (1.0 - wr) * 0.6);
        terr *= vSplat2.y;
        // Humedad: oscurece y abrillanta; charcos en las zonas bajas del barro.
        float wet = clamp(uWetness * (1.0 - wr * 0.6) + wm * 0.45, 0.0, 1.0);
        float puddle = smoothstep(0.35, 0.15, hh) * clamp(uWetness * 1.4 + wm * 0.3, 0.0, 1.0);
        terr *= mix(1.0, 0.6, wet);
        terr = mix(terr, terr * 0.45, puddle);
        diffuseColor.rgb *= terr;
      `)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.4, wet * (1.0 - wr) * 0.8);
        roughnessFactor = mix(roughnessFactor, 0.06, puddle);`)
      .replace('#include <normal_fragment_maps>', `{
          vec3 N = normalize(vWN);
          vec3 T = normalize(vec3(1.0, 0.0, 0.0) - N * N.x);
          vec3 B = normalize(vec3(0.0, 0.0, 1.0) - N * N.z);
          vec2 tnn = tn * (1.0 - puddle * 0.9);
          vec3 wN = normalize(T * tnn.x + B * tnn.y + N * sqrt(max(0.05, 1.0 - dot(tnn, tnn))));
          wN = normalize(mix(wN, rockWN, wr));
          normal = normalize((viewMatrix * vec4(wN, 0.0)).xyz);
        }`);
  };
  mat.customProgramCacheKey = () => (lowQuality ? 'terrain-v2-lq' : 'terrain-v2');
  return mat;
}
