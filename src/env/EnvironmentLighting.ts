/**
 * Iluminación del entorno: cielo atmosférico con nubes, sol (sombras),
 * luna, estrellas, luz ambiental hemisférica y niebla. Controla también el
 * "factor interior" (cuevas/casas) que apaga la luz ambiente.
 */
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import type { TimeOfDay } from './TimeOfDay';
import type { Weather } from './Weather';
import { clamp, damp, lerp, smoothstep } from '../core/math';
import { GlobalUniforms } from '../engine/placeholder/Materials';

const tmpDir = { x: 0, y: 0, z: 0 };

export class EnvironmentLighting {
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly sky: Sky;
  readonly fog: THREE.FogExp2;
  private scene: THREE.Scene;
  private stars: THREE.Points;
  private moon: THREE.Mesh;
  private sunDir = new THREE.Vector3();
  /** 0 exterior, 1 interior profundo (cueva). Se suaviza. */
  interior = 0;
  interiorTarget = 0;
  /** La cámara está bajo el agua (lo fija Game cada frame). */
  underwater = false;
  /** 0 sin techo, 1 bajo techo (casa): menos luz ambiente pero hay ventanas. */
  private shadowFollowStep = 4;
  /** Iluminación basada en imagen: PMREM del cielo, regenerado al cambiar sol/nubes. */
  private pmrem: THREE.PMREMGenerator;
  private envScene = new THREE.Scene();
  private envSky: Sky;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private envKey = new THREE.Vector4(9, 9, 9, 9);
  private envT = 0;
  envInterval = 2;

  constructor(scene: THREE.Scene, private renderer: THREE.WebGLRenderer, shadowMapSize: number, shadows: boolean) {
    this.sky = new Sky();
    this.sky.scale.setScalar(4000);
    this.sky.frustumCulled = false;
    const u = this.sky.material.uniforms;
    u.turbidity.value = 6;
    u.rayleigh.value = 1.4;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.82;
    u.cloudScale.value = 0.00022;
    u.cloudSpeed.value = 0.00003;
    scene.add(this.sky);

    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envSky = new Sky();
    this.envSky.scale.setScalar(400);
    this.envScene.add(this.envSky);

    this.sun = new THREE.DirectionalLight(0xfff1dc, 3);
    this.sun.castShadow = shadows;
    this.sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
    const sc = this.sun.shadow.camera;
    sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70;
    sc.near = 1; sc.far = 400;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xbfd4ff, 0x4a3f2c, 0.6);
    scene.add(this.hemi);
    this.scene = scene;

    this.fog = new THREE.FogExp2(0x9fb0c0, 0.0025);
    scene.fog = this.fog;

    // Estrellas.
    const starGeo = new THREE.BufferGeometry();
    const n = 1800;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u1 = Math.random(), u2 = Math.random();
      const theta = u1 * Math.PI * 2;
      const y = 0.05 + u2 * 0.95;
      const r = Math.sqrt(1 - y * y);
      pos[i * 3] = Math.cos(theta) * r * 1500;
      pos[i * 3 + 1] = y * 1500;
      pos[i * 3 + 2] = Math.sin(theta) * r * 1500;
      const b = 0.4 + Math.random() * 0.6;
      col[i * 3] = b; col[i * 3 + 1] = b; col[i * 3 + 2] = b * (0.9 + Math.random() * 0.2);
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    starGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
      size: 2.2, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, fog: false,
    }));
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -1;
    scene.add(this.stars);

    this.moon = new THREE.Mesh(
      new THREE.CircleGeometry(28, 32),
      new THREE.MeshBasicMaterial({ color: 0xdfe6f0, fog: false, transparent: true, depthWrite: false }),
    );
    this.moon.frustumCulled = false;
    scene.add(this.moon);
  }

  update(dt: number, time: TimeOfDay, weather: Weather, camPos: THREE.Vector3): void {
    this.interior = damp(this.interior, this.interiorTarget, 2.5, dt);
    time.sunDirection(tmpDir);
    this.sunDir.set(tmpDir.x, tmpDir.y, tmpDir.z);
    const el = time.sunElevation;
    const night = time.nightFactor;
    const cloud = weather.cloud;
    const overcast = smoothstep(0.4, 1, cloud);

    // Cielo.
    const u = this.sky.material.uniforms;
    u.sunPosition.value.copy(this.sunDir);
    u.cloudCoverage.value = lerp(0.15, 0.95, cloud);
    u.cloudDensity.value = lerp(0.35, 0.9, cloud);
    u.time.value += dt;
    u.turbidity.value = lerp(5, 14, overcast);
    u.rayleigh.value = lerp(1.4, 0.6, overcast);
    u.showSunDisc.value = el > -0.05 ? 1 : 0;
    this.sky.position.copy(camPos);
    this.stars.position.copy(camPos);
    (this.stars.material as THREE.PointsMaterial).opacity = clamp(night * (1 - cloud * 1.1), 0, 1) * (1 - this.interior * 0.8);
    this.stars.rotation.y = time.totalMinutes * 0.0004;

    // Luna: opuesta al sol.
    const moonDir = this.sunDir.clone().multiplyScalar(-1);
    moonDir.y = Math.abs(moonDir.y) * 0.8 + 0.15;
    moonDir.normalize();
    this.moon.position.copy(camPos).addScaledVector(moonDir, 1400);
    this.moon.lookAt(camPos);
    (this.moon.material as THREE.MeshBasicMaterial).opacity = night * (1 - overcast * 0.85);

    // Sol / luna como luz direccional.
    const dayAmt = smoothstep(-0.04, 0.2, el);
    const golden = 1 - smoothstep(0.05, 0.45, el);
    const sunColor = new THREE.Color(0xfff4e6).lerp(new THREE.Color(0xff9a50), golden * dayAmt);
    const moonColor = new THREE.Color(0x8fa6d8);
    const lightDir = dayAmt > 0.02 ? this.sunDir : moonDir;
    const directIntensity = dayAmt > 0.02
      ? dayAmt * lerp(3.2, 0.7, overcast)
      : night * 0.28 * (1 - overcast * 0.7);
    this.sun.color.copy(dayAmt > 0.02 ? sunColor : moonColor);
    this.sun.intensity = directIntensity * (1 - this.interior);
    // Sombra que sigue a la cámara, en pasos para evitar parpadeo.
    const s = this.shadowFollowStep;
    const tx = Math.round(camPos.x / s) * s, tz = Math.round(camPos.z / s) * s;
    this.sun.target.position.set(tx, camPos.y, tz);
    this.sun.position.set(tx + lightDir.x * 200, camPos.y + Math.max(0.15, lightDir.y) * 200, tz + lightDir.z * 200);

    // Luz ambiental: noche muy oscura; interiores más aún.
    const ambDay = lerp(0.45, 0.8, overcast);
    const ambNight = 0.075;
    const amb = lerp(ambDay, ambNight, night) * (1 - this.interior * 0.93);
    this.hemi.intensity = amb;
    this.hemi.color.setRGB(lerp(0.8, 0.3, night), lerp(0.85, 0.38, night), lerp(0.92, 0.62, night));
    this.hemi.groundColor.setRGB(lerp(0.3, 0.05, night), lerp(0.3, 0.05, night), lerp(0.18, 0.07, night));

    // Niebla: color del horizonte según la hora.
    const dayFog = new THREE.Color(0xa9b8c6).lerp(new THREE.Color(0x9a9ea2), overcast);
    const duskFog = new THREE.Color(0xc98a5c);
    const nightFog = new THREE.Color(0x0b0f18);
    const fogCol = dayFog.clone().lerp(duskFog, golden * dayAmt * (1 - overcast) * 0.7).lerp(nightFog, night);
    // En interiores la niebla se oscurece para no "iluminar" el fondo.
    fogCol.multiplyScalar(1 - this.interior * 0.9);
    this.fog.color.copy(fogCol);
    const baseDensity = 0.0022 + overcast * 0.0015;
    this.fog.density = baseDensity + weather.fog * 0.028 + weather.rain * 0.006;
    // Bajo el agua: turbidez verdosa y visibilidad corta.
    if (this.underwater) {
      this.fog.color.setRGB(0.03, 0.14, 0.15).multiplyScalar(1 - night * 0.8);
      this.fog.density = 0.11;
    }

    this.updateEnvironment(dt, cloud, dayAmt, golden);

    // Relámpago.
    if (weather.lightning > 0) {
      this.hemi.intensity += weather.lightning * 2.5 * (1 - this.interior);
    }

    // Exposición: adaptación ocular ligera en noche/interior.
    this.renderer.toneMappingExposure = lerp(1.0, 1.35, Math.max(night, this.interior) * 0.8);

    GlobalUniforms.uWind.value = 0.15 + weather.wind * 0.9;
    GlobalUniforms.uWetness.value = weather.wetness;
  }

  /**
   * Regenera el mapa de entorno a partir de una copia del cielo cuando el sol
   * o las nubes cambian lo suficiente (como mucho cada `envInterval` s).
   */
  private updateEnvironment(dt: number, cloud: number, dayAmt: number, golden: number): void {
    this.envT -= dt;
    const u = this.sky.material.uniforms, e = this.envSky.material.uniforms;
    const d = this.sunDir;
    const changed = Math.abs(d.x - this.envKey.x) + Math.abs(d.y - this.envKey.y) + Math.abs(d.z - this.envKey.z) > 0.03 || Math.abs(cloud - this.envKey.w) > 0.05;
    if ((changed && this.envT <= 0) || !this.envRT) {
      this.envT = this.envInterval;
      this.envKey.set(d.x, d.y, d.z, cloud);
      for (const k of ['sunPosition', 'turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG', 'cloudCoverage', 'cloudDensity', 'cloudScale', 'time'] as const) {
        const src = u[k]?.value, dst = e[k];
        if (!dst || src === undefined) continue;
        if (src instanceof THREE.Vector3) (dst.value as THREE.Vector3).copy(src);
        else dst.value = src;
      }
      e.showSunDisc.value = 0; // el disco solar ya lo aporta la luz direccional
      const rt = this.pmrem.fromScene(this.envScene, 0.02, 1, 1000);
      this.envRT?.dispose();
      this.envRT = rt;
      this.scene.environment = rt.texture;
    }
    // El IBL no conoce la oclusión: casi nada de noche, al atardecer se atenúa
    // (el cielo azul teñiría todo) y cae rápido en interiores y cuevas.
    const open = Math.pow(1 - Math.min(1, this.interior), 3);
    this.scene.environmentIntensity = (0.02 + 0.42 * dayAmt * (1 - golden * 0.5)) * open;
  }

  setShadowQuality(size: number, enabled: boolean): void {
    this.sun.castShadow = enabled;
    this.sun.shadow.mapSize.set(size, size);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
  }
}
