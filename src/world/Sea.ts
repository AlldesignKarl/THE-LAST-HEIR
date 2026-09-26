/**
 * Mar del Este. Plano con oleaje en el vertex shader, color según la
 * profundidad real del fondo (textura de profundidad horneada desde el
 * Heightfield al arrancar), espuma en la orilla y reflejo del cielo (IBL).
 */
import * as THREE from 'three';
import type { Heightfield } from './Heightfield';
import { SEA } from './WorldLayout';
import type { TextureLibrary } from '../engine/placeholder/Textures';
import { GlobalUniforms } from '../engine/placeholder/Materials';

/** Región con profundidad horneada (2 m por texel). */
const REGION = { x0: 40, z0: -640, w: 640, h: 1280, texel: 2.5 };

export class Sea {
  readonly mesh: THREE.Mesh;
  private depthTex: THREE.DataTexture;

  constructor(private readonly hf: Heightfield, scene: THREE.Scene, textures: TextureLibrary) {
    const W = Math.round(REGION.w / REGION.texel), H = Math.round(REGION.h / REGION.texel);
    const data = new Uint8Array(W * H * 4);
    for (let j = 0; j < H; j++) {
      const z = REGION.z0 + (j + 0.5) * REGION.texel;
      for (let i = 0; i < W; i++) {
        const x = REGION.x0 + (i + 0.5) * REGION.texel;
        const d = SEA.level - hf.heightAt(x, z);
        const k = (j * W + i) * 4;
        // R: profundidad (0..25 m); G: 1 = tierra (el mar se descarta).
        data[k] = Math.max(0, Math.min(255, (d / 25) * 255));
        data[k + 1] = d <= 0 ? 255 : 0;
        data[k + 3] = 255;
      }
    }
    this.depthTex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
    this.depthTex.magFilter = this.depthTex.minFilter = THREE.LinearFilter;
    this.depthTex.needsUpdate = true;

    const geo = new THREE.PlaneGeometry(3000, 3600, 200, 240).rotateX(-Math.PI / 2);
    geo.translate(40 + 1500, 0, 0);
    const normal = textures.get('waterNormal').normalMap!;
    const mat = new THREE.MeshStandardMaterial({
      color: 0x1f4a52,
      roughness: 0.07,
      metalness: 0,
      transparent: true,
      side: THREE.DoubleSide,
      envMapIntensity: 0.55,
    });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = GlobalUniforms.uTime;
      shader.uniforms.uWind = GlobalUniforms.uWind;
      shader.uniforms.tDepth = { value: this.depthTex };
      shader.uniforms.tWaves = { value: normal };
      shader.uniforms.uRegion = { value: new THREE.Vector4(REGION.x0, REGION.z0, REGION.w, REGION.h) };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          uniform float uTime; uniform float uWind;
          varying vec3 vSeaPos;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          {
            vec3 w = (modelMatrix * vec4(transformed, 1.0)).xyz;
            float amp = 0.12 + uWind * 0.25;
            transformed.y += amp * (sin(w.x * 0.08 + uTime * 1.1) * 0.6 + sin(w.z * 0.11 - uTime * 0.9) * 0.4 + sin((w.x + w.z) * 0.21 + uTime * 1.7) * 0.25);
            vSeaPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
          }`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform float uTime; uniform float uWind;
          uniform sampler2D tDepth; uniform sampler2D tWaves; uniform vec4 uRegion;
          varying vec3 vSeaPos;`)
        .replace('#include <map_fragment>', `
          vec2 ruv = (vSeaPos.xz - uRegion.xy) / uRegion.zw;
          bool inRegion = ruv.x > 0.0 && ruv.x < 1.0 && ruv.y > 0.0 && ruv.y < 1.0;
          vec4 dd = inRegion ? texture2D(tDepth, ruv) : vec4(1.0, 0.0, 0.0, 1.0);
          float depth = dd.r * 25.0;
          vec3 shallow = vec3(0.13, 0.3, 0.28), mid = vec3(0.04, 0.16, 0.19), deep = vec3(0.012, 0.055, 0.08);
          vec3 water = mix(shallow, mid, smoothstep(0.3, 4.0, depth));
          water = mix(water, deep, smoothstep(4.0, 18.0, depth));
          // Espuma: orilla y crestas, rota por ruido animado.
          float fn = texture2D(tWaves, vSeaPos.xz * 0.09 + vec2(uTime * 0.02, uTime * 0.013)).r;
          float shore = 1.0 - smoothstep(0.0, 0.9, depth);
          float surf = shore * smoothstep(0.35, 0.75, fn + 0.25 * sin(depth * 5.0 - uTime * 2.2));
          diffuseColor.rgb = mix(water, vec3(0.9, 0.93, 0.92), surf * 0.85);
          diffuseColor.a = (mix(0.62, 0.97, smoothstep(0.0, 1.6, depth)) + surf * 0.5) * (1.0 - dd.g);
        `)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          roughnessFactor = mix(roughnessFactor, 0.6, surf);`)
        .replace('#include <normal_fragment_maps>', `{
          vec2 n1 = texture2D(tWaves, vSeaPos.xz * 0.035 + vec2(uTime * 0.012, uTime * 0.007)).xy * 2.0 - 1.0;
          vec2 n2 = texture2D(tWaves, vSeaPos.xz * 0.11 - vec2(uTime * 0.02, -uTime * 0.016)).xy * 2.0 - 1.0;
          vec2 nn = (n1 * 0.6 + n2 * 0.4) * (0.35 + uWind * 0.5);
          vec3 wN = normalize(vec3(nn.x, 1.0, nn.y));
          normal = normalize((viewMatrix * vec4(wN, 0.0)).xyz);
        }`);
    };
    mat.customProgramCacheKey = () => 'sea';
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.y = SEA.level;
    this.mesh.receiveShadow = false; // el mapa de sombras en ángulo rasante producía dientes de sierra
    this.mesh.renderOrder = 1;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  /** Nivel del agua con el oleaje aproximado en (x,z) (para barcas y flotación). */
  surfaceAt(x: number, z: number, time: number, wind: number): number {
    const amp = 0.12 + wind * 0.25;
    return SEA.level + amp * (Math.sin(x * 0.08 + time * 1.1) * 0.6 + Math.sin(z * 0.11 - time * 0.9) * 0.4 + Math.sin((x + z) * 0.21 + time * 1.7) * 0.25);
  }

  /** Profundidad del agua en (x,z) (≤0 en tierra). */
  depthAt(x: number, z: number): number {
    return SEA.level - this.hf.heightAt(x, z);
  }
}
