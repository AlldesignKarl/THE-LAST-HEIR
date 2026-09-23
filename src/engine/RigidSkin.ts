/**
 * Construye un SkinnedMesh "rígido" a partir de piezas primitivas ligadas
 * a huesos (peso 1 por vértice). Resultado: 1 draw call por personaje con
 * un esqueleto real (THREE.Skeleton), compatible con la futura sustitución
 * por modelos glTF con animaciones.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

interface Part {
  geo: THREE.BufferGeometry;
  color: THREE.Color;
  bone: THREE.Bone;
  local: THREE.Matrix4;
  kind: number;
}

/** Tipo de superficie por pieza (el shader añade detalle y rugosidad). */
export const SURF = { skin: 0, cloth: 1, leather: 2, metal: 3, hair: 4, linen: 5, wood: 6 } as const;

export class RigidSkin {
  readonly bones: THREE.Bone[] = [];
  private parts: Part[] = [];
  /** Tipo de superficie aplicado a las piezas que se añadan a continuación. */
  kind: number = SURF.cloth;

  bone(parent: THREE.Object3D | null, x = 0, y = 0, z = 0): THREE.Bone {
    const b = new THREE.Bone();
    b.position.set(x, y, z);
    if (parent) parent.add(b);
    this.bones.push(b);
    return b;
  }

  part(bone: THREE.Bone, geo: THREE.BufferGeometry, color: number, sx: number, sy: number, sz: number, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0): this {
    const local = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
      new THREE.Vector3(sx, sy, sz),
    );
    this.parts.push({ geo, color: new THREE.Color(color), bone, local, kind: this.kind });
    return this;
  }

  /** Fusiona en un SkinnedMesh. Los huesos deben estar en pose de reposo. */
  build(root: THREE.Bone, material: THREE.Material): THREE.SkinnedMesh {
    root.updateMatrixWorld(true);
    const geos: THREE.BufferGeometry[] = [];
    const m = new THREE.Matrix4();
    for (const p of this.parts) {
      const g = (p.geo.index ? p.geo.toNonIndexed() : p.geo.clone());
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal'].includes(k)) g.deleteAttribute(k);
      m.multiplyMatrices(p.bone.matrixWorld, p.local);
      g.applyMatrix4(m);
      const n = g.attributes.position.count;
      const col = new Float32Array(n * 3);
      const si = new Uint16Array(n * 4);
      const sw = new Float32Array(n * 4);
      const kd = new Float32Array(n).fill(p.kind);
      const bi = this.bones.indexOf(p.bone);
      for (let i = 0; i < n; i++) {
        col[i * 3] = p.color.r; col[i * 3 + 1] = p.color.g; col[i * 3 + 2] = p.color.b;
        si[i * 4] = bi;
        sw[i * 4] = 1;
      }
      g.setAttribute('aKind', new THREE.BufferAttribute(kd, 1));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
      g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
      geos.push(g);
    }
    const merged = mergeGeometries(geos)!;
    merged.computeBoundingSphere();
    merged.boundingSphere!.radius *= 1.6; // margen para poses (caídas, brazos)
    const mesh = new THREE.SkinnedMesh(merged, material);
    mesh.add(root);
    mesh.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton(this.bones));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }
}

/**
 * Material compartido para personajes con color por vértice. Añade detalle
 * procedural según el tipo de superficie (atributo aKind): trama de tela,
 * poro de piel, grano de cuero, mechones de pelo, brillo del metal. Usa la
 * posición en reposo (antes del skinning) para que el detalle no "nade".
 */
let sharedMat: THREE.MeshStandardMaterial | null = null;
export function characterMaterial(): THREE.MeshStandardMaterial {
  if (!sharedMat) {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 });
    m.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aKind;\nvarying float vKind;\nvarying vec3 vRest;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvKind = aKind;\nvRest = position;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          varying float vKind; varying vec3 vRest;
          float h13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
          float vn3(vec3 p) {
            vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
            return mix(mix(mix(h13(i), h13(i + vec3(1, 0, 0)), f.x), mix(h13(i + vec3(0, 1, 0)), h13(i + vec3(1, 1, 0)), f.x), f.y),
                       mix(mix(h13(i + vec3(0, 0, 1)), h13(i + vec3(1, 0, 1)), f.x), mix(h13(i + vec3(0, 1, 1)), h13(i + vec3(1, 1, 1)), f.x), f.y), f.z);
          }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          float kSkin = 1.0 - step(0.5, vKind);
          float kCloth = step(0.5, vKind) * (1.0 - step(1.5, vKind)) + step(4.5, vKind) * (1.0 - step(5.5, vKind));
          float kLeather = step(1.5, vKind) * (1.0 - step(2.5, vKind));
          float kMetal = step(2.5, vKind) * (1.0 - step(3.5, vKind));
          float kHair = step(3.5, vKind) * (1.0 - step(4.5, vKind));
          float kWood = step(5.5, vKind);
          float nLo = vn3(vRest * 9.0);
          float nHi = vn3(vRest * 70.0);
          float weave = (sin(vRest.x * 900.0 + vRest.z * 900.0) * sin(vRest.y * 900.0)) * 0.5 + 0.5;
          float det = 1.0;
          det *= mix(1.0, 0.86 + 0.14 * nLo + 0.08 * (weave - 0.5) + 0.08 * (nHi - 0.5), kCloth);
          det *= mix(1.0, 0.93 + 0.1 * nLo + 0.04 * nHi, kSkin);
          det *= mix(1.0, 0.8 + 0.3 * vn3(vRest * vec3(25.0, 3.0, 25.0)) + 0.1 * nHi, kLeather + kWood);
          det *= mix(1.0, 0.75 + 0.45 * vn3(vRest * vec3(160.0, 12.0, 160.0)), kHair);
          // Suciedad en la parte baja de la ropa (barro de los caminos).
          det *= mix(1.0, 0.8 + 0.2 * smoothstep(0.05, 0.5, vRest.y), kCloth + kLeather);
          diffuseColor.rgb *= det;`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          roughnessFactor = kSkin * 0.62 + kCloth * 0.95 + kLeather * 0.6 + kMetal * 0.35 + kHair * 0.7 + kWood * 0.8;`)
        .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
          metalnessFactor = kMetal * 0.85;`);
    };
    m.customProgramCacheKey = () => 'character-v2';
    sharedMat = m;
  }
  return sharedMat;
}
