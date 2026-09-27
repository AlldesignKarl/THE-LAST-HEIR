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

const ACROSS = 12; // divisiones a lo ancho

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
    // El agua casi no tiene color propio: lo que se ve es el reflejo del cielo
    // y de las orillas (Fresnel) y, a través de ella, el lecho oscurecido por
    // la absorción. Se mezcla en "alfa premultiplicado": el reflejo se suma
    // encima aunque el agua sea transparente, como en la realidad.
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.07,
      metalness: 0,
      transparent: true,
      depthWrite: false,
      envMapIntensity: 0.85,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
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
          varying float vDepth; varying vec2 vFlow; varying vec3 vWPos;
          float wHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float wNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
            return mix(mix(wHash(i), wHash(i + vec2(1, 0)), f.x), mix(wHash(i + vec2(0, 1)), wHash(i + vec2(1, 1)), f.x), f.y); }`)
        .replace('#include <map_fragment>', `
          // Orilla irregular: la línea de agua ondula con ruido.
          float dep = vDepth + (wNoise(vWPos.xz * 1.7) - 0.5) * 0.08;
          if (dep < 0.0) discard;
          // La corriente: dos capas que se desplazan a favor del cauce, a distinta velocidad.
          float across = abs(vFlow.x * 2.0 - 1.0);
          float speed = mix(1.0, 0.45, across * across); // más lenta junto a las orillas
          vec2 f1 = vec2(vFlow.x * 1.3, vFlow.y * 0.55 - uTime * 0.42 * speed);
          vec2 f2 = vec2(vFlow.x * 2.7 + 0.37, vFlow.y * 1.35 - uTime * 0.85 * speed);
          vec2 f3 = vec2(vFlow.x * 5.1 + 0.71, vFlow.y * 3.2 - uTime * 1.6 * speed);
          float streaks = texture2D(tWaves, f2).b;
          // Color del cuerpo de agua (dispersión) según la profundidad.
          float dk = 1.0 - exp(-dep * 1.4);
          vec3 body = mix(vec3(0.075, 0.095, 0.07), vec3(0.018, 0.04, 0.036), dk);
          // Espuma: una línea fina donde el agua toca la orilla y regueros en lo somero.
          float edgeFoam = (1.0 - smoothstep(0.0, 0.03, dep)) * (0.45 + 0.55 * wNoise(vWPos.xz * 6.0 + uTime * 0.6));
          float rapid = smoothstep(0.78, 0.95, streaks) * (1.0 - smoothstep(0.15, 0.6, dep)) * 0.55;
          float foam = clamp(edgeFoam * 0.18 + rapid * 0.6, 0.0, 1.0);
          diffuseColor.rgb = mix(body, vec3(0.78, 0.8, 0.76), foam);
          // Transparencia: en lo somero se ve bien el fondo; en las pozas apenas.
          diffuseColor.a = clamp(1.0 - exp(-dep * 1.25), 0.0, 0.86);
          diffuseColor.a = max(diffuseColor.a, foam * 0.8);
          float wEdge = smoothstep(0.0, 0.04, dep);
        `)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          roughnessFactor = mix(roughnessFactor, 0.6, foam);`)
        .replace('#include <normal_fragment_maps>', `{
          vec2 n1 = texture2D(tWaves, f1).xy * 2.0 - 1.0;
          vec2 n2 = texture2D(tWaves, f2).xy * 2.0 - 1.0;
          vec2 n3 = texture2D(tWaves, f3).xy * 2.0 - 1.0;
          float far = smoothstep(8.0, 40.0, length(vWPos - cameraPosition));
          vec2 nn = (n1 * 0.5 + n2 * 0.35 + n3 * 0.25 * (1.0 - far)) * mix(0.36, 0.2, across) * (1.0 - far * 0.6);
          vec3 wN = normalize(vec3(nn.x, 1.0, nn.y));
          normal = normalize((viewMatrix * vec4(wN, 0.0)).xyz);
        }`)
        .replace('#include <opaque_fragment>', `
          // Alfa premultiplicado: cuerpo del agua × cobertura + reflejo encima.
          gl_FragColor = vec4((totalDiffuse * diffuseColor.a + min(totalSpecular * 0.5, vec3(0.9)) * (1.0 - foam * 0.5)) * wEdge, diffuseColor.a * wEdge);
        `)
        .replace('#include <fog_fragment>', `
          #ifdef USE_FOG
            #ifdef FOG_EXP2
              float fogK = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
            #else
              float fogK = smoothstep(fogNear, fogFar, vFogDepth);
            #endif
            gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor * gl_FragColor.a, fogK);
          #endif
        `);
    };
    mat.customProgramCacheKey = () => 'stream-v2';
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.receiveShadow = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
  }

  update(_dt: number): void { /* animado en el shader (uTime) */ }
}
