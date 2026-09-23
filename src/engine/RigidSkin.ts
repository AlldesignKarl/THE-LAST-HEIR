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
}

export class RigidSkin {
  readonly bones: THREE.Bone[] = [];
  private parts: Part[] = [];

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
    this.parts.push({ geo, color: new THREE.Color(color), bone, local });
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
      const bi = this.bones.indexOf(p.bone);
      for (let i = 0; i < n; i++) {
        col[i * 3] = p.color.r; col[i * 3 + 1] = p.color.g; col[i * 3 + 2] = p.color.b;
        si[i * 4] = bi;
        sw[i * 4] = 1;
      }
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

/** Material compartido para personajes con color por vértice. */
let sharedMat: THREE.MeshStandardMaterial | null = null;
export function characterMaterial(clothTex?: THREE.Texture): THREE.MeshStandardMaterial {
  if (!sharedMat) {
    sharedMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 });
    if (clothTex) {
      // Detalle de tejido sutil en todo el cuerpo (triplanar no necesario a esta escala).
      sharedMat.bumpMap = clothTex;
      sharedMat.bumpScale = 0.4;
    }
  }
  return sharedMat;
}
