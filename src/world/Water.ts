/**
 * Agua del arroyo: cinta a lo largo del cauce, subdividida a lo ancho, con
 * la profundidad real bajo cada vértice (nivel del agua − fondo). El color,
 * la transparencia y la espuma dependen de esa profundidad: en la orilla se
 * ve el fondo a través del agua; en las pozas, verde oscuro. La superficie
 * refleja el cielo (IBL + Fresnel del PBR) y sus normales se desplazan a
 * favor de la corriente.
 */
import * as THREE from 'three';
import type { Heightfield } from './Heightfield';
import { STREAM } from './WorldLayout';
import type { TextureLibrary } from '../engine/placeholder/Textures';
import { GlobalUniforms } from '../engine/placeholder/Materials';

const ACROSS = 8; // divisiones a lo ancho

export class Water {
  readonly mesh: THREE.Mesh;

  constructor(hf: Heightfield, scene: THREE.Scene, textures: TextureLibrary) {
    const pts = STREAM.points;
    const halfW = STREAM.width / 2 + 1.6;
    const pos: number[] = [];
    const uv: number[] = [];
    const depth: number[] = [];
    const idx: number[] = [];
    let dist = 0;
    let row = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i];
      const [bx, bz] = pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const steps = Math.max(1, Math.ceil(len / 1.5));
      const dx = (bx - ax) / len, dz = (bz - az) / len;
      for (let s = 0; s <= steps; s++) {
        if (i > 0 && s === 0) continue;
        const t = s / steps;
        const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
        const lvl = hf.waterLevelAt(x, z) ?? hf.heightAt(x, z);
        const nx = -dz, nz = dx;
        for (let k = 0; k <= ACROSS; k++) {
          const f = k / ACROSS * 2 - 1;
          const px = x + nx * halfW * f, pz = z + nz * halfW * f;
          pos.push(px, lvl, pz);
          uv.push(k / ACROSS, dist / 4);
          depth.push(lvl - hf.heightAt(px, pz));
        }
        if (row > 0) {
          const r0 = (row - 1) * (ACROSS + 1), r1 = row * (ACROSS + 1);
          for (let k = 0; k < ACROSS; k++) idx.push(r0 + k, r0 + k + 1, r1 + k, r0 + k + 1, r1 + k + 1, r1 + k);
        }
        row++;
        dist += len / steps;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('aDepth', new THREE.Float32BufferAttribute(depth, 1));
    g.setIndex(idx);
    g.computeVertexNormals();
    const waves = textures.get('waterNormal').normalMap!;
    const mat = new THREE.MeshStandardMaterial({
      color: 0x2a4a44,
      roughness: 0.05,
      metalness: 0,
      transparent: true,
      depthWrite: false,
      envMapIntensity: 0.55,
    });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = GlobalUniforms.uTime;
      shader.uniforms.tWaves = { value: waves };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          attribute float aDepth;
          varying float vDepth; varying vec2 vFlow; varying vec3 vWPos;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vDepth = aDepth; vFlow = uv; vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform float uTime; uniform sampler2D tWaves;
          varying float vDepth; varying vec2 vFlow; varying vec3 vWPos;`)
        .replace('#include <map_fragment>', `
          if (vDepth < 0.0) discard;
          // Corriente: la textura se desplaza a lo largo del cauce.
          vec2 f1 = vec2(vFlow.x * 1.6, vFlow.y * 0.9 - uTime * 0.55);
          vec2 f2 = vec2(vFlow.x * 3.1 + 0.37, vFlow.y * 2.1 - uTime * 0.9);
          float streaks = texture2D(tWaves, f2).r;
          vec3 shallow = vec3(0.3, 0.31, 0.22), mid = vec3(0.08, 0.15, 0.11), deep = vec3(0.025, 0.06, 0.05);
          vec3 water = mix(shallow, mid, smoothstep(0.05, 0.6, vDepth));
          water = mix(water, deep, smoothstep(0.6, 1.8, vDepth));
          // Espuma en la orilla y en los rápidos (líneas que corren).
          float edge = 1.0 - smoothstep(0.0, 0.12, vDepth);
          float foam = max(edge * 0.8, smoothstep(0.72, 0.9, streaks) * (1.0 - smoothstep(0.2, 0.9, vDepth)) * 0.6);
          diffuseColor.rgb = mix(water, vec3(0.85, 0.9, 0.88), foam);
          // En lo somero se ve el fondo (alfa bajo); en las pozas, casi opaco.
          diffuseColor.a = clamp(mix(0.18, 0.9, smoothstep(0.0, 1.2, vDepth)) + foam * 0.5, 0.0, 0.95) * smoothstep(0.0, 0.03, vDepth);
        `)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          roughnessFactor = mix(roughnessFactor, 0.5, foam);`)
        .replace('#include <normal_fragment_maps>', `{
          vec2 n1 = texture2D(tWaves, f1).xy * 2.0 - 1.0;
          vec2 n2 = texture2D(tWaves, f2).xy * 2.0 - 1.0;
          vec2 nn = (n1 * 0.6 + n2 * 0.4) * 0.28;
          vec3 wN = normalize(vec3(nn.x, 1.0, nn.y));
          normal = normalize((viewMatrix * vec4(wN, 0.0)).xyz);
        }`);
    };
    mat.customProgramCacheKey = () => 'stream';
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.receiveShadow = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
  }

  update(_dt: number): void { /* animado en el shader (uTime) */ }
}
