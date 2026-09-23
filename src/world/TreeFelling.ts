/**
 * Tala: al agotar la salud de un árbol, el tronco cae como cuerpo rígido
 * real y, al asentarse, se parte en troncos transportables.
 */
import * as THREE from 'three';
import type { Game } from '../game/Game';
import { RAPIER, GROUP, groups, ALL } from '../engine/Physics';
import type { Tree } from './Vegetation';

interface Falling {
  tree: Tree;
  body: RAPIER.RigidBody;
  mesh: THREE.Object3D;
  t: number;
  length: number;
}

export class TreeFelling {
  private falling: Falling[] = [];

  constructor(private readonly g: Game) {}

  /** Daña un árbol. Devuelve true si cae. */
  damage(treeId: string, amount: number, from: THREE.Vector3): boolean {
    const g = this.g;
    const t = g.vegetation.getTree(treeId);
    if (!t || !g.vegetation.isStanding(t)) return false;
    t.health -= amount;
    g.particles.burst('dust', t.x, t.y + 1.2, t.z, 6, 1.5);
    if (t.health > 0) return false;
    g.vegetation.fell(treeId, g.time.day);
    g.bus.emit('tree:felled', { treeId });
    g.bus.emit('sfx', { id: 'tree_crack', x: t.x, y: t.y + 2, z: t.z });
    this.spawnFalling(t, from);
    return true;
  }

  private spawnFalling(t: Tree, from: THREE.Vector3): void {
    const g = this.g;
    const geo = g.vegetation.speciesGeometry(t.species);
    const mesh = new THREE.Group();
    const trunk = new THREE.Mesh(geo.trunk, g.materials.get('bark'));
    const canopy = new THREE.Mesh(geo.canopy, g.materials.get(t.species === 'oak' ? 'leaves' : 'pine'));
    trunk.castShadow = canopy.castShadow = true;
    mesh.add(trunk, canopy);
    mesh.scale.setScalar(t.scale);
    g.renderer.scene.add(mesh);
    const h = geo.trunkHeight * t.scale;
    // Cuerpo con el centro de masas a media altura; cae alejándose del leñador.
    const body = g.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(t.x, t.y + 0.05, t.z).setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.rot)).setAngularDamping(0.4).setLinearDamping(0.2),
    );
    g.physics.world.createCollider(
      RAPIER.ColliderDesc.cylinder(h / 2, t.radius * 1.3).setTranslation(0, h / 2, 0).setMass(300).setFriction(0.9).setCollisionGroups(groups(GROUP.PROP, ALL & ~GROUP.PLAYER)),
      body,
    );
    const away = new THREE.Vector3(t.x - from.x, 0, t.z - from.z).normalize();
    body.applyImpulseAtPoint({ x: away.x * 260, y: 0, z: away.z * 260 }, { x: t.x, y: t.y + h * 0.8, z: t.z }, true);
    this.falling.push({ tree: t, body, mesh, t: 0, length: h });
  }

  update(dt: number): void {
    const g = this.g;
    for (let i = this.falling.length - 1; i >= 0; i--) {
      const f = this.falling[i];
      f.t += dt;
      const p = f.body.translation(), r = f.body.rotation();
      f.mesh.position.set(p.x, p.y, p.z);
      f.mesh.quaternion.set(r.x, r.y, r.z, r.w);
      const settled = f.t > 2.2 && (f.body.isSleeping() || Math.hypot(f.body.linvel().x, f.body.linvel().y, f.body.linvel().z) < 0.3);
      if (f.t > 1.2 && f.t - dt <= 1.2) g.bus.emit('sfx', { id: 'tree_fall', x: p.x, y: p.y, z: p.z });
      if (settled || f.t > 8) {
        // Partir en troncos a lo largo del eje del árbol.
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(f.mesh.quaternion);
        const n = f.tree.species === 'oak' ? 3 : 4;
        const usable = Math.min(f.length * 0.8, n * 1.9);
        for (let k = 0; k < n; k++) {
          const along = 0.9 + (k + 0.5) * (usable / n);
          const lp = new THREE.Vector3(p.x, p.y, p.z).addScaledVector(up, along);
          lp.y = Math.max(lp.y, g.hf.heightAt(lp.x, lp.z) + 0.35);
          const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
          g.worldItems.spawn('log', lp.x, lp.y + 0.1, lp.z, { rot: q });
        }
        g.worldItems.spawn('firewood', p.x + up.x * 0.5, p.y + 0.6, p.z + up.z * 0.5, { count: 2 });
        g.particles.burst('dust', p.x, p.y + 0.5, p.z, 20, 2.5);
        g.physics.removeBody(f.body);
        g.renderer.scene.remove(f.mesh);
        this.falling.splice(i, 1);
      }
    }
  }
}
