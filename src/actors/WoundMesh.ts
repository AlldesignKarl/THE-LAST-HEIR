/**
 * Superficie de un corte (muñón o extremo de un miembro cercenado): carne
 * desgarrada irregular, borde de piel y ropa empapado, hueso que asoma y,
 * en el cuello, la tráquea. Goterones colgando del borde.
 */
import * as THREE from 'three';

const FLESH = new THREE.MeshStandardMaterial({ color: 0x7a0f0e, roughness: 0.28, metalness: 0, envMapIntensity: 0.6 });
const RIM = new THREE.MeshStandardMaterial({ color: 0x3e0505, roughness: 0.35, envMapIntensity: 0.5 });
const BONE = new THREE.MeshStandardMaterial({ color: 0xe0d4bc, roughness: 0.55 });
const DARK = new THREE.MeshStandardMaterial({ color: 0x1e0404, roughness: 0.5 });

/** Carne del corte: un disco con relieve desigual (no una tapa lisa). */
function raggedDisc(r: number, seed: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r * 1.04, 0.035, 14, 1);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const a = Math.atan2(z, x);
    const n = Math.sin(a * 5 + seed) * 0.5 + Math.sin(a * 11 + seed * 2.3) * 0.3;
    if (y > 0) p.setY(i, y + n * 0.009 + (Math.hypot(x, z) < r * 0.5 ? -0.004 : 0));
    const k = 1 + n * 0.06;
    p.setX(i, x * k); p.setZ(i, z * k);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * Crea la herida (eje +Y hacia fuera del corte). `r`: radio del miembro.
 * `neck`: añade tráquea y vértebra.
 */
export function woundCap(r: number, neck = false): THREE.Group {
  const grp = new THREE.Group();
  const seed = Math.random() * 10;
  const flesh = new THREE.Mesh(raggedDisc(r, seed), FLESH);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(r * 1.02, r * 0.16, 5, 16), RIM);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.006;
  const bone = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.26, r * 0.3, 0.05, 8), BONE);
  bone.position.set(neck ? 0 : r * 0.1, 0.012, neck ? -r * 0.35 : 0);
  grp.add(flesh, rim, bone);
  if (neck) {
    const trachea = new THREE.Mesh(new THREE.TorusGeometry(r * 0.2, r * 0.07, 4, 10), BONE);
    trachea.rotation.x = Math.PI / 2;
    trachea.position.set(0, 0.02, r * 0.45);
    const hole = new THREE.Mesh(new THREE.CircleGeometry(r * 0.16, 8), DARK);
    hole.rotation.x = -Math.PI / 2;
    hole.position.set(0, 0.021, r * 0.45);
    grp.add(trachea, hole);
  }
  // Goterones que cuelgan del borde.
  for (let i = 0; i < 4; i++) {
    const a = seed + i * 1.7;
    const len = 0.02 + ((seed * 7 + i * 3) % 1) * 0.05;
    const d = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.007, len, 4), RIM);
    d.position.set(Math.cos(a) * r * 1.08, -len / 2, Math.sin(a) * r * 1.08);
    grp.add(d);
  }
  grp.traverse((o) => { (o as THREE.Mesh).castShadow = false; });
  return grp;
}
