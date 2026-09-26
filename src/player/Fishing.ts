/**
 * Pesca con caña: con la caña en la mano, clic mirando al agua (mar o
 * arroyo) lanza el sedal; el corcho flota hasta que pica un pez (espera
 * aleatoria, más corta al alba/atardecer, mar adentro o desde la barca).
 * Al picar hay poco más de un segundo para tirar (clic). Si no, se escapa.
 */
import * as THREE from 'three';
import type { Game } from '../game/Game';
import { SEA } from '../world/WorldLayout';

type State = 'idle' | 'casting' | 'waiting' | 'bite';

export class Fishing {
  state: State = 'idle';
  private bobber: THREE.Mesh;
  private line: THREE.Line;
  private target = new THREE.Vector3();
  private from = new THREE.Vector3();
  private t = 0;
  private waitFor = 0;
  private biteWindow = 0;

  constructor(private readonly g: Game) {
    this.bobber = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xb8402a, roughness: 0.6 }),
    );
    const cork = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.08, 8).translate(0, 0.07, 0), new THREE.MeshStandardMaterial({ color: 0xe8e0c8, roughness: 0.8 }));
    this.bobber.add(cork);
    this.bobber.visible = false;
    g.renderer.scene.add(this.bobber);
    const lg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.line = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0xd8d2c0, transparent: true, opacity: 0.7 }));
    this.line.frustumCulled = false;
    this.line.visible = false;
    g.renderer.scene.add(this.line);
  }

  get holding(): boolean {
    return this.g.equipment.slots.main === 'fishing_rod';
  }

  /** Busca agua a la que lanzar (hasta 16 m delante). */
  private findWater(): THREE.Vector3 | null {
    const g = this.g;
    const eye = g.player.eyePosition(1, new THREE.Vector3());
    const dir = g.player.forward(new THREE.Vector3());
    for (let d = 3; d <= 16; d += 0.5) {
      const p = eye.clone().addScaledVector(dir, d);
      const x = p.x, z = p.z;
      const wl = g.hf.waterLevelAt(x, z);
      if (wl !== null && g.hf.heightAt(x, z) < wl - 0.25) return new THREE.Vector3(x, wl, z);
    }
    // Horizontal: lanzar lejos aunque se mire al horizonte.
    const flat = new THREE.Vector3(dir.x, 0, dir.z).normalize();
    for (let d = 6; d <= 14; d += 1) {
      const x = eye.x + flat.x * d, z = eye.z + flat.z * d;
      const wl = g.hf.waterLevelAt(x, z);
      if (wl !== null && g.hf.heightAt(x, z) < wl - 0.25) return new THREE.Vector3(x, wl, z);
    }
    return null;
  }

  private rodTip(out: THREE.Vector3): THREE.Vector3 {
    const g = this.g;
    const eye = g.player.eyePosition(1, out);
    const fwd = g.player.forward(new THREE.Vector3());
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x).normalize();
    return eye.addScaledVector(fwd, 1.9).addScaledVector(right, 0.35).add(new THREE.Vector3(0, 0.9, 0));
  }

  private reset(): void {
    this.state = 'idle';
    this.bobber.visible = false;
    this.line.visible = false;
  }

  /** Cada tick de lógica. Devuelve true si ha usado la entrada de ataque. */
  update(dt: number): boolean {
    const g = this.g;
    if (!this.holding) { if (this.state !== 'idle') this.reset(); return false; }
    const click = g.input.wasPressed('attack');
    this.t += dt;
    switch (this.state) {
      case 'idle':
        if (click) {
          const w = this.findWater();
          if (!w) { g.bus.emit('notify', { text: 'Mira hacia el agua para lanzar.', kind: 'info' }); break; }
          this.target.copy(w);
          this.rodTip(this.from);
          this.state = 'casting';
          this.t = 0;
          this.bobber.visible = this.line.visible = true;
          g.bus.emit('sfx', { id: 'swing' });
        }
        break;
      case 'casting':
        if (this.t > 0.6) {
          this.state = 'waiting';
          this.t = 0;
          const h = g.time.hourFloat;
          const golden = (h > 5.5 && h < 8.5) || (h > 18 && h < 21) ? 0.65 : 1;
          const deep = SEA.level - g.hf.heightAt(this.target.x, this.target.z);
          const depthMul = deep > 3 ? 0.75 : 1;
          const boat = g.boats.riding ? 0.7 : 1;
          this.waitFor = (4 + Math.random() * 12) * golden * depthMul * boat;
          g.particles.burst('dust', this.target.x, this.target.y, this.target.z, 6, 1.2, undefined, 0.5);
          g.bus.emit('sfx', { id: 'step_water', x: this.target.x, y: this.target.y, z: this.target.z, volume: 0.6 });
        }
        break;
      case 'waiting':
        if (click) { this.reset(); g.bus.emit('notify', { text: 'Recoges el sedal.', kind: 'info' }); break; }
        if (this.t > this.waitFor) {
          this.state = 'bite';
          this.t = 0;
          this.biteWindow = 1.1 + g.skills.level('survival') * 0.08;
          g.bus.emit('notify', { text: '¡Pica! Tira ya.', kind: 'quest' });
          g.bus.emit('sfx', { id: 'step_water', x: this.target.x, y: this.target.y, z: this.target.z, volume: 1 });
          g.particles.burst('dust', this.target.x, this.target.y, this.target.z, 10, 1.6, undefined, 0.6);
        }
        break;
      case 'bite':
        if (click) {
          const big = Math.random() < 0.18 + g.skills.level('survival') * 0.03;
          const n = big ? 2 : 1;
          const added = g.inventory.add('fish_raw', n);
          if (added) {
            g.bus.emit('item:acquired', { itemId: 'fish_raw', count: added, source: 'gather' });
            g.bus.emit('notify', { text: big ? '¡Una lubina grande! (cuenta por dos)' : 'Has pescado una sardina.', kind: 'item' });
          } else g.bus.emit('notify', { text: 'No te cabe más peso.', kind: 'warning' });
          g.skills.add('survival', 0.6);
          g.bus.emit('sfx', { id: 'pickup' });
          this.reset();
        } else if (this.t > this.biteWindow) {
          g.bus.emit('notify', { text: 'Se ha escapado.', kind: 'info' });
          this.reset();
        }
        break;
    }
    // Alejarse demasiado corta el sedal.
    if (this.state !== 'idle' && g.player.pos.distanceTo(this.target) > 22) this.reset();
    return click;
  }

  /** Cada frame: corcho y sedal. */
  updateVisual(): void {
    if (this.state === 'idle') return;
    const g = this.g;
    const tip = this.rodTip(new THREE.Vector3());
    const p = this.bobber.position;
    if (this.state === 'casting') {
      const k = Math.min(1, this.t / 0.6);
      p.lerpVectors(this.from, this.target, k);
      p.y += Math.sin(k * Math.PI) * 2.5;
    } else {
      p.copy(this.target);
      const time = performance.now() / 1000;
      p.y = this.target.y + Math.sin(time * 2.1) * 0.03 + (this.state === 'bite' ? -0.12 - Math.abs(Math.sin(time * 18)) * 0.08 : 0);
    }
    const pos = this.line.geometry.attributes.position as THREE.BufferAttribute;
    pos.setXYZ(0, tip.x, tip.y, tip.z);
    pos.setXYZ(1, p.x, p.y + 0.1, p.z);
    pos.needsUpdate = true;
    void g;
  }
}
