/**
 * PLACEHOLDER · Audio procedural (ADR-007).
 * Todo sonido se pide por id lógico ('step_grass', 'clash', 'bell'...).
 * Para usar grabaciones reales basta registrar un AudioBuffer con ese id
 * en `samples`: tendrá prioridad sobre la síntesis.
 */
import * as THREE from 'three';

type Ctx = AudioContext;

export interface AmbienceState {
  day: number; // 0..1
  wind: number;
  rain: number;
  inCave: number;
  indoors: number;
  waterDist: number; // metros al agua (Infinity si lejos)
  fireDist: number;
  forest: number; // densidad de bosque cerca
  village: number; // 0..1 cercanía al pueblo
  storm: boolean;
}

export class AudioEngine {
  ctx: Ctx | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private ambBus!: GainNode;
  private noise!: AudioBuffer;
  private brown!: AudioBuffer;
  readonly samples = new Map<string, AudioBuffer>();
  volume = 0.8;
  private layers: Record<string, { gain: GainNode; filter?: BiquadFilterNode }> = {};
  private birdTimer = 2;
  private nightTimer = 1;
  private owlTimer = 20;
  private dripTimer = 3;
  private crackleTimer = 0;
  private listenerPos = new THREE.Vector3();

  /** Debe llamarse desde un gesto del usuario. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      this.ctx = new AudioContext();
    } catch {
      return;
    }
    const ctx = this.ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(comp).connect(ctx.destination);
    this.sfxBus = ctx.createGain();
    this.sfxBus.connect(this.master);
    this.ambBus = ctx.createGain();
    this.ambBus.gain.value = 0.7;
    this.ambBus.connect(this.master);
    // Buffers de ruido.
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.brown = ctx.createBuffer(1, len, ctx.sampleRate);
    const b = this.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; b[i] = last * 3.5; }
    // Capas continuas.
    this.layers.wind = this.loopNoise(this.brown, 'lowpass', 500, 0);
    this.layers.rain = this.loopNoise(this.noise, 'highpass', 1800, 0);
    this.layers.water = this.loopNoise(this.noise, 'bandpass', 900, 0);
    this.layers.cave = this.loopNoise(this.brown, 'lowpass', 120, 0);
    this.layers.fire = this.loopNoise(this.brown, 'bandpass', 600, 0);
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  private loopNoise(buf: AudioBuffer, type: BiquadFilterType, freq: number, gain: number): { gain: GainNode; filter: BiquadFilterNode } {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(f).connect(g).connect(this.ambBus);
    src.start();
    return { gain: g, filter: f };
  }

  setListener(cam: THREE.Camera): void {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    const p = cam.position;
    this.listenerPos.copy(p);
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const u = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    const t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(p.x, t, 0.02); l.positionY.setTargetAtTime(p.y, t, 0.02); l.positionZ.setTargetAtTime(p.z, t, 0.02);
      l.forwardX.setTargetAtTime(f.x, t, 0.02); l.forwardY.setTargetAtTime(f.y, t, 0.02); l.forwardZ.setTargetAtTime(f.z, t, 0.02);
      l.upX.setTargetAtTime(u.x, t, 0.02); l.upY.setTargetAtTime(u.y, t, 0.02); l.upZ.setTargetAtTime(u.z, t, 0.02);
    } else {
      l.setPosition(p.x, p.y, p.z);
      l.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z);
    }
  }

  /** Nodo de salida: posicional si hay posición. */
  private out(pos?: { x?: number; y?: number; z?: number }, vol = 1, maxDist = 60): AudioNode | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    const g = ctx.createGain();
    g.gain.value = vol;
    if (pos && pos.x !== undefined) {
      const dx = pos.x - this.listenerPos.x, dz = (pos.z ?? 0) - this.listenerPos.z;
      if (dx * dx + dz * dz > maxDist * maxDist * 1.5) return null;
      const p = ctx.createPanner();
      p.panningModel = 'equalpower';
      p.distanceModel = 'inverse';
      p.refDistance = 2.5;
      p.maxDistance = maxDist;
      p.rolloffFactor = 1.2;
      p.positionX.value = pos.x; p.positionY.value = pos.y ?? 0; p.positionZ.value = pos.z ?? 0;
      g.connect(p).connect(this.sfxBus);
    } else g.connect(this.sfxBus);
    return g;
  }

  private noiseBurst(dest: AudioNode, t: number, dur: number, type: BiquadFilterType, freq: number, q: number, gain: number, freqEnd?: number, buf?: AudioBuffer): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = buf ?? this.noise;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.01, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 1.5, dur + 0.05);
  }

  private tone(dest: AudioNode, t: number, dur: number, freq: number, type: OscillatorType, gain: number, freqEnd?: number, attack = 0.005): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** Parciales inarmónicos (metal, campanas). */
  private metal(dest: AudioNode, t: number, f0: number, ratios: number[], dur: number, gain: number): void {
    ratios.forEach((r, i) => this.tone(dest, t, dur * (1 - i * 0.08), f0 * r, 'sine', gain / (1 + i * 0.6), undefined, 0.002));
  }

  play(id: string, pos?: { x?: number; y?: number; z?: number }, volume = 1): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const sample = this.samples.get(id);
    const maxDist = id === 'bell' || id === 'thunder' || id === 'horn' ? 400 : id.startsWith('wolf') ? 160 : 60;
    const dest = this.out(pos, volume, maxDist);
    if (!dest) return;
    const t = ctx.currentTime + 0.005;
    if (sample) {
      const s = ctx.createBufferSource();
      s.buffer = sample;
      s.connect(dest);
      s.start(t);
      return;
    }
    const r = () => 0.85 + Math.random() * 0.3;
    switch (id) {
      case 'step_grass': case 'step_field': this.noiseBurst(dest, t, 0.09, 'bandpass', 2400 * r(), 0.8, 0.18); break;
      case 'step_dirt': case 'step_road': this.noiseBurst(dest, t, 0.07, 'lowpass', 1300 * r(), 1, 0.25); break;
      case 'step_mud': this.noiseBurst(dest, t, 0.13, 'lowpass', 500 * r(), 3, 0.35, 250); break;
      case 'step_wood': this.tone(dest, t, 0.08, 140 * r(), 'sine', 0.35); this.noiseBurst(dest, t, 0.04, 'bandpass', 1800, 2, 0.12); break;
      case 'step_rock': case 'step_stone': this.noiseBurst(dest, t, 0.05, 'highpass', 2800 * r(), 0.8, 0.14); this.tone(dest, t, 0.05, 90, 'sine', 0.2); break;
      case 'step_water': this.noiseBurst(dest, t, 0.22, 'bandpass', 1200 * r(), 1.2, 0.3, 2400); break;
      case 'jump': this.noiseBurst(dest, t, 0.08, 'lowpass', 900, 1, 0.15); break;
      case 'land': this.noiseBurst(dest, t, 0.12, 'lowpass', 600, 1, 0.35 * volume); this.tone(dest, t, 0.1, 70, 'sine', 0.3); break;
      case 'dodge': this.noiseBurst(dest, t, 0.2, 'bandpass', 600, 0.7, 0.2, 1400); break;
      case 'swing': this.noiseBurst(dest, t, 0.26, 'bandpass', 350 * r(), 1.4, 0.28, 1500); break;
      case 'swing_heavy': this.noiseBurst(dest, t, 0.38, 'bandpass', 250 * r(), 1.4, 0.4, 1100); break;
      case 'hit_flesh': this.tone(dest, t, 0.12, 110 * r(), 'sine', 0.6, 60); this.noiseBurst(dest, t, 0.1, 'lowpass', 1400, 1, 0.45, undefined, this.brown); break;
      case 'clash': this.metal(dest, t, 1150 * r(), [1, 1.47, 2.09, 2.76, 3.41, 4.6], 0.9, 0.22); this.noiseBurst(dest, t, 0.05, 'highpass', 3000, 0.5, 0.5); break;
      case 'block_wood': this.tone(dest, t, 0.1, 180 * r(), 'triangle', 0.5); this.noiseBurst(dest, t, 0.06, 'bandpass', 900, 1.5, 0.35); break;
      case 'chop': this.tone(dest, t, 0.09, 190 * r(), 'triangle', 0.55, 120); this.noiseBurst(dest, t, 0.08, 'bandpass', 1100 * r(), 1.2, 0.45); break;
      case 'kick': this.tone(dest, t, 0.1, 90, 'sine', 0.5); this.noiseBurst(dest, t, 0.08, 'lowpass', 800, 1, 0.3); break;
      case 'bow_draw': this.noiseBurst(dest, t, 0.7, 'bandpass', 300, 6, 0.08, 500); break;
      case 'bow_release': this.tone(dest, t, 0.25, 140, 'triangle', 0.35, 90); this.noiseBurst(dest, t, 0.12, 'bandpass', 1500, 1, 0.2); break;
      case 'arrow_fly': this.noiseBurst(dest, t, 0.3, 'bandpass', 2600, 2, 0.08, 1200); break;
      case 'arrow_hit': this.tone(dest, t, 0.08, 220 * r(), 'triangle', 0.4, 120); this.noiseBurst(dest, t, 0.05, 'bandpass', 2000, 1, 0.25); break;
      case 'pickup': this.noiseBurst(dest, t, 0.12, 'bandpass', 1600, 1, 0.12); this.tone(dest, t + 0.05, 0.06, 420, 'sine', 0.06); break;
      case 'grab': this.noiseBurst(dest, t, 0.08, 'lowpass', 900, 1, 0.15); break;
      case 'grab_heavy': this.noiseBurst(dest, t, 0.25, 'lowpass', 500, 1, 0.3); this.tone(dest, t, 0.2, 90, 'sine', 0.2); break;
      case 'throw': this.noiseBurst(dest, t, 0.22, 'bandpass', 500, 1, 0.2, 1200); break;
      case 'equip': this.metal(dest, t, 1800, [1, 1.6, 2.3], 0.15, 0.06); this.noiseBurst(dest, t, 0.1, 'highpass', 2500, 1, 0.1); break;
      case 'coins': for (let i = 0; i < 5; i++) this.metal(dest, t + i * 0.05 * r(), 2600 * r(), [1, 1.42, 2.1], 0.2, 0.05); break;
      case 'paper': this.noiseBurst(dest, t, 0.35, 'highpass', 3500, 0.7, 0.12); break;
      case 'chest_open': this.noiseBurst(dest, t, 0.4, 'bandpass', 500, 8, 0.1, 350); this.tone(dest, t + 0.35, 0.08, 150, 'sine', 0.2); break;
      case 'door_open': this.noiseBurst(dest, t, 0.7, 'bandpass', 420, 12, 0.14, 700); break;
      case 'door_close': this.tone(dest, t, 0.15, 95, 'sine', 0.5); this.noiseBurst(dest, t, 0.1, 'lowpass', 700, 1, 0.3); break;
      case 'door_locked': this.metal(dest, t, 900, [1, 1.5], 0.12, 0.1); this.tone(dest, t, 0.08, 120, 'sine', 0.2); break;
      case 'gate': this.noiseBurst(dest, t, 1.4, 'bandpass', 180, 10, 0.3, 320); this.tone(dest, t + 1.2, 0.3, 60, 'sine', 0.5); break;
      case 'wood_creak': this.noiseBurst(dest, t, 0.5, 'bandpass', 380, 14, 0.18, 520); break;
      case 'ladder': for (let i = 0; i < 4; i++) this.tone(dest, t + i * 0.08, 0.06, 160, 'triangle', 0.2); break;
      case 'drink': for (let i = 0; i < 3; i++) this.tone(dest, t + i * 0.22, 0.12, 180 + i * 20, 'sine', 0.25, 90); break;
      case 'eat': for (let i = 0; i < 3; i++) this.noiseBurst(dest, t + i * 0.18, 0.08, 'bandpass', 1400, 1, 0.2); break;
      case 'water_fill': this.noiseBurst(dest, t, 0.8, 'bandpass', 700, 1.5, 0.25, 1500); break;
      case 'fire_light': this.noiseBurst(dest, t, 0.6, 'lowpass', 300, 1, 0.3, 1400, this.brown); break;
      case 'sizzle': this.noiseBurst(dest, t, 1.2, 'highpass', 4000, 0.5, 0.15); break;
      case 'hammer': this.metal(dest, t, 820 * r(), [1, 1.55, 2.62, 3.9], 0.5, 0.18); break;
      case 'bell':
        for (let k = 0; k < 3; k++) this.metal(dest, t + k * 0.9, 330, [0.5, 1, 1.19, 1.5, 2, 2.5, 3.01], 3.2, 0.25);
        break;
      case 'horn': {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(140, t); o.frequency.linearRampToValueAtTime(155, t + 1.4);
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700;
        const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.2); g.gain.setValueAtTime(0.35, t + 1.3); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
        o.connect(f).connect(g).connect(dest); o.start(t); o.stop(t + 1.9);
        break;
      }
      case 'thunder': this.noiseBurst(dest, t, 3.5, 'lowpass', 300, 0.7, 0.9, 60, this.brown); break;
      case 'tree_crack': this.noiseBurst(dest, t, 0.9, 'bandpass', 250, 6, 0.4, 600); break;
      case 'tree_fall': this.noiseBurst(dest, t, 1.4, 'lowpass', 700, 1, 0.7, 120, this.brown); this.tone(dest, t + 0.1, 0.5, 55, 'sine', 0.6); break;
      case 'splash': this.noiseBurst(dest, t, 0.4, 'bandpass', 1000, 0.8, 0.4, 3000); break;
      case 'wolf_howl': {
        const o = ctx.createOscillator(); o.type = 'sine';
        const f0 = 380 * r();
        o.frequency.setValueAtTime(f0, t); o.frequency.linearRampToValueAtTime(f0 * 1.7, t + 0.8); o.frequency.linearRampToValueAtTime(f0 * 1.5, t + 2.2); o.frequency.linearRampToValueAtTime(f0 * 1.1, t + 2.8);
        const lfo = ctx.createOscillator(); lfo.frequency.value = 5; const lg = ctx.createGain(); lg.gain.value = 8; lfo.connect(lg).connect(o.frequency);
        const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.4); g.gain.setValueAtTime(0.25, t + 2.2); g.gain.exponentialRampToValueAtTime(0.0001, t + 3);
        o.connect(g).connect(dest); o.start(t); lfo.start(t); o.stop(t + 3.1); lfo.stop(t + 3.1);
        break;
      }
      case 'wolf_growl': this.noiseBurst(dest, t, 0.6, 'bandpass', 160, 4, 0.4, 120, this.brown); this.tone(dest, t, 0.6, 75, 'sawtooth', 0.06); break;
      case 'wolf_bite': this.noiseBurst(dest, t, 0.12, 'bandpass', 700, 2, 0.4); this.tone(dest, t, 0.1, 130, 'sawtooth', 0.1); break;
      case 'deer_alarm': this.tone(dest, t, 0.35, 900 * r(), 'sine', 0.12, 500); break;
      case 'grunt': case 'pain': {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; const f0 = (id === 'pain' ? 190 : 130) * r();
        o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * 0.7, t + 0.25);
        const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 700; f.Q.value = 3;
        const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
        o.connect(f).connect(g).connect(dest); o.start(t); o.stop(t + 0.35);
        break;
      }
      case 'shout': {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; const f0 = 170 * r();
        o.frequency.setValueAtTime(f0, t); o.frequency.linearRampToValueAtTime(f0 * 1.25, t + 0.2); o.frequency.linearRampToValueAtTime(f0 * 0.9, t + 0.6);
        const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 2;
        const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.3, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
        o.connect(f).connect(g).connect(dest); o.start(t); o.stop(t + 0.75);
        break;
      }
      case 'death': this.noiseBurst(dest, t, 0.5, 'lowpass', 500, 1, 0.5, 100, this.brown); break;
      default: this.noiseBurst(dest, t, 0.08, 'bandpass', 1000, 1, 0.1);
    }
  }

  /** Ambientes continuos y eventos aleatorios (día/noche, clima, lugar). */
  updateAmbience(dt: number, s: AmbienceState): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const set = (k: string, v: number) => this.layers[k]?.gain.gain.setTargetAtTime(v, t, 0.4);
    const outdoor = (1 - s.inCave) * (1 - s.indoors * 0.7);
    set('wind', (0.05 + s.wind * 0.35) * outdoor);
    this.layers.wind?.filter?.frequency.setTargetAtTime(300 + s.wind * 700, t, 0.5);
    set('rain', s.rain * 0.3 * (1 - s.inCave) * (1 - s.indoors * 0.5));
    set('water', s.waterDist < 30 ? (1 - s.waterDist / 30) * 0.18 : 0);
    set('cave', s.inCave * 0.35);
    set('fire', s.fireDist < 8 ? (1 - s.fireDist / 8) * 0.08 : 0);
    // Pájaros de día (más en el bosque).
    this.birdTimer -= dt;
    if (this.birdTimer <= 0) {
      this.birdTimer = 0.6 + Math.random() * (3.5 - s.forest * 2);
      if (s.day > 0.5 && s.rain < 0.3 && outdoor > 0.5) this.bird(0.03 + s.forest * 0.04);
    }
    // Grillos y búhos de noche.
    this.nightTimer -= dt;
    if (this.nightTimer <= 0) {
      this.nightTimer = 0.25 + Math.random() * 0.5;
      if (s.day < 0.3 && s.rain < 0.3 && outdoor > 0.5) this.cricket(0.015);
    }
    this.owlTimer -= dt;
    if (this.owlTimer <= 0) {
      this.owlTimer = 15 + Math.random() * 30;
      if (s.day < 0.25 && outdoor > 0.5 && s.forest > 0.2) this.owl();
    }
    // Goteo en la cueva.
    this.dripTimer -= dt;
    if (this.dripTimer <= 0) {
      this.dripTimer = 0.8 + Math.random() * 2.5;
      if (s.inCave > 0.5) this.tone(this.sfxBus, t, 0.12, 1200 + Math.random() * 900, 'sine', 0.06, 700);
    }
    // Chisporroteo del fuego.
    this.crackleTimer -= dt;
    if (this.crackleTimer <= 0) {
      this.crackleTimer = 0.05 + Math.random() * 0.25;
      if (s.fireDist < 6) this.noiseBurst(this.sfxBus, t, 0.02, 'highpass', 2500 + Math.random() * 3000, 1, 0.08 * (1 - s.fireDist / 6));
    }
  }

  private bird(v: number): void {
    const t = this.ctx!.currentTime;
    const f = 2500 + Math.random() * 2500;
    const n = 2 + Math.floor(Math.random() * 4);
    const pan = this.ctx!.createStereoPanner();
    pan.pan.value = Math.random() * 2 - 1;
    pan.connect(this.ambBus);
    for (let i = 0; i < n; i++) this.tone(pan, t + i * 0.11, 0.08, f * (1 + (Math.random() - 0.5) * 0.3), 'sine', v, f * (0.7 + Math.random() * 0.6));
  }

  private cricket(v: number): void {
    const t = this.ctx!.currentTime;
    const pan = this.ctx!.createStereoPanner();
    pan.pan.value = Math.random() * 2 - 1;
    pan.connect(this.ambBus);
    for (let i = 0; i < 3; i++) this.tone(pan, t + i * 0.045, 0.03, 4200 + Math.random() * 300, 'sine', v);
  }

  private owl(): void {
    const t = this.ctx!.currentTime;
    const pan = this.ctx!.createStereoPanner();
    pan.pan.value = Math.random() * 2 - 1;
    pan.connect(this.ambBus);
    this.tone(pan, t, 0.35, 420, 'sine', 0.06, 380, 0.05);
    this.tone(pan, t + 0.55, 0.6, 400, 'sine', 0.06, 350, 0.08);
  }
}
