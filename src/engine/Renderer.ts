import * as THREE from 'three';

export interface QualitySettings {
  pixelRatio: number;
  shadows: boolean;
  shadowMapSize: number;
  viewChunks: number;
  grass: boolean;
}

export const QUALITY_PRESETS: Record<'low' | 'medium' | 'high', QualitySettings> = {
  low: { pixelRatio: 0.75, shadows: false, shadowMapSize: 1024, viewChunks: 2, grass: false },
  medium: { pixelRatio: 1, shadows: true, shadowMapSize: 2048, viewChunks: 3, grass: true },
  high: { pixelRatio: 1.5, shadows: true, shadowMapSize: 4096, viewChunks: 4, grass: true },
};

/** Envoltura del WebGLRenderer: tonemapping cinematográfico, sombras, resize. */
export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  quality: QualitySettings;

  constructor(canvas: HTMLCanvasElement, quality: QualitySettings) {
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.info.autoReset = false;
    this.renderer.shadowMap.enabled = quality.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality.pixelRatio));
    this.camera = new THREE.PerspectiveCamera(72, 1, 0.05, 2200);
    this.scene.add(this.camera);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  get stats(): { calls: number; triangles: number; geometries: number; textures: number } {
    const i = this.renderer.info;
    return { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures };
  }
}
