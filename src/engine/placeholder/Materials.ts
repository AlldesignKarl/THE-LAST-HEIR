/**
 * Materiales del juego. Los ids de material son estables; el contenido
 * (texturas procedurales) es placeholder y se puede sustituir por PBR.
 */
import * as THREE from 'three';
import { TextureLibrary, type TexId } from './Textures';

/** Uniforms globales compartidos por shaders (viento, tiempo, humedad). */
export const GlobalUniforms = {
  uTime: { value: 0 },
  uWind: { value: 0.3 },
  uWetness: { value: 0 },
};

export type MatId =
  | 'stoneWall' | 'plaster' | 'wattle' | 'planks' | 'darkWood' | 'beam' | 'thatch' | 'tiles'
  | 'rock' | 'caveRock' | 'bark' | 'pineBark' | 'roughWood' | 'cobble' | 'rope' | 'sand' | 'leaves' | 'pine' | 'cloth' | 'clothRed' | 'metal' | 'iron' | 'gold'
  | 'straw' | 'dirt' | 'bread' | 'meat' | 'meatCooked' | 'apple' | 'leather' | 'paper' | 'ash' | 'charred';

interface MatSpec {
  tex?: TexId;
  color?: number;
  roughness: number;
  metalness?: number;
  normalScale?: number;
  wind?: boolean;
}

const SPECS: Record<MatId, MatSpec> = {
  stoneWall: { tex: 'stoneWall', roughness: 0.92, normalScale: 1 },
  plaster: { tex: 'plaster', roughness: 0.95 },
  wattle: { tex: 'wattle', roughness: 0.95 },
  planks: { tex: 'planks', roughness: 0.85 },
  darkWood: { tex: 'planks', color: 0x8a7866, roughness: 0.8 },
  beam: { tex: 'roughWood', color: 0xb09a80, roughness: 0.85 },
  thatch: { tex: 'thatch', roughness: 1 },
  tiles: { tex: 'tiles', roughness: 0.8 },
  rock: { tex: 'rock', roughness: 0.95 },
  caveRock: { tex: 'rock', color: 0x9a948c, roughness: 0.9 },
  bark: { tex: 'bark', roughness: 0.95, normalScale: 1.2 },
  pineBark: { tex: 'pineBark', roughness: 0.95, normalScale: 1.2 },
  roughWood: { tex: 'roughWood', roughness: 0.9 },
  cobble: { tex: 'cobble', roughness: 0.9, normalScale: 1 },
  rope: { tex: 'rope', roughness: 0.95 },
  sand: { tex: 'sand', roughness: 1 },
  leaves: { tex: 'leaves', roughness: 0.9, wind: true },
  pine: { tex: 'pine', roughness: 0.9, wind: true },
  cloth: { tex: 'cloth', roughness: 0.95 },
  clothRed: { tex: 'cloth', color: 0x8a3a2a, roughness: 0.95 },
  metal: { tex: 'metal', roughness: 0.35, metalness: 0.85 },
  iron: { tex: 'metal', color: 0x777777, roughness: 0.55, metalness: 0.8 },
  gold: { color: 0xc9a241, roughness: 0.3, metalness: 1 },
  straw: { tex: 'thatch', color: 0xd8c38a, roughness: 1 },
  dirt: { tex: 'dirt', roughness: 1 },
  bread: { color: 0xa87a45, roughness: 0.9 },
  meat: { color: 0x8a2f2a, roughness: 0.6 },
  meatCooked: { color: 0x5a3320, roughness: 0.7 },
  apple: { color: 0x9a2a1a, roughness: 0.5 },
  leather: { tex: 'leather', roughness: 0.75 },
  paper: { color: 0xd8cfb4, roughness: 1 },
  ash: { color: 0x2a2826, roughness: 1 },
  charred: { tex: 'planks', color: 0x2a2420, roughness: 1 },
};

/** Código de balanceo por viento (vertex shader); requiere uTime/uWind. */
export function injectWind(shader: { uniforms: Record<string, THREE.IUniform>; vertexShader: string }, strength = 1): void {
  shader.uniforms.uTime = GlobalUniforms.uTime;
  shader.uniforms.uWind = GlobalUniforms.uWind;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;')
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      {
        vec4 wp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wp = instanceMatrix * wp;
        #endif
        wp = modelMatrix * wp;
        float sway = sin(uTime * 1.3 + wp.x * 0.07 + wp.z * 0.05) * 0.5 + sin(uTime * 2.7 + wp.x * 0.3) * 0.2;
        float flutter = sin(uTime * 7.0 + wp.x * 1.7 + wp.y * 2.3 + wp.z * 1.3) * 0.04;
        float hfac = clamp(transformed.y * 0.12, 0.0, 1.0);
        transformed.x += (sway * 0.35 + flutter) * uWind * hfac * ${strength.toFixed(2)};
        transformed.z += (sway * 0.2 + flutter) * uWind * hfac * ${strength.toFixed(2)};
      }`,
    );
}

/** Inyecta balanceo por viento en el vertex shader (follaje). */
function applyWind(mat: THREE.Material): void {
  mat.onBeforeCompile = (shader) => injectWind(shader);
  mat.customProgramCacheKey = () => 'wind';
}

export class MaterialLibrary {
  private cache = new Map<MatId, THREE.MeshStandardMaterial>();
  constructor(readonly textures: TextureLibrary) {}

  get(id: MatId): THREE.MeshStandardMaterial {
    let m = this.cache.get(id);
    if (m) return m;
    const s = SPECS[id];
    m = new THREE.MeshStandardMaterial({
      color: s.color ?? 0xffffff,
      roughness: s.roughness,
      metalness: s.metalness ?? 0,
    });
    if (s.tex) {
      const t = this.textures.get(s.tex);
      m.map = t.map;
      if (t.normalMap) {
        m.normalMap = t.normalMap;
        m.normalScale.setScalar(s.normalScale ?? 0.8);
      }
    }
    if (s.wind) applyWind(m);
    m.name = id;
    this.cache.set(id, m);
    return m;
  }

  /** Variante con color por vértice (oclusión ambiental horneada). */
  private vcCache = new Map<MatId, THREE.MeshStandardMaterial>();
  vc(id: MatId): THREE.MeshStandardMaterial {
    let m = this.vcCache.get(id);
    if (!m) {
      m = this.get(id).clone();
      m.vertexColors = true;
      m.name = `${id}_vc`;
      this.vcCache.set(id, m);
    }
    return m;
  }

  /** Variante con un color (tinte) distinto; se cachea por clave. */
  private tinted = new Map<string, THREE.MeshStandardMaterial>();
  tint(id: MatId, color: number): THREE.MeshStandardMaterial {
    const key = `${id}:${color}`;
    let m = this.tinted.get(key);
    if (!m) {
      m = this.get(id).clone();
      m.color.setHex(color);
      this.tinted.set(key, m);
    }
    return m;
  }
}

/**
 * Caja con UVs a escala de mundo (1 repetición cada `texel` metros), para
 * que muros y tablas tengan densidad de textura coherente.
 */
export function worldBox(w: number, h: number, d: number, texel = 2): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const n = g.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i));
    let su: number, sv: number;
    if (nx > 0.5) { su = d; sv = h; } else if (ny > 0.5) { su = w; sv = d; } else { su = w; sv = h; }
    uv.setXY(i, (uv.getX(i) * su) / texel, (uv.getY(i) * sv) / texel);
  }
  return g;
}
