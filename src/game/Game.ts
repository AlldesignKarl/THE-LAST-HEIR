/**
 * Raíz de composición: crea todos los sistemas, fija el orden de
 * actualización (ver docs/ARQUITECTURA.md) y conecta el bus de eventos.
 */
import * as THREE from 'three';
import { EventBus } from '../core/EventBus';
import { GameLoop } from '../core/GameLoop';
import { Input } from '../core/Input';
import { Flags } from '../core/Flags';
import { Renderer, QUALITY_PRESETS, type QualitySettings } from '../engine/Renderer';
import { Physics } from '../engine/Physics';
import { TextureLibrary } from '../engine/placeholder/Textures';
import { MaterialLibrary, GlobalUniforms } from '../engine/placeholder/Materials';
import { ModelLibrary } from '../engine/placeholder/Models';
import { Particles } from '../engine/Particles';
import { LightPool } from '../engine/LightPool';
import { Heightfield } from '../world/Heightfield';
import { Terrain } from '../world/Terrain';
import { Vegetation } from '../world/Vegetation';
import { Water } from '../world/Water';
import { Fires } from '../world/Fires';
import { Settlement } from '../world/Settlement';
import { Interactables } from '../world/Interactables';
import { TreeFelling } from '../world/TreeFelling';
import { buildWorldNav } from '../world/WorldNav';
import { Grass } from '../world/Grass';
import { POIS, PLAYER_START, VILLAGES } from '../world/WorldLayout';
import { TimeOfDay } from '../env/TimeOfDay';
import { Weather } from '../env/Weather';
import { EnvironmentLighting } from '../env/EnvironmentLighting';
import { RainFX } from '../env/RainFX';
import { Vitals, ambientTemperature } from '../survival/Vitals';
import { Skills } from '../survival/Skills';
import { Inventory, Equipment } from '../items/Inventory';
import { Containers } from '../items/Containers';
import { WorldItems } from '../items/WorldItems';
import { PlayerController } from '../player/PlayerController';
import { Actions } from '../player/Actions';
import { Interaction } from '../player/Interaction';
import { Viewmodel } from '../player/Viewmodel';
import { Combat } from '../combat/Combat';
import { ActorRegistry } from '../actors/Actor';
import { NPCManager } from '../ai/NPCManager';
import { AnimalManager } from '../animals/AnimalManager';
import { RaidSystem } from '../events/RaidSystem';
import { EventDirector } from '../events/EventDirector';
import { Reputation } from '../social/Reputation';
import { DialogueSystem } from '../social/Dialogue';
import { QuestSystem } from '../quests/QuestSystem';
import { Story } from '../quests/Story';
import { QUESTS, LOGS_REQUIRED } from '../data/quests';
import { Economy } from '../economy/Economy';
import { AudioEngine } from '../audio/AudioEngine';
import { UIManager } from '../ui/UIManager';
import { TouchControls } from '../ui/TouchControls';
import { GroundScatter } from '../world/GroundScatter';
import { Sea } from '../world/Sea';
import { Resources } from '../world/Resources';
import { BuildSystem } from '../world/BuildSystem';
import { SaveSystem } from '../save/SaveSystem';
import { itemDef } from '../data/items';
import { clamp, damp } from '../core/math';

type QualityName = keyof typeof QUALITY_PRESETS;
const SETTINGS_KEY = 'tlh_settings';

export class Game {
  readonly bus = new EventBus();
  readonly input: Input;
  readonly renderer: Renderer;
  readonly physics: Physics;
  readonly textures = new TextureLibrary();
  readonly materials: MaterialLibrary;
  readonly models: ModelLibrary;
  readonly hf = new Heightfield();
  readonly time: TimeOfDay;
  readonly weather: Weather;
  readonly env: EnvironmentLighting;
  readonly terrain: Terrain;
  readonly vegetation: Vegetation;
  readonly water: Water;
  readonly particles: Particles;
  readonly lights: LightPool;
  readonly fires: Fires;
  readonly rain: RainFX;
  readonly flags: Flags;
  readonly inventory = new Inventory();
  readonly equipment: Equipment;
  readonly containers = new Containers();
  readonly vitals = new Vitals();
  readonly skills: Skills;
  readonly reputation: Reputation;
  readonly interactables = new Interactables();
  readonly worldItems: WorldItems;
  readonly registry = new ActorRegistry();
  readonly player: PlayerController;
  readonly actions: Actions;
  readonly interaction: Interaction;
  readonly combat: Combat;
  readonly viewmodel: Viewmodel;
  readonly treeFelling: TreeFelling;
  readonly settlement: Settlement;
  readonly grass: Grass;
  readonly npcs: NPCManager;
  readonly animals: AnimalManager;
  readonly raids: RaidSystem;
  readonly director: EventDirector;
  readonly quests: QuestSystem;
  readonly story: Story;
  readonly economy: Economy;
  readonly dialogue: DialogueSystem;
  readonly audio = new AudioEngine();
  readonly ui: UIManager;
  readonly scatter: GroundScatter;
  readonly sea: Sea;
  readonly resources: Resources;
  readonly build: BuildSystem;
  /** Id del jugador local (en multijugador, el del usuario). */
  localPlayerId = 'local';
  /** Controles en pantalla (solo en dispositivos táctiles). */
  readonly touch: TouchControls | null;
  readonly save: SaveSystem;
  readonly loop: GameLoop;
  readonly discovered = new Set<string>();
  quality: QualitySettings;
  qualityName: QualityName;
  paused = true;
  started = false;
  private camPos = new THREE.Vector3();
  private areaT = 0;
  private insideAreas = new Set<string>();
  private deathShown = false;
  private torchBurn = 0;
  private baseFov = 72;
  private woodT = 0;
  private lastWood = -1;

  constructor(canvas: HTMLCanvasElement, qualityName: QualityName = 'medium') {
    const settings = Game.loadSettings();
    this.qualityName = (settings.quality as QualityName) ?? qualityName;
    this.quality = { ...QUALITY_PRESETS[this.qualityName] };
    this.input = new Input(canvas);
    if (settings.sensitivity) this.input.sensitivity = settings.sensitivity;
    if (settings.volume !== undefined) this.audio.volume = settings.volume;
    this.renderer = new Renderer(canvas, this.quality);
    // Texturas procedurales en GPU (la resolución no cambia en caliente).
    this.textures.init(this.renderer.renderer, this.quality.textureSize);
    this.physics = new Physics();
    this.materials = new MaterialLibrary(this.textures);
    this.models = new ModelLibrary(this.materials);
    const scene = this.renderer.scene;
    this.time = new TimeOfDay(this.bus, 1, 7.25);
    this.weather = new Weather(this.bus);
    this.weather.onThunder = (delay) => setTimeout(() => this.bus.emit('sfx', { id: 'thunder' }), delay * 1000);
    this.env = new EnvironmentLighting(scene, this.renderer.renderer, this.quality.shadowMapSize, this.quality.shadows);
    if (this.qualityName === 'low') this.env.envInterval = 8;
    this.terrain = new Terrain(this.hf, this.physics, scene, this.textures, this.quality.viewChunks, this.qualityName === 'low');
    this.vegetation = new Vegetation(this.hf, this.physics, scene, this.materials,
      this.qualityName === 'low' ? 0.35 : this.qualityName === 'medium' ? 0.7 : 1, this.quality.treeNear);
    this.water = new Water(this.hf, scene, this.textures);
    this.sea = new Sea(this.hf, scene, this.textures);
    this.particles = new Particles(scene);
    this.lights = new LightPool(scene, 8);
    this.fires = new Fires(this.lights, this.particles);
    this.rain = new RainFX(scene);
    this.flags = new Flags(this.bus);
    this.equipment = new Equipment(this.inventory);
    this.skills = new Skills(this.bus);
    this.reputation = new Reputation(this.bus);
    this.worldItems = new WorldItems(this.physics, scene, this.models);
    this.player = new PlayerController(this.physics, this.input, this.vitals, this.hf, this.bus);
    this.actions = new Actions(this);
    this.interaction = new Interaction(this);
    this.combat = new Combat(this);
    this.viewmodel = new Viewmodel(this);
    this.treeFelling = new TreeFelling(this);
    this.settlement = new Settlement(this);
    this.resources = new Resources(this);
    this.build = new BuildSystem(this);
    this.grass = new Grass(this.hf, scene, (x, z) => {
      if (this.hf.isHole(x, z)) return true;
      for (const b of this.settlement.buildings.values()) if (b.contains(x, z, -0.6)) return true;
      return false;
    });
    this.grass.enabled = this.quality.grass;
    this.scatter = new GroundScatter(this.hf, scene, this.materials, (x, z) => {
      for (const b of this.settlement.buildings.values()) if (b.contains(x, z, -1.5)) return true;
      return false;
    }, this.qualityName === 'low' ? 40 : this.qualityName === 'medium' ? 70 : 95);
    this.npcs = new NPCManager(this, buildWorldNav(this.settlement));
    this.animals = new AnimalManager(this);
    this.raids = new RaidSystem(this);
    this.director = new EventDirector(this);
    this.quests = new QuestSystem(QUESTS, {
      bus: this.bus,
      hasFlag: (f) => this.flags.has(f),
      setFlag: (f) => this.flags.set(f),
      itemCount: (id) => this.inventory.count(id),
      giveItem: (id, n) => { this.inventory.add(id, n); this.bus.emit('item:acquired', { itemId: id, count: n, source: 'reward' }); },
      takeItem: (id, n) => { const r = this.inventory.remove(id, n); this.equipment.validate(); return r; },
      giveCoins: (n) => { this.inventory.coins += n; this.bus.emit('sfx', { id: 'coins' }); },
      changeRep: (v, d, r) => this.reputation.change(v, d, r),
    });
    this.story = new Story(this.bus, this.flags, this.inventory);
    this.economy = new Economy(this.bus, this.reputation, this.skills, this.inventory);
    this.dialogue = new DialogueSystem(this);
    this.ui = new UIManager(this);
    this.input.touchMode = TouchControls.isTouchDevice();
    this.touch = this.input.touchMode ? new TouchControls(this) : null;
    this.save = new SaveSystem(this.bus);
    this.registerSaveables();
    this.wireEvents();
    this.loop = new GameLoop((dt) => this.fixedUpdate(dt), (a, fdt) => this.renderFrame(a, fdt), 30);
    // Vista inicial (menú): el pueblo al amanecer.
    this.terrain.preload(PLAYER_START.x, PLAYER_START.z);
    this.vegetation.update(PLAYER_START.x, PLAYER_START.z, true);
    this.physics.world.step();
    this.player.teleport(PLAYER_START.x, this.hf.heightAt(PLAYER_START.x, PLAYER_START.z) + 0.05, PLAYER_START.z, PLAYER_START.yaw);
    // Suelo de la choza.
    const hut = this.settlement.buildings.get('player_hut')!;
    this.player.teleport(PLAYER_START.x, hut.floorY + 0.08, PLAYER_START.z, PLAYER_START.yaw);
  }

  // ------------------------------------------------------------ ajustes

  static loadSettings(): { quality?: string; sensitivity?: number; volume?: number } {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}'); } catch { return {}; }
  }

  saveSettings(): void {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ quality: this.qualityName, sensitivity: this.input.sensitivity, volume: this.audio.volume }));
    } catch { /* sin almacenamiento */ }
  }

  setQuality(name: QualityName): void {
    this.qualityName = name;
    this.quality = { ...QUALITY_PRESETS[name] };
    const r = this.renderer.renderer;
    r.setPixelRatio(Math.min(window.devicePixelRatio, this.quality.pixelRatio));
    r.shadowMap.enabled = this.quality.shadows;
    this.env.setShadowQuality(this.quality.shadowMapSize, this.quality.shadows);
    this.terrain.viewChunks = this.quality.viewChunks;
    this.grass.enabled = this.quality.grass;
    this.grass.update(this.camPos, true);
    this.renderer.resize();
    this.saveSettings();
  }

  // ------------------------------------------------------------ guardado

  private registerSaveables(): void {
    const s = this.save;
    const reg = <T>(id: string, ser: () => unknown, de: (d: T) => void) => s.register({ id, serialize: ser, deserialize: (d) => de(d as T) });
    reg('time', () => this.time.serialize(), (d: { totalMinutes: number }) => this.time.deserialize(d));
    reg('weather', () => this.weather.serialize(), (d: Parameters<Weather['deserialize']>[0]) => this.weather.deserialize(d));
    reg('flags', () => this.flags.serialize(), (d: Parameters<Flags['deserialize']>[0]) => this.flags.deserialize(d));
    reg('player', () => ({ pos: this.player.pos.toArray(), yaw: this.player.yaw, pitch: this.player.pitch }), (d: { pos: number[]; yaw: number; pitch: number }) => {
      this.terrain.preload(d.pos[0], d.pos[2]);
      this.vegetation.update(d.pos[0], d.pos[2], true);
      this.physics.world.step();
      this.player.teleport(d.pos[0], d.pos[1] + 0.05, d.pos[2], d.yaw);
      this.player.pitch = d.pitch;
    });
    reg('vitals', () => this.vitals.serialize(), (d: Parameters<Vitals['deserialize']>[0]) => this.vitals.deserialize(d));
    reg('skills', () => this.skills.serialize(), (d: Parameters<Skills['deserialize']>[0]) => this.skills.deserialize(d));
    reg('inventory', () => this.inventory.serialize(), (d: Parameters<Inventory['deserialize']>[0]) => this.inventory.deserialize(d));
    reg('equipment', () => this.equipment.serialize(), (d: Parameters<Equipment['deserialize']>[0]) => this.equipment.deserialize(d));
    reg('containers', () => this.containers.serialize(), (d: Parameters<Containers['deserialize']>[0]) => this.containers.deserialize(d));
    reg('vegetation', () => this.vegetation.serialize(), (d: Parameters<Vegetation['deserialize']>[0]) => this.vegetation.deserialize(d));
    reg('settlement', () => this.settlement.serialize(), (d: Parameters<Settlement['deserialize']>[0]) => {
      this.settlement.deserialize(d);
      this.npcs.nav.setWallEnabled('breach', this.settlement.palisadeRepaired);
    });
    reg('worldItems', () => this.worldItems.serialize(), (d: Parameters<WorldItems['deserialize']>[0]) => this.worldItems.deserialize(d));
    reg('build', () => this.build.serialize(), (d: Parameters<BuildSystem['deserialize']>[0]) => this.build.deserialize(d));
    reg('resources', () => this.resources.serialize(), (d: Parameters<Resources['deserialize']>[0]) => this.resources.deserialize(d));
    reg('fires', () => this.fires.serialize(), (d: Parameters<Fires['deserialize']>[0]) => this.fires.deserialize(d));
    reg('reputation', () => this.reputation.serialize(), (d: Parameters<Reputation['deserialize']>[0]) => this.reputation.deserialize(d));
    reg('quests', () => this.quests.serialize(), (d: Parameters<QuestSystem['deserialize']>[0]) => this.quests.deserialize(d));
    reg('economy', () => this.economy.serialize(), (d: Parameters<Economy['deserialize']>[0]) => this.economy.deserialize(d));
    reg('npcs', () => this.npcs.serialize(), (d: Parameters<NPCManager['deserialize']>[0]) => this.npcs.deserialize(d));
    reg('animals', () => this.animals.serialize(), (d: Parameters<AnimalManager['deserialize']>[0]) => this.animals.deserialize(d));
    reg('raids', () => this.raids.serialize(), (d: Parameters<RaidSystem['deserialize']>[0]) => this.raids.deserialize(d));
    reg('director', () => this.director.serialize(), (d: Parameters<EventDirector['deserialize']>[0]) => this.director.deserialize(d));
    reg('dialogue', () => this.dialogue.serialize(), (d: Parameters<DialogueSystem['deserialize']>[0]) => this.dialogue.deserialize(d));
    reg('discovered', () => [...this.discovered], (d: string[]) => { this.discovered.clear(); for (const x of d) this.discovered.add(x); });
    reg('post', () => 0, () => { this.settlement.applyFlags(); });
    s.summary = () => `Día ${this.time.day}, ${this.time.formatClock()} · ${this.story.stage}/10`;
  }

  // ------------------------------------------------------------ eventos

  private wireEvents(): void {
    const b = this.bus;
    b.on('sfx', (e) => this.audio.play(e.id, e.x !== undefined ? { x: e.x, y: e.y, z: e.z } : undefined, e.volume ?? 1));
    b.on('time:hour', (e) => {
      if (e.hour === 6) {
        this.economy.restock();
        this.vegetation.regrow(this.time.day);
        this.resources.regrow(this.time.day);
        this.raids.updateCorpses();
      }
    });
    b.on('player:damaged', () => { this.combat.shake = Math.max(this.combat.shake, 0.4); });
    b.on('doc:read', (e) => { if (e.docId === 'map_fragment_1') this.discovered.add('cave_crow'); });
    b.on('quest:completed', (e) => {
      if (e.questId === 'side_palisade') this.consumeDeliveredLogs();
      this.save.save('auto');
    });
    b.on('game:saved', () => { /* hook para UI */ });
  }

  // ------------------------------------------------------------ partida

  newGame(): void {
    this.started = true;
    this.inventory.coins = 18;
    this.discovered.add('robledo');
    this.quests.start('main_legacy');
    this.bus.emit('notify', { text: 'Robledo, Valle de Arnós. Primavera de 1497.', kind: 'quest' });
    setTimeout(() => this.ui.say('Martín', 'Siete años sin noticias de padre... «Si un día no vuelvo, busca bajo mis pies».', 6), 1500);
    this.ui.setHint('');
  }

  /** Arranca el bucle (el menú se ve sobre el mundo en pausa). */
  start(): void {
    this.loop.start();
  }

  /** Pasar del menú al juego. */
  enterGame(): void {
    this.audio.unlock();
    this.ui.close();
    this.paused = false;
    this.input.gameplayEnabled = true;
    this.input.requestPointerLock();
  }

  onUIChanged(): void {
    const blocking = this.ui.blocking;
    if (blocking) {
      this.input.gameplayEnabled = false;
      this.input.exitPointerLock();
      this.paused = true;
      this.input.clearAll();
    } else if (this.started && !this.vitals.dead) {
      this.input.gameplayEnabled = true;
      this.paused = false;
      this.input.requestPointerLock();
    }
  }

  combatDanger(): boolean {
    return this.combat.enemiesNear(25);
  }

  /** Troncos dentro del círculo de la carpintería. */
  woodDelivered(): number {
    const z = this.settlement.woodDropZone;
    let n = 0;
    for (const wi of this.worldItems.items.values()) {
      if (wi.itemId !== 'log' || wi.carried) continue;
      const t = wi.body.translation();
      if (Math.hypot(t.x - z.x, t.z - z.z) < z.r) n++;
    }
    return n;
  }

  private consumeDeliveredLogs(): void {
    const z = this.settlement.woodDropZone;
    for (const wi of [...this.worldItems.items.values()]) {
      if (wi.itemId !== 'log') continue;
      const t = wi.body.translation();
      if (Math.hypot(t.x - z.x, t.z - z.z) < z.r + 1) this.worldItems.remove(wi);
    }
  }

  // ------------------------------------------------------------ bucle

  private fixedUpdate(dt: number): void {
    if (this.paused) {
      this.input.endTick();
      return;
    }
    const gameMinutes = dt * this.time.minutesPerRealSecond;
    this.save.playTime += dt;
    this.time.update(dt);
    this.weather.update(dt, gameMinutes);
    this.reputation.update(dt);
    // Equipo rápido y antorcha.
    this.handleEquipKeys();
    // Movimiento (carga → velocidad).
    this.player.speedMul = this.inventory.overEncumbered ? 0.6 : 1;
    if (this.vitals.health < 25) this.player.speedMul *= 0.85;
    this.player.frozen = this.vitals.dead;
    this.build.update();
    // En modo construcción el clic coloca y E desmonta: no hay combate ni uso.
    if (!this.build.active) {
      this.interaction.update(dt);
      this.combat.update(dt);
    }
    // Antes de mover: dentro de la cueva el jugador está legítimamente bajo el terreno.
    const pp = this.player.pos;
    this.player.underground = this.settlement.cave.depthAt(pp.x, pp.y, pp.z) > 0.001 || this.hf.isHole(pp.x, pp.z);
    this.player.update(dt);
    this.settlement.update(dt);
    this.npcs.update(dt);
    this.animals.update(dt);
    this.raids.update(dt);
    this.treeFelling.update(dt);
    this.fires.update(this.time.hourFloat, gameMinutes);
    this.updateAreas(dt);
    this.updateSurvival(dt, gameMinutes);
    this.updateWoodQuest(dt);
    this.physics.step(dt);
    this.worldItems.update(dt);
    this.input.endTick();
  }

  private handleEquipKeys(): void {
    const inp = this.input;
    const eq = this.equipment;
    for (let i = 0; i < 4; i++) {
      if (inp.wasPressed(`slot${i + 1}` as 'slot1')) {
        const id = eq.quick[i];
        if (id && this.inventory.has(id)) {
          if (eq.slots.main === id) eq.unequip('main');
          else eq.equip(id);
          this.bus.emit('sfx', { id: 'equip' });
        }
      }
    }
    if (inp.wasPressed('torch')) {
      if (eq.slots.off === 'torch') {
        eq.unequip('off');
        this.bus.emit('sfx', { id: 'equip' });
      } else if (this.inventory.has('torch')) {
        const main = eq.slots.main ? itemDef(eq.slots.main) : null;
        if (main?.weapon === 'bow' || main?.weapon === 'spear') {
          eq.unequip('main');
          this.bus.emit('notify', { text: 'Bajas el arma de dos manos para llevar la antorcha.', kind: 'info' });
        }
        eq.equip('torch');
        this.bus.emit('sfx', { id: 'fire_light' });
      } else this.bus.emit('notify', { text: 'No tienes antorchas.', kind: 'warning' });
    }
  }

  private updateAreas(dt: number): void {
    this.areaT -= dt;
    if (this.areaT > 0) return;
    this.areaT = 0.25;
    const p = this.player.pos;
    // Cueva: profundidad → oscuridad.
    const depth = this.settlement.cave.depthAt(p.x, p.y, p.z);
    this.player.underground = depth > 0.02;
    let inside: string | null = null;
    for (const b of this.settlement.buildings.values()) {
      if (b.def.enterable && !b.def.openFront && b.contains(p.x, p.z, 0.05) && p.y < b.floorY + 2.5) inside = b.def.id;
    }
    this.env.interiorTarget = Math.max(depth, inside ? 0.5 : 0);
    this.player.surfaceOverride = depth > 0.02 ? 'rock' : inside ? (inside === 'church' ? 'stone' : 'wood') : null;
    const areas = new Set<string>();
    if (depth > 0.3) areas.add('cave_crow_inside');
    for (const poi of POIS) if (Math.hypot(p.x - poi.x, p.z - poi.z) < poi.radius) areas.add(poi.id);
    for (const a of areas) {
      if (!this.insideAreas.has(a)) {
        this.bus.emit('area:entered', { areaId: a });
        if (!this.discovered.has(a) && POIS.some((x) => x.id === a)) {
          this.discovered.add(a);
          this.bus.emit('notify', { text: `Descubierto: ${POIS.find((x) => x.id === a)!.name}`, kind: 'info' });
        }
      }
    }
    for (const a of this.insideAreas) if (!areas.has(a)) this.bus.emit('area:left', { areaId: a });
    this.insideAreas = areas;
  }

  private updateSurvival(dt: number, gameMinutes: number): void {
    const p = this.player.pos;
    const torch = this.equipment.torchLit && this.equipment.slots.off === 'torch';
    const indoors = this.env.interiorTarget > 0.3 && !this.player.underground;
    const temp = ambientTemperature({
      hour: this.time.hourFloat, altitude: p.y, chill: indoors ? 0 : this.weather.chill,
      sheltered: indoors, inCave: this.player.underground, fireHeat: this.fires.heatAt(p) + (torch ? 3 : 0),
    });
    const combatExertion = this.combat.state !== 'idle' ? 0.5 : 0;
    this.vitals.update(dt, gameMinutes, {
      ambientTemp: temp, insulation: 4 + this.equipment.armorValues().warmth,
      exertion: Math.max(this.player.exertion, combatExertion),
      resting: !this.player.sprinting && this.combat.state !== 'block' && this.combat.state !== 'draw',
    });
    // La antorcha se consume.
    if (torch) {
      this.torchBurn += gameMinutes;
      if (this.torchBurn > 150) {
        this.torchBurn = 0;
        this.inventory.remove('torch', 1);
        this.bus.emit('notify', { text: 'La antorcha se ha consumido.', kind: 'info' });
        this.equipment.validate();
        if (this.inventory.has('torch')) this.equipment.equip('torch');
      }
    }
    if (this.vitals.dead && !this.deathShown) {
      this.deathShown = true;
      const cause = this.vitals.hunger <= 0 ? 'Muerto de hambre.' : this.vitals.thirst <= 0 ? 'Muerto de sed.' : this.vitals.isFreezing ? 'Muerto de frío.' : 'Caíste en combate.';
      this.bus.emit('player:died', { cause });
      setTimeout(() => this.ui.openDeath(cause), 1500);
    }
  }

  private updateWoodQuest(dt: number): void {
    this.woodT -= dt;
    if (this.woodT > 0 || this.quests.stageId('side_palisade') !== 'logs') return;
    this.woodT = 1;
    const n = Math.min(LOGS_REQUIRED, this.woodDelivered());
    if (n !== this.lastWood) {
      if (n > this.lastWood && this.lastWood >= 0) this.bus.emit('notify', { text: `Troncos en la carpintería: ${n}/${LOGS_REQUIRED}`, kind: 'quest' });
      this.lastWood = n;
      this.quests.setProgress('side_palisade', 0, n);
    }
  }

  private renderFrame(alpha: number, frameDt: number): void {
    this.ui.handleKeys();
    this.renderer.renderer.info.reset();
    // Hit-stop: ralentiza la lógica unos milisegundos tras un impacto.
    if (this.combat.hitStop > 0) {
      this.combat.hitStop -= frameDt;
      this.loop.timeScale = 0.08;
    } else this.loop.timeScale = 1;
    const { dx, dy } = this.input.takeMouseDelta();
    if (!this.paused) this.player.look(dx, dy, this.input.sensitivity);
    const cam = this.renderer.camera;
    this.player.eyePosition(this.paused ? 1 : alpha, this.camPos);
    // Sacudida de cámara.
    const sh = this.combat.shake;
    cam.position.copy(this.camPos);
    cam.rotation.set(this.player.pitch + (Math.random() - 0.5) * sh * 0.03, this.player.yaw + (Math.random() - 0.5) * sh * 0.03, (Math.random() - 0.5) * sh * 0.02, 'YXZ');
    // Zoom al tensar el arco.
    const targetFov = this.combat.aimingBow ? this.baseFov - 12 * clamp(this.combat.drawT, 0, 1) : this.player.sprinting ? this.baseFov + 4 : this.baseFov;
    cam.fov = damp(cam.fov, targetFov, 8, frameDt);
    cam.updateProjectionMatrix();
    GlobalUniforms.uTime.value += frameDt;
    // Streaming y LOD.
    this.terrain.update(this.camPos.x, this.camPos.z);
    this.vegetation.update(this.camPos.x, this.camPos.z);
    this.grass.update(this.camPos);
    this.scatter.update(this.camPos);
    this.build.updateGhost();
    this.water.update(frameDt);
    this.env.update(frameDt, this.time, this.weather, this.camPos);
    this.settlement.updateWindows(this.time.hourFloat);
    this.npcs.syncVisuals(alpha, frameDt);
    this.animals.syncVisuals(alpha, frameDt);
    this.viewmodel.update(frameDt, cam);
    this.updatePlayerTorch();
    this.lights.update(frameDt, this.camPos);
    this.particles.update(frameDt, cam, this.env.fog);
    this.rain.update(frameDt, this.camPos, this.player.underground ? 0 : this.weather.rain * (1 - this.env.interior), this.weather.wind);
    // Audio.
    this.audio.setListener(cam);
    this.audio.updateAmbience(frameDt, this.ambienceState());
    this.ui.updateHUD(frameDt);
    this.touch?.update();
    this.updatePerf();
    this.renderer.render();
    if (this.started) this.viewmodel.render(this.renderer.renderer);
  }

  private updatePlayerTorch(): void {
    const on = this.equipment.torchLit && this.equipment.slots.off === 'torch' && this.started;
    const id = 'player_torch';
    const tip = this.viewmodel.torchTip;
    const l = this.lights.get(id);
    if (!l) this.lights.add({ id, pos: tip.clone(), color: new THREE.Color(0xff9a4a), intensity: 38, range: 16, flicker: 0.4, priority: 10, enabled: on });
    else { l.pos.copy(tip); l.enabled = on; }
    const em = this.particles.emitters.get(id);
    // La llama se dibuja en el viewmodel; al mundo solo sale un hilo de humo.
    if (!em) this.particles.addEmitter({ id, kind: 'smoke', pos: tip.clone(), rate: 2.5, spread: 0.05, vel: new THREE.Vector3(0, 0.8, 0), sizeMul: 0.35, enabled: on });
    else { em.pos.copy(tip); em.enabled = on; }
  }

  private ambienceState(): Parameters<AudioEngine['updateAmbience']>[1] {
    const p = this.player.pos;
    const st = this.hf.streamInfo(p.x, p.z);
    let fireDist = Infinity;
    for (const f of this.fires.fires.values()) if (f.lit && !f.hidden) fireDist = Math.min(fireDist, f.pos.distanceTo(p));
    const v = VILLAGES[0];
    return {
      day: 1 - this.time.nightFactor,
      wind: this.weather.wind,
      rain: this.weather.rain,
      inCave: this.player.underground ? 1 : 0,
      indoors: this.env.interiorTarget > 0.3 && !this.player.underground ? 1 : 0,
      waterDist: st ? Math.max(0, st.dist - st.halfW) : Infinity,
      fireDist,
      forest: this.hf.forestDensity(p.x, p.z),
      village: 1 - clamp(Math.hypot(p.x - v.x, p.z - v.z) / 100, 0, 1),
      storm: this.weather.state === 'storm',
    };
  }

  private perfT = 0;
  private updatePerf(): void {
    if (!this.ui.perf.classList.contains('show')) return;
    this.perfT -= 1;
    if (this.perfT > 0) return;
    this.perfT = 15;
    const s = this.renderer.stats;
    const p = this.player.pos;
    this.ui.perf.textContent = [
      `FPS ${this.loop.fps.toFixed(0)}  frame ${this.loop.frameTimeMs.toFixed(1)} ms`,
      `draw ${s.calls}  tris ${(s.triangles / 1000).toFixed(0)}k  geo ${s.geometries} tex ${s.textures}`,
      `terreno: ${this.terrain.stats.meshes} chunks, ${this.terrain.stats.colliders} colliders`,
      `árboles: ${this.vegetation.stats.near} cerca / ${this.vegetation.stats.far} lejos, ${this.vegetation.stats.colliders} colliders`,
      `luces ${this.lights.activeCount}/${this.lights.size} (${this.lights.sources.size} fuentes)  partículas ${this.particles.activeCount}`,
      `actores ${this.registry.actors.size}  cuerpos ${this.physics.world.bodies.len()}  objetos ${this.worldItems.items.size}`,
      `pos ${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}  día ${this.time.day} ${this.time.formatClock()}  ${this.weather.state}`,
      `ataque: ${this.raids.phase}`,
    ].join('\n');
  }
}
