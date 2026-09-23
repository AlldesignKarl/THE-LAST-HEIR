/**
 * Sistema de partículas con pool fijo: 2 draw calls (aditivo y alfa).
 * Emisores continuos (fuego, humo, chimeneas) y ráfagas (chispas, sangre,
 * polvo, humo de pólvora). Los emisores lejanos no emiten (culling).
 */
import * as THREE from 'three';

export type ParticleKind = 'fire' | 'ember' | 'smoke' | 'dust' | 'blood' | 'spark' | 'steam' | 'rain_splash';

interface KindSpec {
  additive: boolean;
  life: [number, number];
  size: [number, number];
  grow: number;
  color: [number, number, number];
  color2: [number, number, number];
  gravity: number;
  drag: number;
  alpha: number;
}

const SPECS: Record<ParticleKind, KindSpec> = {
  fire: { additive: true, life: [0.35, 0.8], size: [0.35, 0.7], grow: -0.5, color: [1, 0.72, 0.3], color2: [0.9, 0.2, 0.04], gravity: -2.2, drag: 1.5, alpha: 0.9 },
  ember: { additive: true, life: [0.8, 1.8], size: [0.04, 0.08], grow: 0, color: [1, 0.6, 0.2], color2: [0.8, 0.2, 0.05], gravity: -1.4, drag: 0.6, alpha: 1 },
  spark: { additive: true, life: [0.15, 0.45], size: [0.03, 0.06], grow: 0, color: [1, 0.9, 0.6], color2: [1, 0.5, 0.1], gravity: 6, drag: 0.5, alpha: 1 },
  smoke: { additive: false, life: [3, 6], size: [0.6, 1.2], grow: 1.1, color: [0.22, 0.21, 0.2], color2: [0.35, 0.34, 0.33], gravity: -0.7, drag: 0.5, alpha: 0.35 },
  steam: { additive: false, life: [1, 2], size: [0.3, 0.5], grow: 1, color: [0.75, 0.75, 0.78], color2: [0.85, 0.85, 0.88], gravity: -0.8, drag: 1, alpha: 0.25 },
  dust: { additive: false, life: [0.6, 1.4], size: [0.2, 0.4], grow: 1.2, color: [0.45, 0.38, 0.28], color2: [0.5, 0.45, 0.36], gravity: -0.2, drag: 2, alpha: 0.35 },
  blood: { additive: false, life: [0.3, 0.7], size: [0.04, 0.09], grow: 0.1, color: [0.35, 0.02, 0.02], color2: [0.2, 0.01, 0.01], gravity: 9, drag: 0.3, alpha: 0.9 },
  rain_splash: { additive: false, life: [0.15, 0.25], size: [0.05, 0.1], grow: 2, color: [0.6, 0.65, 0.7], color2: [0.6, 0.65, 0.7], gravity: 3, drag: 0, alpha: 0.4 },
};

const MAX = 4000;

class ParticleBuffer {
  readonly points: THREE.Points;
  readonly pos = new Float32Array(MAX * 3);
  readonly col = new Float32Array(MAX * 4);
  readonly size = new Float32Array(MAX);
  readonly vel = new Float32Array(MAX * 3);
  readonly life = new Float32Array(MAX);
  readonly maxLife = new Float32Array(MAX);
  readonly baseSize = new Float32Array(MAX);
  readonly kind: ParticleKind[] = new Array(MAX);
  count = 0;
  private geo: THREE.BufferGeometry;

  constructor(additive: boolean, tex: THREE.Texture) {
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: { tex: { value: tex }, scale: { value: 600 }, fogColor: { value: new THREE.Color() }, fogDensity: { value: 0 } },
      vertexShader: `
        attribute vec4 aColor; attribute float aSize; varying vec4 vColor; varying float vFog;
        uniform float scale; uniform float fogDensity;
        void main() {
          vColor = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * scale / max(0.1, -mv.z);
          float d = length(mv.xyz);
          vFog = 1.0 - exp(-fogDensity * fogDensity * d * d);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D tex; uniform vec3 fogColor; varying vec4 vColor; varying float vFog;
        void main() {
          vec4 t = texture2D(tex, gl_PointCoord);
          vec4 c = vec4(vColor.rgb, vColor.a * t.a);
          ${additive ? 'c.rgb *= (1.0 - vFog);' : 'c.rgb = mix(c.rgb, fogColor, vFog);'}
          if (c.a < 0.01) discard;
          gl_FragColor = c;
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 5 : 4;
  }

  spawn(kind: ParticleKind, x: number, y: number, z: number, vx: number, vy: number, vz: number, sizeMul: number): void {
    if (this.count >= MAX) return;
    const s = SPECS[kind];
    const i = this.count++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    const life = s.life[0] + Math.random() * (s.life[1] - s.life[0]);
    this.life[i] = life;
    this.maxLife[i] = life;
    this.baseSize[i] = (s.size[0] + Math.random() * (s.size[1] - s.size[0])) * sizeMul;
    this.kind[i] = kind;
  }

  update(dt: number): void {
    let i = 0;
    while (i < this.count) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        // Compactar: mover el último a este hueco.
        const last = --this.count;
        if (i !== last) {
          this.pos[i * 3] = this.pos[last * 3]; this.pos[i * 3 + 1] = this.pos[last * 3 + 1]; this.pos[i * 3 + 2] = this.pos[last * 3 + 2];
          this.vel[i * 3] = this.vel[last * 3]; this.vel[i * 3 + 1] = this.vel[last * 3 + 1]; this.vel[i * 3 + 2] = this.vel[last * 3 + 2];
          this.life[i] = this.life[last]; this.maxLife[i] = this.maxLife[last]; this.baseSize[i] = this.baseSize[last];
          this.kind[i] = this.kind[last];
        }
        continue;
      }
      const s = SPECS[this.kind[i]];
      const t = 1 - this.life[i] / this.maxLife[i];
      const drag = Math.max(0, 1 - s.drag * dt);
      this.vel[i * 3] *= drag;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * drag - s.gravity * dt;
      this.vel[i * 3 + 2] *= drag;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] = Math.max(0.01, this.baseSize[i] * (1 + s.grow * t));
      const a = s.alpha * (t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85);
      this.col[i * 4] = s.color[0] + (s.color2[0] - s.color[0]) * t;
      this.col[i * 4 + 1] = s.color[1] + (s.color2[1] - s.color[1]) * t;
      this.col[i * 4 + 2] = s.color[2] + (s.color2[2] - s.color[2]) * t;
      this.col[i * 4 + 3] = a;
      i++;
    }
    this.geo.setDrawRange(0, this.count);
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
  }
}

export interface Emitter {
  id: string;
  kind: ParticleKind;
  pos: THREE.Vector3;
  /** Partículas por segundo. */
  rate: number;
  spread: number;
  vel: THREE.Vector3;
  sizeMul: number;
  enabled: boolean;
  acc: number;
}

function softTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.6)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  return t;
}

export class Particles {
  private add: ParticleBuffer;
  private alpha: ParticleBuffer;
  readonly emitters = new Map<string, Emitter>();
  /** Distancia máxima a la que un emisor continuo emite. */
  cullDistance = 140;

  constructor(scene: THREE.Scene) {
    const tex = softTexture();
    this.add = new ParticleBuffer(true, tex);
    this.alpha = new ParticleBuffer(false, tex);
    scene.add(this.add.points, this.alpha.points);
  }

  private buf(kind: ParticleKind): ParticleBuffer {
    return SPECS[kind].additive ? this.add : this.alpha;
  }

  burst(kind: ParticleKind, x: number, y: number, z: number, count: number, speed: number, dir?: { x: number; y: number; z: number }, sizeMul = 1): void {
    const b = this.buf(kind);
    for (let i = 0; i < count; i++) {
      let vx = (Math.random() - 0.5) * 2, vy = (Math.random() - 0.5) * 2, vz = (Math.random() - 0.5) * 2;
      if (dir) { vx = vx * 0.5 + dir.x; vy = vy * 0.5 + dir.y; vz = vz * 0.5 + dir.z; }
      const l = Math.hypot(vx, vy, vz) || 1;
      const sp = speed * (0.5 + Math.random() * 0.5);
      b.spawn(kind, x, y, z, (vx / l) * sp, (vy / l) * sp, (vz / l) * sp, sizeMul);
    }
  }

  addEmitter(e: Omit<Emitter, 'acc'>): Emitter {
    const em = { ...e, acc: 0 };
    this.emitters.set(e.id, em);
    return em;
  }

  removeEmitter(id: string): void {
    this.emitters.delete(id);
  }

  update(dt: number, cam: THREE.Camera, fog: THREE.FogExp2 | null): void {
    const cp = cam.position;
    for (const e of this.emitters.values()) {
      if (!e.enabled) continue;
      if (e.pos.distanceToSquared(cp) > this.cullDistance * this.cullDistance) continue;
      e.acc += e.rate * dt;
      const b = this.buf(e.kind);
      while (e.acc >= 1) {
        e.acc -= 1;
        b.spawn(
          e.kind,
          e.pos.x + (Math.random() - 0.5) * e.spread,
          e.pos.y + (Math.random() - 0.5) * e.spread * 0.3,
          e.pos.z + (Math.random() - 0.5) * e.spread,
          e.vel.x + (Math.random() - 0.5) * 0.3,
          e.vel.y * (0.7 + Math.random() * 0.6),
          e.vel.z + (Math.random() - 0.5) * 0.3,
          e.sizeMul,
        );
      }
    }
    this.add.update(dt);
    this.alpha.update(dt);
    const h = (window.innerHeight || 720) * 0.9;
    for (const b of [this.add, this.alpha]) {
      const m = b.points.material as THREE.ShaderMaterial;
      m.uniforms.scale.value = h;
      if (fog) {
        m.uniforms.fogColor.value.copy(fog.color);
        m.uniforms.fogDensity.value = fog.density;
      }
    }
  }

  get activeCount(): number {
    return this.add.count + this.alpha.count;
  }
}
