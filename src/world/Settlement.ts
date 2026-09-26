/**
 * Construye el contenido del vertical slice a partir de WorldLayout:
 * Robledo (edificios, interiores, empalizada, torre, pozo, mercado,
 * campos), puente, cueva y campamento de bandidos. Registra
 * interactuables, fuegos, contenedores, objetos y "lugares" para la IA.
 */
import * as THREE from 'three';
import type { Game } from '../game/Game';
import { BuildingInstance, type Door } from './Buildings';
import {
  BANDIT_CAMP, BRIDGES, BUILDINGS, CAVE, FIELDS, MARKET_STALLS, PALISADE, PIER, PLAYER_PLOT, SEA, WATCHTOWER, WELL, WOLF_DEN,
} from './WorldLayout';
import { Cave } from './Cave';
import { RAPIER, GROUP, groups, ALL } from '../engine/Physics';
import { colliderForShape } from '../items/WorldItems';
import { worldBox } from '../engine/placeholder/Materials';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Rng } from '../core/rng';
import { toWorldXZ } from '../core/math';

export interface Place {
  id: string;
  x: number;
  y: number;
  z: number;
  /** Orientación al llegar (yaw). */
  yaw: number;
  /** Edificio en cuyo interior está (el NPC "entra"). */
  building?: string;
  /** Actividad visual al llegar. */
  anim?: 'work' | 'hammer' | 'pray' | 'sit' | 'guard' | 'farm' | 'sell' | 'drink' | 'chop' | 'fish';
}

export interface Gate {
  leaves: { pivot: THREE.Object3D; body: RAPIER.RigidBody; side: number }[];
  open: boolean;
  angle: number;
  pos: THREE.Vector3;
}

export class Settlement {
  readonly buildings = new Map<string, BuildingInstance>();
  readonly doors = new Map<string, Door>();
  readonly places = new Map<string, Place>();
  readonly cave: Cave;
  gate!: Gate;
  palisadeRepaired = false;
  private breachFill!: THREE.Group;
  private breachColliders: RAPIER.Collider[] = [];
  /** Zona de entrega de troncos (misión de la empalizada). */
  readonly woodDropZone = { x: 0, y: 0, z: 0, r: 3.2 };
  readonly towerTop = new THREE.Vector3();
  readonly towerBottom = new THREE.Vector3();
  private dynamicProps: { id: string; body: RAPIER.RigidBody; mesh: THREE.Object3D }[] = [];
  private group = new THREE.Group();
  /** Posiciones de los puestos de guardia durante un ataque. */
  readonly defensePosts: { id: string; x: number; z: number }[] = [];

  constructor(private readonly g: Game) {
    g.renderer.scene.add(this.group);
    for (const def of BUILDINGS) {
      const b = new BuildingInstance(def, g.hf, g.materials, g.physics);
      this.group.add(b.group);
      this.buildings.set(def.id, b);
      for (const d of b.doors) {
        this.doors.set(d.id, d);
        this.registerDoor(b, d);
      }
      // Hogar oculto (humo de chimenea) en casas con chimenea no visitables.
      if (b.chimneyTop && !['player_hut', 'tavern', 'smithy'].includes(def.id)) {
        g.fires.add({ id: `hearth_${def.id}`, kind: 'hearth', pos: b.interiorLight, policy: 'evening', canCook: false, heat: 0, hidden: true, smokePos: b.chimneyTop, condition: () => this.isOccupied(def.id) });
      }
    }
    this.buildInteriors();
    this.buildVillageProps();
    this.buildPalisade();
    this.buildWatchtower();
    this.buildFields();
    this.buildBridges();
    this.buildHarbor();
    this.buildPlotStart();
    this.buildIslands();
    this.cave = new Cave(g.hf, g.physics, g.renderer.scene, g.materials);
    this.buildCaveContent();
    this.buildBanditCamp();
    this.buildPlaces();
    this.batchStatics();
  }

  private staticObjs: THREE.Object3D[] = [];
  /** Nº de lotes estáticos generados (métrica). */
  staticBatches = 0;

  /**
   * Fusiona todo el mobiliario estático por material y celda de 48 m:
   * cientos de objetos → unas pocas decenas de draw calls con culling.
   */
  private batchStatics(): void {
    const CELL = 48;
    const buckets = new Map<string, { mat: THREE.Material; geos: THREE.BufferGeometry[]; shadow: boolean }>();
    for (const obj of this.staticObjs) {
      obj.updateMatrixWorld(true);
      obj.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mat = mesh.material as THREE.Material;
        const wp = new THREE.Vector3().setFromMatrixPosition(mesh.matrixWorld);
        const key = `${mat.uuid}:${Math.floor(wp.x / CELL)}:${Math.floor(wp.z / CELL)}`;
        let b = buckets.get(key);
        if (!b) { b = { mat, geos: [], shadow: false }; buckets.set(key, b); }
        // Normalizar: no indexada y solo posición/normal/uv (requisito de mergeGeometries).
        let g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
        g.applyMatrix4(mesh.matrixWorld);
        for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
        if (!g.attributes.normal) g.computeVertexNormals();
        if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
        g = g.index ? g.toNonIndexed() : g;
        b.geos.push(g);
        b.shadow ||= mesh.castShadow;
      });
    }
    for (const b of buckets.values()) {
      const merged = mergeGeometries(b.geos);
      if (!merged) {
        console.error('[Settlement] no se pudo fusionar un lote estático');
        continue;
      }
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, b.mat);
      mesh.castShadow = b.shadow;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
      this.staticBatches++;
    }
    this.staticObjs = [];
  }

  /** Hook para el sistema de NPCs: ¿hay alguien en casa? */
  occupancy: ((buildingId: string) => boolean) | null = null;
  isOccupied(id: string): boolean {
    return this.occupancy ? this.occupancy(id) : true;
  }

  // ------------------------------------------------------------ utilidades

  private ground(x: number, z: number): number {
    return this.g.hf.heightAt(x, z);
  }

  /** Mueble estático con collider fijo. Devuelve el collider. */
  placeStatic(model: string, x: number, y: number, z: number, rotY = 0, tag = 'static'): RAPIER.Collider {
    const m = this.g.models.create(model);
    m.object.position.set(x, y, z);
    m.object.rotation.y = rotY;
    m.object.updateMatrixWorld(true);
    // Se fusiona con el resto del mobiliario estático al final (batching).
    this.staticObjs.push(m.object);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
    const body = this.g.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z).setRotation(q));
    const col = this.g.physics.world.createCollider(colliderForShape(m.shape).setCollisionGroups(groups(GROUP.STATIC, ALL)), body);
    this.g.physics.tag(col, { kind: 'static', id: `${tag}:${model}` });
    return col;
  }

  /** Objeto de atrezo dinámico (barril, caja, taburete): se empuja y agarra. */
  placeDynamic(id: string, model: string, x: number, y: number, z: number, rotY = 0): RAPIER.Collider {
    const m = this.g.models.create(model);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
    const body = this.g.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).setRotation(q).setLinearDamping(0.3).setAngularDamping(0.8).setCanSleep(true),
    );
    const col = this.g.physics.world.createCollider(
      colliderForShape(m.shape).setMass(m.mass).setFriction(0.9).setCollisionGroups(groups(GROUP.PROP, ALL)),
      body,
    );
    body.sleep();
    this.g.physics.tag(col, { kind: 'prop', id });
    m.object.position.set(x, y, z);
    m.object.quaternion.copy(q);
    this.group.add(m.object);
    this.dynamicProps.push({ id, body, mesh: m.object });
    return col;
  }

  /** Coloca en coordenadas locales de un edificio. */
  private inB(b: BuildingInstance, lx: number, ly: number, lz: number): THREE.Vector3 {
    return b.localToWorld(lx, ly, lz);
  }

  private registerDoor(b: BuildingInstance, d: Door): void {
    const col = d.body.collider(0);
    this.g.interactables.register(col.handle, {
      id: d.id, kind: 'door', pos: d.worldPos,
      label: () => (d.locked ? `${b.def.name} (cerrada con llave)` : d.open ? 'Cerrar puerta' : 'Abrir puerta'),
      interact: (game) => game.actions.toggleDoor(d),
    });
  }

  // ------------------------------------------------------------ interiores

  private buildInteriors(): void {
    const g = this.g;
    // ---- Choza del jugador ----
    const hut = this.buildings.get('player_hut')!;
    const r = hut.rotY;
    const fy = hut.floorY;
    const bedP = this.inB(hut, -1.85, 0.3, -0.7);
    const bedCol = this.placeStatic('bed', bedP.x, fy + 0.3, bedP.z, r, 'hut');
    g.interactables.register(bedCol.handle, {
      id: 'bed_player', kind: 'bed', pos: bedP,
      label: () => 'Cama · dormir o descansar',
      interact: (game) => game.actions.sleep(),
    });
    const chestP = this.inB(hut, 1.95, 0.3, -1.65);
    const chestCol = this.placeStatic('chest', chestP.x, fy + 0.3, chestP.z, r, 'hut');
    g.containers.create('chest_player', 'Arcón de la familia', null, [
      { id: 'sword', count: 1 }, { id: 'torch', count: 3 }, { id: 'firewood', count: 3 }, { id: 'bucket', count: 1 },
    ], 0);
    g.interactables.register(chestCol.handle, {
      id: 'chest_player', kind: 'container', pos: chestP,
      label: () => 'Abrir arcón',
      interact: (game) => game.ui.openContainer('chest_player'),
    });
    const hearthP = this.inB(hut, 1.3, 0.12, 0.7);
    const hearthCol = this.placeStatic('hearth', hearthP.x, fy + 0.12, hearthP.z, r, 'hut');
    g.fires.add({ id: 'hearth_player', kind: 'hearth', pos: new THREE.Vector3(hearthP.x, fy + 0.15, hearthP.z), policy: 'manual', canCook: true, heat: 16, lit: true, fuel: 2.5, smokePos: hut.chimneyTop ?? undefined });
    g.interactables.register(hearthCol.handle, {
      id: 'hearth_player', kind: 'hearth', pos: hearthP,
      label: (game) => game.actions.hearthLabel('hearth_player'),
      interact: (game) => game.actions.useFire('hearth_player'),
    });
    const tableP = this.inB(hut, -0.1, 0.4, -1.55);
    this.placeStatic('table', tableP.x, fy + 0.4, tableP.z, r, 'hut');
    const stoolP = this.inB(hut, -0.1, 0.25, -0.75);
    this.placeDynamic('stool_hut', 'stool', stoolP.x, fy + 0.25, stoolP.z, r);
    // Sobre la mesa: el hacha, pan, manzana, odre y cuchillo (fijos hasta agarrarlos).
    const onTable = (id: string, item: string, lx: number, lz: number, ry: number, rotX = 0) => {
      const p = this.inB(hut, lx, 0, lz);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rotX, r + ry, 0));
      const dy = item === 'axe' ? 0.045 : item === 'knife' ? 0.02 : item === 'waterskin' ? 0.1 : 0.05;
      g.worldItems.spawn(item, p.x, fy + 0.83 + dy, p.z, { uid: id, authored: true, rot: q, frozen: true });
    };
    onTable('hut_axe', 'axe', -0.35, -1.5, 0.3, Math.PI / 2);
    onTable('hut_bread', 'bread', 0.35, -1.7, 0.4);
    onTable('hut_apple', 'apple', 0.55, -1.45, 0);
    onTable('hut_knife', 'knife', 0.15, -1.35, 1.2, Math.PI / 2);
    onTable('hut_waterskin', 'waterskin', 0.5, -1.85, 0);
    // Tabla suelta del suelo (junto a la cama): esconde la carta.
    const boardP = this.inB(hut, -0.75, 0.035, 0.95);
    const board = new THREE.Mesh(worldBox(0.9, 0.04, 0.22, 1), g.materials.get('darkWood'));
    board.position.copy(boardP).setY(fy + 0.075);
    board.rotation.y = r + 0.03;
    this.group.add(board);
    const boardBody = g.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(board.position.x, board.position.y, board.position.z).setRotation(board.quaternion));
    const boardCol = g.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(0.45, 0.03, 0.11).setCollisionGroups(groups(GROUP.STATIC, ALL)), boardBody);
    this.board = { mesh: board, body: boardBody, pos: boardP, rot: r, floorY: fy, opened: false };
    g.interactables.register(boardCol.handle, {
      id: 'loose_board', kind: 'board', pos: boardP,
      label: (game) => (game.flags.has('board_opened') ? null : 'Tabla suelta · levantar'),
      interact: (game) => {
        if (game.flags.has('board_opened')) return;
        game.flags.set('board_opened');
        this.openBoard(true);
        game.bus.emit('sfx', { id: 'wood_creak' });
        game.bus.emit('notify', { text: 'Bajo la tabla hay una carta lacrada.', kind: 'quest' });
      },
    });

    // ---- Taberna ----
    const tav = this.buildings.get('tavern')!;
    const tr = tav.rotY, ty = tav.floorY;
    const counterP = this.inB(tav, 2.2, 0.55, -2.4);
    this.placeStatic('counter', counterP.x, ty + 0.55, counterP.z, tr, 'tavern');
    for (const [lx, lz] of [[-2.8, 0.8], [-2.8, -1.8], [0.2, 0.9]] as const) {
      const p = this.inB(tav, lx, 0.4, lz);
      this.placeStatic('table', p.x, ty + 0.4, p.z, tr, 'tavern');
      for (const s of [-1, 1]) {
        const bp = this.inB(tav, lx, 0.22, lz + s * 0.75);
        this.placeStatic('bench', bp.x, ty + 0.22, bp.z, tr, 'tavern');
      }
      const cp = this.inB(tav, lx + 0.3, 0.9, lz);
      g.fires.add({ id: `candle_tav_${lx}_${lz}`, kind: 'candle', pos: new THREE.Vector3(cp.x, ty + 0.9, cp.z), policy: 'evening', canCook: false, heat: 0 });
      this.placeStatic('candle', cp.x, ty + 0.83, cp.z, 0, 'tavern');
    }
    for (let i = 0; i < 3; i++) {
      const p = this.inB(tav, 4.6, 0.45, -1 + i * 0.8);
      this.placeDynamic(`tav_barrel_${i}`, 'barrel', p.x, ty + 0.46, p.z, i);
    }
    const tavHearth = this.inB(tav, -4.4, 0.12, -2.6);
    this.placeStatic('hearth', tavHearth.x, ty + 0.12, tavHearth.z, tr, 'tavern');
    g.fires.add({ id: 'hearth_tavern', kind: 'hearth', pos: new THREE.Vector3(tavHearth.x, ty + 0.15, tavHearth.z), policy: 'evening', canCook: true, heat: 14, smokePos: tav.chimneyTop ?? undefined, condition: () => this.isOccupied('tavern') });
    const tavCauldron = this.inB(tav, -4.4, 0.25, -2.6);
    this.placeStatic('cauldron', tavCauldron.x, ty + 0.25, tavCauldron.z, 0, 'tavern');
    g.containers.create('tavern_stock', 'Despensa de la taberna', 'robledo', [{ id: 'bread', count: 6 }, { id: 'cheese', count: 3 }, { id: 'wine', count: 4 }], 20);
    const tavChestP = this.inB(tav, 4.6, 0.3, -3.2);
    const tavChest = this.placeStatic('chest', tavChestP.x, ty + 0.3, tavChestP.z, tr + Math.PI / 2, 'tavern');
    g.interactables.register(tavChest.handle, { id: 'tavern_stock', kind: 'container', pos: tavChestP, label: () => 'Despensa de la taberna (ajena)', interact: (game) => game.ui.openContainer('tavern_stock') });

    // ---- Iglesia ----
    const ch = this.buildings.get('church')!;
    const cr = ch.rotY, cy = ch.floorY;
    for (let i = 0; i < 4; i++) for (const s of [-1, 1]) {
      const p = this.inB(ch, s * 2.0, 0.45, 3.5 - i * 2.2);
      this.placeStatic('pew', p.x, cy + 0.45, p.z, cr, 'church');
    }
    const altarP = this.inB(ch, 0, 0.5, -6.6);
    this.placeStatic('altar', altarP.x, cy + 0.5, altarP.z, cr, 'church');
    for (const s of [-1, 1]) {
      const p = this.inB(ch, s * 0.7, 1.08, -6.6);
      this.placeStatic('candle', p.x, cy + 1.08, p.z, 0, 'church');
      g.fires.add({ id: `candle_church_${s}`, kind: 'candle', pos: new THREE.Vector3(p.x, cy + 1.2, p.z), policy: 'always', canCook: false, heat: 0 });
    }
    // Registros parroquiales (fase posterior de la historia).
    g.containers.create('church_records', 'Arca de los registros', 'robledo', [], 3);
    const recP = this.inB(ch, -3.5, 0.3, -6.8);
    const recCol = this.placeStatic('chest', recP.x, cy + 0.3, recP.z, cr, 'church');
    g.interactables.register(recCol.handle, { id: 'church_records', kind: 'container', pos: recP, label: () => 'Arca de los registros (ajena)', interact: (game) => game.ui.openContainer('church_records') });

    // ---- Herrería ----
    const sm = this.buildings.get('smithy')!;
    const sr = sm.rotY, sy = sm.floorY;
    const forgeP = this.inB(sm, -1.8, 0.5, -1.8);
    this.placeStatic('forge', forgeP.x, sy + 0.5, forgeP.z, sr, 'smithy');
    g.fires.add({ id: 'forge_smithy', kind: 'forge', pos: new THREE.Vector3(forgeP.x, sy + 1.0, forgeP.z), policy: 'work', canCook: true, heat: 18, smokePos: sm.chimneyTop ?? undefined, condition: () => g.npcs?.isAlive('bartolome') ?? true });
    const anvilP = this.inB(sm, 0.6, 0.4, -0.3);
    this.placeStatic('anvil', anvilP.x, sy + 0.4, anvilP.z, sr + 0.3, 'smithy');
    const rackP = this.inB(sm, 2.6, 0.9, -2.7);
    this.placeStatic('weapon_rack', rackP.x, sy + 0.9, rackP.z, sr, 'smithy');
    // Armas expuestas (propiedad del herrero: cogerlas a la vista es robo).
    const onRack = (uid: string, item: string, lx: number) => {
      const p = this.inB(sm, lx, 0, -2.62);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.12, sr, 0));
      g.worldItems.spawn(item, p.x, sy + 0.95, p.z, { uid, authored: true, rot: q, frozen: true, owner: 'robledo' });
    };
    onRack('smithy_spear', 'spear', 2.0);
    onRack('smithy_sword', 'sword', 2.6);
    onRack('smithy_axe', 'axe', 3.2);
    const benchP = this.inB(sm, 2.4, 0.45, 0.3);
    this.placeStatic('workbench', benchP.x, sy + 0.45, benchP.z, sr + Math.PI / 2, 'smithy');
    const tubP = this.inB(sm, -0.5, 0.45, -2.2);
    this.placeDynamic('smithy_barrel', 'barrel', tubP.x, sy + 0.46, tubP.z, 0);

    // ---- Carpintería ----
    const cp = this.buildings.get('carpentry')!;
    const cpr = cp.rotY, cpy = cp.floorY;
    const wbP = this.inB(cp, -1.2, 0.45, -1.6);
    this.placeStatic('workbench', wbP.x, cpy + 0.45, wbP.z, cpr, 'carpentry');
    const wpP = this.inB(cp, 1.9, 0.45, -1.8);
    this.placeStatic('woodpile', wpP.x, cpy + 0.45, wpP.z, cpr, 'carpentry');
    // Zona de entrega de troncos: delante de la carpintería.
    const dz = this.inB(cp, 0, 0, 5.5);
    this.woodDropZone.x = dz.x; this.woodDropZone.z = dz.z; this.woodDropZone.y = this.ground(dz.x, dz.z);
    const marker = new THREE.Mesh(new THREE.RingGeometry(this.woodDropZone.r - 0.15, this.woodDropZone.r, 32), new THREE.MeshStandardMaterial({ color: 0x5a4a30, roughness: 1 }));
    marker.rotation.x = -Math.PI / 2;
    marker.position.set(dz.x, this.woodDropZone.y + 0.03, dz.z);
    this.staticObjs.push(marker);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      const px = dz.x + Math.cos(a) * this.woodDropZone.r, pz = dz.z + Math.sin(a) * this.woodDropZone.r;
      this.placeStatic('stalagmite', px, this.ground(px, pz) + 0.3, pz, 0, 'marker');
    }

    // ---- Establo ----
    const st = this.buildings.get('stable')!;
    for (let i = 0; i < 3; i++) {
      const p = this.inB(st, -2.5 + i * 2.5, 0.3, -1.5);
      this.placeDynamic(`stable_sack_${i}`, 'sack', p.x, st.floorY + 0.35, p.z, i);
    }
    const cartP = this.inB(st, 5.5, 0.5, 2.5);
    this.placeStatic('cart', cartP.x, this.ground(cartP.x, cartP.z) + 0.55, cartP.z, st.rotY + 0.3, 'stable');
  }

  private board!: { mesh: THREE.Mesh; body: RAPIER.RigidBody; pos: THREE.Vector3; rot: number; floorY: number; opened: boolean };

  /** Levanta la tabla suelta. `spawnLetter` solo la primera vez (la carta persiste como objeto). */
  openBoard(spawnLetter: boolean): void {
    const b = this.board;
    if (b.opened) return;
    b.opened = true;
    b.mesh.position.y += 0.05;
    b.mesh.rotation.z = 0.5;
    b.mesh.position.addScaledVector(new THREE.Vector3(Math.cos(b.rot), 0, -Math.sin(b.rot)), 0.25);
    this.g.physics.removeBody(b.body);
    if (spawnLetter) {
      this.g.worldItems.spawn('letter_rodrigo', b.pos.x, b.floorY + 0.03, b.pos.z, { uid: 'letter_rodrigo', rotY: b.rot + 0.4 });
    }
  }

  /** Aplica estado dependiente de flags tras cargar partida. */
  applyFlags(): void {
    if (this.g.flags.has('board_opened')) this.openBoard(false);
  }

  // ------------------------------------------------------------ pueblo

  private buildVillageProps(): void {
    const g = this.g;
    // Pozo.
    const wy = this.ground(WELL.x, WELL.z);
    const wellCol = this.placeStatic('well', WELL.x, wy + 0.5, WELL.z, 0, 'well');
    g.interactables.register(wellCol.handle, {
      id: 'well', kind: 'well', pos: new THREE.Vector3(WELL.x, wy + 1, WELL.z),
      label: (game) => game.actions.waterLabel(),
      interact: (game) => game.actions.useWater('pozo'),
    });
    // Puestos de mercado con mercancía (de Lucía).
    MARKET_STALLS.forEach((s, i) => {
      const y = this.ground(s.x, s.z);
      this.placeStatic('stall', s.x, y + 0.45, s.z, s.rot, 'stall');
      const goods = i === 0 ? ['apple', 'apple', 'bread', 'cheese'] : i === 1 ? ['bread', 'apple', 'herbs'] : ['arrow', 'torch', 'waterskin_empty'];
      goods.forEach((item, k) => {
        const off = toWorldXZ(-0.8 + k * 0.5, -0.1, s.rot);
        g.worldItems.spawn(item, s.x + off.x, y + 0.98, s.z + off.z, { uid: `stall${i}_${k}`, authored: true, owner: 'robledo', rotY: s.rot + k, frozen: true });
      });
    });
    // Barriles, cajas y sacos repartidos.
    const rng = new Rng(77);
    const spots: [number, number][] = [[14, -10], [16, -12], [-18, -14], [30, 8], [31, 10], [-26, 10], [-8, 18], [12, 22], [38, -16], [-36, -14], [6, -30]];
    spots.forEach(([x, z], i) => {
      const kind = rng.pick(['barrel', 'crate', 'crate', 'sack']);
      const s = this.g.models.shape(kind);
      const hy = s.type === 'box' ? s.hy : s.type === 'cyl' ? s.hh : s.r;
      this.placeDynamic(`vprop_${i}`, kind, x, this.ground(x, z) + hy + 0.02, z, rng.range(0, 6));
    });
    // Leñeras junto a casas.
    for (const id of ['house_gil', 'house_sancho', 'house_teresa', 'house_pedro']) {
      const b = this.buildings.get(id)!;
      const p = b.localToWorld(b.def.w / 2 + 0.7, 0, -0.5);
      this.placeStatic('woodpile', p.x, this.ground(p.x, p.z) + 0.45, p.z, b.rotY + Math.PI / 2, 'woodpile');
    }
    // Antorchas en postes (plaza) y en fachadas.
    const posts: [number, number][] = [[-6, -4], [8, 6], [-2, -58], [4, -58], [0, 14]];
    posts.forEach(([x, z], i) => {
      const y = this.ground(x, z);
      this.placeStatic('torch_post', x, y + 1.1, z, 0, 'post');
      g.fires.add({ id: `post_${i}`, kind: 'torch', pos: new THREE.Vector3(x, y + 2.35, z), policy: 'night', canCook: false, heat: 6 });
    });
    for (const id of ['tavern', 'church', 'house_mendo']) {
      const b = this.buildings.get(id)!;
      const d = b.doors[0];
      if (!d) continue;
      const p = b.localToWorld(-0.95 + (id === 'church' ? -0.5 : 0) + (d.pivot.position.x), 2.0, b.def.d / 2 + 0.12);
      const torch = g.models.create('wall_torch');
      torch.object.position.copy(p);
      torch.object.rotation.y = b.rotY;
      this.staticObjs.push(torch.object);
      g.fires.add({ id: `walltorch_${id}`, kind: 'torch', pos: p.clone().add(new THREE.Vector3(0, 0.3, 0)).add(new THREE.Vector3(Math.sin(b.rotY), 0, Math.cos(b.rotY)).multiplyScalar(0.1)), policy: 'night', canCook: false, heat: 4 });
    }
  }

  private buildPalisade(): void {
    const g = this.g;
    const P = PALISADE;
    const stakeGeo = new THREE.CylinderGeometry(0.16, 0.18, 4.2, 7);
    stakeGeo.translate(0, 2.1, 0);
    const tip = new THREE.ConeGeometry(0.17, 0.5, 7);
    tip.translate(0, 4.45, 0);
    const stakeMat = g.materials.get('bark');
    const stakes: THREE.Matrix4[] = [];
    const fill: THREE.Matrix4[] = [];
    const step = 0.36;
    const circ = (P.to - P.from) * P.radius;
    const n = Math.floor(circ / step);
    const angDiff = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
    const gateHalf = P.gateWidth / 2 / P.radius, breachHalf = P.breachWidth / 2 / P.radius;
    const rng = new Rng(9);
    let segStart: { x: number; z: number } | null = null;
    let segLast: { x: number; z: number } | null = null;
    const flushSeg = (target: 'main' | 'fill') => {
      if (!segStart || !segLast) return;
      const cx = (segStart.x + segLast.x) / 2, cz = (segStart.z + segLast.z) / 2;
      const len = Math.hypot(segLast.x - segStart.x, segLast.z - segStart.z) + 0.36;
      const rot = Math.atan2(segLast.x - segStart.x, segLast.z - segStart.z);
      const y = this.ground(cx, cz);
      const col = g.physics.world.createCollider(
        RAPIER.ColliderDesc.cuboid(0.2, 2.3, len / 2).setTranslation(cx, y + 2.0, cz)
          .setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot))
          .setCollisionGroups(groups(GROUP.STATIC, ALL)),
      );
      g.physics.tag(col, { kind: 'static', id: 'palisade' });
      if (target === 'fill') this.breachColliders.push(col);
      segStart = null;
    };
    let run = 0;
    let mode: 'main' | 'fill' | 'gap' = 'main';
    for (let i = 0; i <= n; i++) {
      const a = P.from + (i / n) * (P.to - P.from);
      const x = P.center[0] + Math.cos(a) * P.radius, z = P.center[1] + Math.sin(a) * P.radius;
      const inGate = angDiff(a, P.gateAngle) < gateHalf;
      const inBreach = angDiff(a, P.breachAngle) < breachHalf;
      const m: 'main' | 'fill' | 'gap' = inGate ? 'gap' : inBreach ? 'fill' : 'main';
      if (m !== mode) {
        flushSeg(mode === 'fill' ? 'fill' : 'main');
        mode = m;
        run = 0;
      }
      if (m === 'gap') continue;
      const y = this.ground(x, z) - 0.4;
      const mat = new THREE.Matrix4().compose(
        new THREE.Vector3(x, y, z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.range(-0.03, 0.03), rng.range(0, 6), rng.range(-0.03, 0.03))),
        new THREE.Vector3(1, rng.range(0.9, 1.1), 1),
      );
      (m === 'fill' ? fill : stakes).push(mat);
      if (!segStart) segStart = { x, z };
      segLast = { x, z };
      run++;
      if (run >= 16) { flushSeg(m === 'fill' ? 'fill' : 'main'); run = 0; }
    }
    flushSeg(mode === 'fill' ? 'fill' : 'main');
    const mk = (mats: THREE.Matrix4[]) => {
      const grp = new THREE.Group();
      for (const geo of [stakeGeo, tip]) {
        const im = new THREE.InstancedMesh(geo, stakeMat, mats.length);
        mats.forEach((m, i) => im.setMatrixAt(i, m));
        im.castShadow = true;
        im.receiveShadow = true;
        grp.add(im);
      }
      this.group.add(grp);
      return grp;
    };
    mk(stakes);
    this.breachFill = mk(fill);
    // Estacas caídas en la brecha (visibles mientras no se repara).
    const fallen = new THREE.Group();
    const bx = P.center[0] + Math.cos(P.breachAngle) * P.radius, bz = P.center[1] + Math.sin(P.breachAngle) * P.radius;
    for (let i = 0; i < 5; i++) {
      const m = new THREE.Mesh(stakeGeo, stakeMat);
      m.position.set(bx + rng.range(-2.5, 2.5), this.ground(bx, bz) + 0.15, bz + rng.range(-2.5, 2.5));
      m.rotation.set(Math.PI / 2, rng.range(0, 6), 0, 'YXZ');
      fallen.add(m);
    }
    this.group.add(fallen);
    (this.breachFill as THREE.Group & { fallen?: THREE.Group }).fallen = fallen;
    this.setPalisadeRepaired(false);

    // Portón norte (dos hojas con bisagra).
    const ga = P.gateAngle;
    const gx = P.center[0] + Math.cos(ga) * P.radius, gz = P.center[1] + Math.sin(ga) * P.radius;
    const gy = this.ground(gx, gz);
    const tangent = new THREE.Vector3(-Math.sin(ga), 0, Math.cos(ga));
    const rotGate = Math.atan2(tangent.x, tangent.z) - Math.PI / 2;
    const leaves: Gate['leaves'] = [];
    for (const side of [-1, 1]) {
      const pivot = new THREE.Object3D();
      const hinge = new THREE.Vector3(gx, gy, gz).addScaledVector(tangent, side * P.gateWidth / 2);
      pivot.position.copy(hinge);
      pivot.rotation.y = rotGate;
      const leafW = P.gateWidth / 2 - 0.05;
      const leaf = new THREE.Mesh(worldBox(leafW, 3.6, 0.14, 1.5), g.materials.get('darkWood'));
      leaf.position.set(-side * leafW / 2, 1.8, 0);
      leaf.castShadow = true;
      pivot.add(leaf);
      for (const y of [0.6, 2.9]) {
        const band = new THREE.Mesh(worldBox(leafW, 0.12, 0.17, 1), g.materials.get('iron'));
        band.position.set(-side * leafW / 2, y, 0);
        pivot.add(band);
      }
      this.group.add(pivot);
      pivot.updateMatrixWorld(true);
      const body = g.physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(hinge.x, hinge.y, hinge.z).setRotation(pivot.quaternion));
      const col = g.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(leafW / 2, 1.8, 0.08).setTranslation(-side * leafW / 2, 1.8, 0).setCollisionGroups(groups(GROUP.STATIC, ALL)), body);
      g.physics.tag(col, { kind: 'door', id: 'gate_north' });
      g.interactables.register(col.handle, {
        id: `gate_north_${side}`, kind: 'gate', pos: hinge,
        label: () => (this.gate.open ? 'Cerrar el portón' : 'Abrir el portón'),
        interact: (game) => game.actions.toggleGate(),
      });
      leaves.push({ pivot, body, side });
    }
    // angle 0 = cerrado visualmente; al estar "open" se anima hasta abrirse.
    this.gate = { leaves, open: true, angle: 0, pos: new THREE.Vector3(gx, gy, gz) };
    // Postes del portón.
    for (const side of [-1, 1]) {
      const p = new THREE.Vector3(gx, gy, gz).addScaledVector(tangent, side * (P.gateWidth / 2 + 0.25));
      this.placeStatic('torch_post', p.x, gy + 1.1, p.z, 0, 'gatepost');
    }
    // Puestos de defensa.
    this.defensePosts.push(
      { id: 'gate_in_w', x: gx - 2, z: gz + 3 }, { id: 'gate_in_e', x: gx + 2, z: gz + 3 },
      { id: 'breach', x: bx - 3, z: bz + 3 }, { id: 'plaza', x: 0, z: -10 },
    );
  }

  setPalisadeRepaired(v: boolean): void {
    this.palisadeRepaired = v;
    this.breachFill.visible = v;
    const fallen = (this.breachFill as THREE.Group & { fallen?: THREE.Group }).fallen;
    if (fallen) fallen.visible = !v;
    for (const c of this.breachColliders) c.setEnabled(v);
  }

  /** Anima puertas y portón (cada tick). */
  update(dt: number): void {
    for (const b of this.buildings.values()) b.updateDoors(dt);
    const gt = this.gate;
    const target = gt.open ? 1 : 0;
    if (Math.abs(gt.angle - target) > 0.001) {
      gt.angle += Math.sign(target - gt.angle) * Math.min(Math.abs(target - gt.angle), dt * 0.6);
      for (const l of gt.leaves) {
        l.pivot.rotation.y = Math.atan2(Math.sin(this.gateBaseRot()), Math.cos(this.gateBaseRot())) + l.side * -gt.angle * 1.5;
        l.pivot.updateMatrixWorld(true);
        const wp = new THREE.Vector3(), wq = new THREE.Quaternion();
        l.pivot.getWorldPosition(wp);
        l.pivot.getWorldQuaternion(wq);
        l.body.setNextKinematicTranslation(wp);
        l.body.setNextKinematicRotation(wq);
      }
    }
    for (const p of this.dynamicProps) {
      if (p.body.isSleeping()) continue;
      const t = p.body.translation(), r = p.body.rotation();
      p.mesh.position.set(t.x, t.y, t.z);
      p.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }

  private gateBaseRot(): number {
    const ga = PALISADE.gateAngle;
    return Math.atan2(-Math.sin(ga), Math.cos(ga)) - Math.PI / 2;
  }

  /** Ventanas encendidas según ocupación y hora. */
  updateWindows(hour: number): void {
    for (const b of this.buildings.values()) {
      const occ = this.isOccupied(b.def.id);
      let glow = 0;
      const evening = hour >= 18 || hour < 7;
      const late = hour >= 23 || hour < 5;
      if (b.def.id === 'tavern') glow = evening && occ && !(hour >= 1 && hour < 11) ? 1 : 0;
      else if (b.def.id === 'church') glow = hour >= 18 && hour < 22 ? 0.6 : 0.15 * (evening ? 1 : 0);
      else if (b.def.id === 'player_hut') glow = this.g.fires.fires.get('hearth_player')?.lit && evening ? 0.8 : 0;
      else glow = occ && evening && !late ? 1 : 0;
      if (b.burning) glow = 1.6;
      b.windowGlow += (glow - b.windowGlow) * 0.1;
      b.windowMat.emissiveIntensity = b.windowGlow * 2.2;
    }
  }

  // ------------------------------------------------------------ torre

  private buildWatchtower(): void {
    const g = this.g;
    const { x, z, height } = WATCHTOWER;
    const y = this.ground(x, z);
    const H = height;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      this.placeStaticBox(0.3, H + 2.4, 0.3, x + sx * 1.4, y + (H + 2.4) / 2 - 0.3, z + sz * 1.4, 'beam');
    }
    // Plataforma con trampilla (hueco para la escalera).
    this.placeStaticBox(3.4, 0.2, 2.4, x, y + H, z - 0.5, 'planks');
    this.placeStaticBox(2.3, 0.2, 1.0, x - 0.55, y + H, z + 1.2, 'planks');
    // Barandillas.
    for (const s of [-1, 1]) {
      this.placeStaticBox(3.4, 1.0, 0.1, x, y + H + 0.6, z + s * 1.6, 'planks');
      this.placeStaticBox(0.1, 1.0, 3.4, x + s * 1.6, y + H + 0.6, z, 'planks');
    }
    // Tejadillo.
    const roof = new THREE.Mesh(new THREE.ConeGeometry(2.8, 1.6, 4), g.materials.get('thatch'));
    roof.position.set(x, y + H + 2.9, z);
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    this.staticObjs.push(roof);
    // Escalera: interactuable (subir/bajar).
    const lx = x + 1.0, lz = z + 1.55;
    const ladder = g.models.create('ladder');
    ladder.object.position.set(lx, y + H / 2, lz);
    ladder.object.scale.set(1, H / 8, 1);
    ladder.object.rotation.x = -0.08;
    this.staticObjs.push(ladder.object);
    const body = g.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(lx, y + H / 2, lz));
    const col = g.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(0.3, H / 2, 0.06).setCollisionGroups(groups(GROUP.STATIC, ALL)), body);
    this.towerTop.set(lx - 0.4, y + H + 0.12, lz - 0.9);
    this.towerBottom.set(lx, y, lz + 0.8);
    g.interactables.register(col.handle, {
      id: 'tower_ladder', kind: 'ladder', pos: new THREE.Vector3(lx, y + 1, lz), range: 3.5,
      label: (game) => (game.player.pos.y > y + H - 1.5 ? 'Bajar de la torre' : 'Subir a la torre'),
      interact: (game) => game.actions.climbLadder(this.towerBottom, this.towerTop, y + H - 1.5),
    });
    // Brasero en lo alto.
    g.fires.add({ id: 'tower_brazier', kind: 'torch', pos: new THREE.Vector3(x - 1.2, y + H + 1.2, z - 1.2), policy: 'night', canCook: false, heat: 8 });
    this.placeStaticBox(0.4, 0.8, 0.4, x - 1.2, y + H + 0.5, z - 1.2, 'iron');
  }

  placeStaticBox(w: number, h: number, d: number, x: number, y: number, z: number, mat: Parameters<Game['materials']['get']>[0], rotY = 0): void {
    const m = new THREE.Mesh(worldBox(w, h, d, 1.5), this.g.materials.get(mat));
    m.position.set(x, y, z);
    m.rotation.y = rotY;
    m.castShadow = m.receiveShadow = true;
    this.staticObjs.push(m);
    const col = this.g.physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2).setTranslation(x, y, z)
        .setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY))
        .setCollisionGroups(groups(GROUP.STATIC, ALL)),
    );
    this.g.physics.tag(col, { kind: 'static', id: 'box' });
  }

  // ------------------------------------------------------------ campos, puente

  private buildFields(): void {
    const g = this.g;
    for (const f of FIELDS) {
      const crops = g.models.create('crops').object;
      const meshes: THREE.Mesh[] = [];
      crops.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
      const mats: THREE.Matrix4[] = [];
      const rng = new Rng(31);
      for (let lx = -f.w / 2 + 1; lx < f.w / 2 - 1; lx += 1.1) {
        for (let lz = -f.d / 2 + 1; lz < f.d / 2 - 1; lz += 0.7) {
          if (rng.chance(0.08)) continue;
          const w = toWorldXZ(lx + rng.range(-0.2, 0.2), lz, f.rot);
          const x = f.x + w.x, z = f.z + w.z;
          mats.push(new THREE.Matrix4().compose(new THREE.Vector3(x, this.ground(x, z) - 0.05, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng.range(0, 6)), new THREE.Vector3(1, rng.range(0.7, 1.15), 1)));
        }
      }
      for (const m of meshes) {
        const im = new THREE.InstancedMesh(m.geometry, m.material as THREE.Material, mats.length);
        mats.forEach((mm, i) => im.setMatrixAt(i, mm));
        im.receiveShadow = true;
        this.group.add(im);
      }
      // Cerca de postes.
      for (let t = 0; t < 1; t += 0.04) {
        for (const [ax, az, bx, bz] of [[-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1], [-1, 1, -1, -1]]) {
          const lx = (ax + (bx - ax) * t) * (f.w / 2 + 1), lz = (az + (bz - az) * t) * (f.d / 2 + 1);
          const w = toWorldXZ(lx, lz, f.rot);
          const x = f.x + w.x, z = f.z + w.z;
          const post = new THREE.Mesh(worldBox(0.12, 1.1, 0.12, 1), g.materials.get('beam'));
          post.position.set(x, this.ground(x, z) + 0.45, z);
          this.staticObjs.push(post);
        }
      }
    }
  }

  private buildBridges(): void {
    const g = this.g;
    for (const b of BRIDGES) {
      const dir = new THREE.Vector3(Math.sin(b.rot), 0, Math.cos(b.rot));
      const half = b.length / 2;
      const a = new THREE.Vector3(b.x, 0, b.z).addScaledVector(dir, -half);
      const c = new THREE.Vector3(b.x, 0, b.z).addScaledVector(dir, half);
      a.y = this.ground(a.x, a.z);
      c.y = this.ground(c.x, c.z);
      const water = g.hf.waterLevelAt(b.x, b.z) ?? this.ground(b.x, b.z);
      const top = Math.max(water + 0.9, (a.y + c.y) / 2 + 0.25);
      const pts = [a.clone().setY(a.y + 0.02), new THREE.Vector3().lerpVectors(a, c, 0.3).setY(top), new THREE.Vector3().lerpVectors(a, c, 0.7).setY(top), c.clone().setY(c.y + 0.02)];
      for (let i = 0; i < 3; i++) {
        const p0 = pts[i], p1 = pts[i + 1];
        const mid = new THREE.Vector3().lerpVectors(p0, p1, 0.5);
        const len = p0.distanceTo(p1);
        const pitch = Math.atan2(p1.y - p0.y, Math.hypot(p1.x - p0.x, p1.z - p0.z));
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-pitch, b.rot, 0, 'YXZ'));
        const deck = new THREE.Mesh(worldBox(b.width, 0.16, len + 0.1, 1.2), g.materials.get('planks'));
        deck.position.copy(mid).y -= 0.08;
        deck.quaternion.copy(q);
        deck.castShadow = deck.receiveShadow = true;
        this.staticObjs.push(deck);
        const col = g.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(b.width / 2, 0.08, len / 2 + 0.05).setTranslation(mid.x, mid.y - 0.08, mid.z).setRotation(q).setCollisionGroups(groups(GROUP.STATIC, ALL)));
        g.physics.tag(col, { kind: 'static', id: 'bridge' });
        for (const s of [-1, 1]) {
          const rail = new THREE.Mesh(worldBox(0.1, 0.1, len, 1), g.materials.get('beam'));
          const side = new THREE.Vector3(Math.cos(b.rot), 0, -Math.sin(b.rot)).multiplyScalar(s * (b.width / 2 - 0.05));
          rail.position.copy(mid).add(side).y += 0.85;
          rail.quaternion.copy(q);
          this.staticObjs.push(rail);
          for (const p of [p0, p1]) {
            const post = new THREE.Mesh(worldBox(0.12, 1.0, 0.12, 1), g.materials.get('beam'));
            post.position.copy(p).add(side).y += 0.4;
            this.staticObjs.push(post);
          }
        }
      }
      // Pilotes.
      for (const t of [0.3, 0.7]) {
        const p = new THREE.Vector3().lerpVectors(a, c, t);
        for (const s of [-1, 1]) {
          const side = new THREE.Vector3(Math.cos(b.rot), 0, -Math.sin(b.rot)).multiplyScalar(s * (b.width / 2 - 0.2));
          const pile = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 3, 7), g.materials.get('bark'));
          pile.position.copy(p).add(side).setY(top - 1.6);
          this.staticObjs.push(pile);
        }
      }
    }
  }

  // ------------------------------------------------------------ cueva

  private buildCaveContent(): void {
    const g = this.g;
    const cave = this.cave;
    // Rocas en la boca para ocultar la unión con el terreno.
    const mouth = cave.axis[0];
    const rng = new Rng(55);
    const m = CAVE.mouth;
    for (const [dx, dz, s] of [[-3, -4.2, 1.8], [-3, 4.2, 1.9], [-6, -3.8, 2.4], [-6, 3.8, 2.2], [-9, 0, 2.6], [-1, -4.6, 1.2], [-1, 4.6, 1.1], [-12, -3, 2.8], [-12, 3, 2.8], [-15.5, 0, 3.5]] as const) {
      const x = m.x + dx, z = m.z + dz;
      const y = dx <= -8 ? Math.max(this.ground(x, z), mouth.y + 4.2) : this.ground(x, z) + 0.2;
      const b = g.models.create('boulder');
      b.object.position.set(x, y, z);
      b.object.scale.set(s, s * 0.8, s);
      b.object.rotation.set(rng.range(0, 3), rng.range(0, 3), 0);
      this.staticObjs.push(b.object);
      if (dx > -8) {
        const col = g.physics.world.createCollider(RAPIER.ColliderDesc.ball(s * 0.8).setTranslation(x, y, z).setCollisionGroups(groups(GROUP.STATIC, ALL)));
        g.physics.tag(col, { kind: 'static', id: 'boulder' });
      }
    }
    // Estalagmitas y huesos en el interior.
    for (let i = 0; i < 18; i++) {
      const f = 0.15 + rng.next() * 0.8;
      const p = cave.pointAt(f);
      const ang = rng.range(0, Math.PI * 2);
      const off = p.r * rng.range(0.6, 0.85);
      const x = p.x + Math.cos(ang) * off, z = p.z + Math.sin(ang) * off;
      this.placeStatic('stalagmite', x, p.y + 0.7, z, rng.range(0, 6), 'cave');
    }
    // Cadáver de un viajero antiguo, con algo útil.
    const bodyP = cave.pointAt(0.45);
    this.placeStatic('skeleton', bodyP.x + 1.2, bodyP.y + 0.06, bodyP.z + 0.3, 1.2, 'cave');
    g.worldItems.spawn('arrow', bodyP.x + 1.6, bodyP.y + 0.2, bodyP.z + 0.9, { uid: 'cave_arrows', authored: true, count: 6, rotY: 0.4 });
    g.worldItems.spawn('herbs', bodyP.x + 0.6, bodyP.y + 0.15, bodyP.z - 0.3, { uid: 'cave_herbs', authored: true, count: 2 });
    // La cámara: restos de un campamento y el zurrón de Rodrigo en el hueco final.
    const camp = cave.pointAt(0.66);
    this.placeStatic('firering', camp.x, camp.y + 0.1, camp.z, 0, 'cave');
    const end = cave.axis[cave.axis.length - 3];
    g.worldItems.spawn('satchel_rodrigo', end.x, end.y + 0.3, end.z, { uid: 'satchel_rodrigo', authored: true, rotY: 1.1 });
    this.placeStatic('crate', end.x + 0.9, end.y + 0.3, end.z - 0.5, 0.4, 'cave');
    // Guarida de lobos (huesos).
    const wd = WOLF_DEN;
    for (let i = 0; i < 4; i++) {
      const x = wd.x + rng.range(-4, 4), z = wd.z + rng.range(-4, 4);
      const bone = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 5), g.materials.get('paper'));
      bone.position.set(x, this.ground(x, z) + 0.03, z);
      bone.rotation.set(Math.PI / 2, rng.range(0, 6), 0);
      this.staticObjs.push(bone);
    }
  }

  // ------------------------------------------------------------ bandidos

  private buildBanditCamp(): void {
    const g = this.g;
    const c = BANDIT_CAMP;
    const y = this.ground(c.x, c.z);
    this.placeStatic('firering', c.x, y + 0.1, c.z, 0, 'camp');
    g.fires.add({ id: 'bandit_campfire', kind: 'campfire', pos: new THREE.Vector3(c.x, y + 0.2, c.z), policy: 'always', canCook: true, heat: 18 });
    const rng = new Rng(3);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.3;
      const x = c.x + Math.cos(a) * 9, z = c.z + Math.sin(a) * 9;
      this.placeStatic('tent', x, this.ground(x, z) + 1.0, z, -a + Math.PI / 2, 'camp');
      const lx = c.x + Math.cos(a + 0.4) * 3, lz = c.z + Math.sin(a + 0.4) * 3;
      this.placeStatic('bench', lx, this.ground(lx, lz) + 0.22, lz, -a, 'camp');
    }
    for (let i = 0; i < 5; i++) {
      const a = rng.range(0, Math.PI * 2), r = rng.range(4, 14);
      const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
      this.placeDynamic(`camp_prop_${i}`, rng.pick(['crate', 'barrel', 'sack']), x, this.ground(x, z) + 0.5, z, a);
    }
    const rackX = c.x - 5, rackZ = c.z + 3;
    this.placeStatic('weapon_rack', rackX, this.ground(rackX, rackZ) + 0.9, rackZ, 0.6, 'camp');
    g.worldItems.spawn('club', rackX, this.ground(rackX, rackZ) + 1.0, rackZ + 0.1, { uid: 'camp_club', authored: true, frozen: true, rotY: 0.6 });
    const chestX = c.x + 6, chestZ = c.z - 4;
    const chest = this.placeStatic('chest', chestX, this.ground(chestX, chestZ) + 0.3, chestZ, -0.8, 'camp');
    g.containers.create('bandit_chest', 'Botín de Los Cuervos', null, [{ id: 'arrow', count: 12 }, { id: 'bread', count: 2 }, { id: 'wine', count: 2 }, { id: 'torch', count: 2 }], 64);
    g.interactables.register(chest.handle, { id: 'bandit_chest', kind: 'container', pos: new THREE.Vector3(chestX, y, chestZ), label: () => 'Arcón de los bandidos', interact: (game) => game.ui.openContainer('bandit_chest') });
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 1.4 + 2.2;
      const x = c.x + Math.cos(a) * (c.radius - 2), z = c.z + Math.sin(a) * (c.radius - 2);
      const s = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 2.4, 6), g.materials.get('bark'));
      s.position.set(x, this.ground(x, z) + 1, z);
      s.rotation.z = (rng.next() - 0.5) * 0.2;
      this.staticObjs.push(s);
    }
  }

  // ------------------------------------------------------------ puerto

  /** Extremos del embarcadero (mundo). */
  readonly pier = { x0: 0, x1: 0, z: PIER.z, y: 0, w: PIER.width };

  private buildHarbor(): void {
    const g = this.g;
    const hf = g.hf;
    const zp = PIER.z;
    // El embarcadero arranca donde la arena baja hasta cerca del agua.
    let x0 = hf.coastX(zp) - 25;
    while (x0 < hf.coastX(zp) + 20 && hf.heightAt(x0, zp) > SEA.level + 1.0) x0 += 0.5;
    x0 -= 3;
    const len = PIER.length, w = PIER.width;
    const deckY = Math.max(SEA.level + 1.3, hf.heightAt(x0, zp) + 0.12);
    Object.assign(this.pier, { x0, x1: x0 + len, y: deckY });
    const parts: THREE.BufferGeometry[] = [];
    const posts: THREE.BufferGeometry[] = [];
    parts.push(worldBox(len, 0.1, w, 1.2).translate(x0 + len / 2, deckY - 0.05, zp));
    for (const sz of [-1, 1]) parts.push(worldBox(len, 0.18, 0.14, 1).translate(x0 + len / 2, deckY - 0.19, zp + sz * (w / 2 - 0.2)));
    for (let x = x0 + 1; x <= x0 + len; x += 3) {
      for (const sz of [-1, 1]) {
        const bottom = hf.heightAt(x, zp + sz * (w / 2)) - 0.6;
        const h = deckY + 0.35 - bottom;
        posts.push(new THREE.CylinderGeometry(0.13, 0.15, h, 7).translate(x, bottom + h / 2, zp + sz * (w / 2 + 0.05)));
      }
      parts.push(worldBox(0.14, 0.14, w + 0.2, 1).translate(x, deckY - 0.3, zp));
    }
    const norm = (gs: THREE.BufferGeometry[]) => gs.map((q) => { const n = q.index ? q.toNonIndexed() : q; for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(k)) n.deleteAttribute(k); return n; });
    const deck = new THREE.Mesh(mergeGeometries(norm(parts))!, g.materials.get('planks'));
    const piles = new THREE.Mesh(mergeGeometries(norm(posts))!, g.materials.get('roughWood'));
    for (const m of [deck, piles]) { m.castShadow = true; m.receiveShadow = true; this.staticObjs.push(m); }
    const body = g.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x0 + len / 2, deckY - 0.1, zp));
    const col = g.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(len / 2, 0.1, w / 2).setCollisionGroups(groups(GROUP.STATIC, ALL)), body);
    g.physics.tag(col, { kind: 'static', id: 'pier' });
    // Faroles del embarcadero.
    [x0 + 2, x0 + len - 1].forEach((x, i) => {
      const z = zp + w / 2 - 0.1;
      this.placeStatic('torch_post', x, deckY + 1.1, z, 0, 'pier');
      g.fires.add({ id: `pier_${i}`, kind: 'torch', pos: new THREE.Vector3(x, deckY + 2.35, z), policy: 'night', canCook: false, heat: 6 });
    });
    // Nasas y cajas de pescado sobre el muelle.
    this.placeStatic('lobster_pot', x0 + 6, deckY + 0.22, zp - 0.9, 0.4, 'pier');
    this.placeStatic('lobster_pot', x0 + 6.8, deckY + 0.22, zp - 0.6, 1.1, 'pier');
    this.placeStatic('fish_crate', x0 + 9, deckY + 0.15, zp + 0.9, 0.2, 'pier');
    // Playa: redes tendidas, secaderos, cajas y barriles.
    const onGround = (model: string, x: number, z: number, rot: number, dy: number) => this.placeStatic(model, x, this.ground(x, z) + dy, z, rot, 'harbor');
    onGround('net_rack', hf.coastX(-14) - 16, -14, Math.PI / 2, 1.0);
    onGround('net_rack', hf.coastX(40) - 16, 40, Math.PI / 2 + 0.2, 1.0);
    onGround('fish_rack', 79, -14, 0.3, 0.9);
    onGround('fish_rack', 77, 44, -0.2, 0.9);
    onGround('fish_crate', 62, 13, 0.4, 0.15);
    onGround('fish_crate', 63, 14.2, 1.3, 0.15);
    onGround('barrel', 64, 3.5, 0, 0.45);
    // Barca varada en la arena, boca abajo (reparación).
    const bx = hf.coastX(-2) - 10;
    const hull = g.models.create('rowboat').object;
    hull.position.set(bx, this.ground(bx, -2) + 0.62, -2);
    hull.rotation.set(Math.PI, 0.6, 0);
    this.staticObjs.push(hull);
  }

  // ------------------------------------------------------------ islas

  /** Punto de una isla, en la ladera que mira al pueblo, a la altura dada. */
  private islandSpot(isl: { x: number; z: number; r: number }, minH: number, angle: number): { x: number; z: number; y: number } {
    let best = { x: isl.x, z: isl.z, y: this.ground(isl.x, isl.z) };
    for (let r = 0; r < isl.r; r += 1) {
      const x = isl.x + Math.cos(angle) * r, z = isl.z + Math.sin(angle) * r;
      const y = this.ground(x, z);
      if (y < minH) break;
      best = { x, z, y };
    }
    return best;
  }

  private buildIslands(): void {
    const g = this.g;
    const [gav, pen, nau] = SEA.islands;
    const L = SEA.level;
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, ry: number, mat: 'stoneWall' | 'roughWood' | 'planks', collide = true) => {
      const m = new THREE.Mesh(worldBox(w, h, d, 2), g.materials.get(mat));
      m.position.set(x, y, z);
      m.rotation.y = ry;
      m.castShadow = m.receiveShadow = true;
      this.staticObjs.push(m);
      if (collide) {
        const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry);
        const body = g.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z).setRotation(q));
        const col = g.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2).setCollisionGroups(groups(GROUP.STATIC, ALL)), body);
        g.physics.tag(col, { kind: 'static', id: 'ruin' });
        return col;
      }
      return null;
    };
    const rng = new Rng(909);
    // ---- Ermita en ruinas (Isla de las Gaviotas), en la ladera oeste.
    {
      const s = this.islandSpot(gav, L + 5, Math.PI);
      const ry = 0.2;
      const W = 6, D = 9;
      const loc = (lx: number, lz: number) => { const w = toWorldXZ(lx, lz, ry); return { x: s.x + w.x, z: s.z + w.z }; };
      const base = s.y - 0.2;
      // Muros desmochados: tramos de altura irregular.
      const seg = (lx0: number, lz0: number, lx1: number, lz1: number) => {
        const n = Math.round(Math.hypot(lx1 - lx0, lz1 - lz0) / 1.5);
        for (let i = 0; i < n; i++) {
          if (rng.next() < 0.18) continue; // hueco derrumbado
          const t = (i + 0.5) / n;
          const p = loc(lx0 + (lx1 - lx0) * t, lz0 + (lz1 - lz0) * t);
          const h = rng.range(0.8, 3.6);
          const along = Math.abs(lx1 - lx0) > Math.abs(lz1 - lz0);
          box(along ? 1.52 : 0.6, h, along ? 0.6 : 1.52, p.x, base + h / 2, p.z, ry, 'stoneWall');
        }
      };
      seg(-W / 2, -D / 2, W / 2, -D / 2); seg(-W / 2, D / 2, -0.8, D / 2); seg(0.8, D / 2, W / 2, D / 2);
      seg(-W / 2, -D / 2, -W / 2, D / 2); seg(W / 2, -D / 2, W / 2, D / 2);
      for (let i = 0; i < 6; i++) { const p = loc(rng.range(-W, W), rng.range(-D, D)); box(0.6, 0.45, 0.7, p.x, this.ground(p.x, p.z) + 0.2, p.z, rng.range(0, 3), 'stoneWall', false); }
      const alt = loc(0, -D / 2 + 1.2);
      const altCol = box(1.6, 1.0, 0.8, alt.x, base + 0.5, alt.z, ry, 'stoneWall')!;
      g.interactables.register(altCol.handle, {
        id: 'chapel_slab', kind: 'read', pos: new THREE.Vector3(alt.x, base + 1, alt.z),
        label: () => 'Examinar la losa del altar',
        interact: (game) => { game.flags.set('found_chapel'); game.actions.read('chapel_slab'); },
      });
      const ch = loc(2, -D / 2 + 1.2);
      const chest = this.placeStatic('chest', ch.x, base + 0.3, ch.z, ry, 'isle');
      g.containers.create('chapel_chest', 'Arca de la ermita', null, [{ id: 'candle_item', count: 0 }, { id: 'herbs', count: 3 }, { id: 'silver_coin', count: 1 }].filter((x) => x.count > 0), 12);
      g.interactables.register(chest.handle, { id: 'chapel_chest', kind: 'container', pos: new THREE.Vector3(ch.x, base + 0.5, ch.z), label: () => 'Abrir el arca', interact: (game) => game.ui.openContainer('chapel_chest') });
      const c = loc(0, 1);
      this.places.set('chapel_isle', { id: 'chapel_isle', x: c.x, y: base, z: c.z, yaw: 0 });
    }
    // ---- Restos de la coca (Islote del Náufrago).
    {
      const s = this.islandSpot(nau, L + 0.6, Math.PI * 0.8);
      const hull = g.models.create('rowboat').object;
      hull.scale.set(3.2, 2.6, 2.8);
      hull.position.set(s.x, s.y - 0.4, s.z);
      hull.rotation.set(0.35, 1.1, 0.25);
      this.staticObjs.push(hull);
      const hq = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 1.1 - Math.PI / 2, 0));
      const hb = g.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(s.x, s.y + 0.4, s.z).setRotation(hq));
      g.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(1.8, 0.9, 6).setCollisionGroups(groups(GROUP.STATIC, ALL)), hb);
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 7, 8), g.materials.get('roughWood'));
      mast.position.set(s.x + 3, s.y + 1.2, s.z - 2);
      mast.rotation.set(1.2, 0, 0.4);
      mast.castShadow = true;
      this.staticObjs.push(mast);
      for (let i = 0; i < 5; i++) {
        const x = s.x + rng.range(-6, 6), z = s.z + rng.range(-6, 6);
        const k = rng.pick(['crate', 'barrel']);
        this.placeStatic(k, x, this.ground(x, z) + (k === 'crate' ? 0.3 : 0.45), z, rng.range(0, 6), 'wreck');
      }
      const cx = s.x - 2.5, cz = s.z + 2;
      const chest = this.placeStatic('chest', cx, this.ground(cx, cz) + 0.3, cz, 0.7, 'wreck');
      g.containers.create('wreck_chest', 'Caja del maestre', null, [{ id: 'silver_coin', count: 3 }, { id: 'wine', count: 2 }, { id: 'rope_item', count: 0 }].filter((x) => x.count > 0), 35);
      g.interactables.register(chest.handle, {
        id: 'wreck_chest', kind: 'container', pos: new THREE.Vector3(cx, this.ground(cx, cz) + 0.5, cz), label: () => 'Registrar la caja del maestre',
        interact: (game) => { game.flags.set('found_wreck'); if (!game.flags.has('read_wreck_log')) { game.flags.set('read_wreck_log'); game.actions.read('wreck_log'); } else game.ui.openContainer('wreck_chest'); },
      });
      this.places.set('wreck_isle', { id: 'wreck_isle', x: cx, y: this.ground(cx, cz), z: cz, yaw: 0 });
    }
    // ---- Cueva del Peñón: un abrigo entre peñascos en la cara oeste.
    {
      const s = this.islandSpot(pen, L + 2.5, Math.PI * 1.05);
      const ang = Math.PI * 1.05;
      const ry = -ang + Math.PI / 2;
      const loc = (lx: number, lz: number) => { const w = toWorldXZ(lx, lz, ry); return { x: s.x + w.x, z: s.z + w.z }; };
      const base = s.y;
      // Arco de roca y paredes del abrigo.
      for (const [lx, lz, w, h, d] of [[-2.2, 0, 1.4, 3.6, 5], [2.2, 0, 1.4, 3.6, 5], [0, -2.4, 5.8, 3.6, 1.2], [0, 0.2, 5.8, 1.2, 5.6]] as const) {
        const p = loc(lx, lz);
        const y = lz === 0.2 ? base + 3.6 : base + h / 2 - 0.3;
        const m = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 1), g.materials.get('rock'));
        m.scale.set(w / 1.6, h / 1.6, d / 1.6);
        m.position.set(p.x, y, p.z);
        m.rotation.y = ry;
        m.castShadow = m.receiveShadow = true;
        this.staticObjs.push(m);
        const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry);
        const body = g.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(p.x, y, p.z).setRotation(q));
        g.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(w * 0.42, h * 0.45, d * 0.42).setCollisionGroups(groups(GROUP.STATIC, ALL)), body);
      }
      const cpos = loc(0, -1.2);
      const chest = this.placeStatic('chest', cpos.x, this.ground(cpos.x, cpos.z) + 0.3, cpos.z, ry, 'penon');
      g.containers.create('penon_chest', 'Cofre envuelto en hule', null, [{ id: 'olmedo_key', count: 1 }, { id: 'silver_coin', count: 2 }], 0);
      g.interactables.register(chest.handle, {
        id: 'penon_chest', kind: 'container', pos: new THREE.Vector3(cpos.x, base + 0.5, cpos.z), label: () => 'Abrir el cofre envuelto en hule',
        interact: (game) => { game.flags.set('found_penon'); if (!game.flags.has('read_penon_note')) { game.flags.set('read_penon_note'); game.actions.read('penon_note'); } else game.ui.openContainer('penon_chest'); },
      });
      const torch = loc(1.4, -1.8);
      g.fires.add({ id: 'penon_candle', kind: 'candle', pos: new THREE.Vector3(torch.x, base + 0.9, torch.z), policy: 'night', canCook: false, heat: 0 });
      this.places.set('penon_cave', { id: 'penon_cave', x: cpos.x, y: base, z: cpos.z, yaw: 0 });
    }
  }

  // ------------------------------------------------------------ parcela del jugador

  private buildPlotStart(): void {
    const g = this.g;
    const half = PLAYER_PLOT.size / 2;
    const cx = PLAYER_PLOT.x - half - 1.3, cz = PLAYER_PLOT.z - half + 2;
    const chest = this.placeStatic('chest', cx, this.ground(cx, cz) + 0.3, cz, Math.PI / 2, 'plot');
    g.containers.create('plot_chest', 'Arcón de la parcela', null, [
      { id: 'pickaxe', count: 1 }, { id: 'plank', count: 10 }, { id: 'thatch', count: 4 },
    ], 0);
    g.interactables.register(chest.handle, {
      id: 'plot_chest', kind: 'container', pos: new THREE.Vector3(cx, this.ground(cx, cz) + 0.5, cz),
      label: () => 'Arcón de la parcela (los materiales de aquí cuentan para construir)',
      interact: (game) => game.ui.openContainer('plot_chest'),
    });
    // Caballete y leñera junto al arcón.
    const wx = cx, wz = cz + 3;
    this.placeStatic('woodpile', wx, this.ground(wx, wz) + 0.45, wz, Math.PI / 2, 'plot');
  }

  // ------------------------------------------------------------ lugares (IA)

  private buildPlaces(): void {
    const add = (id: string, x: number, z: number, yaw = 0, anim?: Place['anim'], building?: string, y?: number) => {
      this.places.set(id, { id, x, y: y ?? this.ground(x, z), z, yaw, anim, building });
    };
    // Casas: punto de entrada = puerta exterior.
    for (const b of this.buildings.values()) {
      const d = b.doors[0];
      const p = d ? d.outside : b.localToWorld(0, 0, b.def.d / 2 + 1.2);
      add(`door:${b.def.id}`, p.x, p.z, b.rotY + Math.PI, undefined, undefined);
      if (d) add(`in:${b.def.id}`, d.inside.x, d.inside.z, b.rotY + Math.PI, undefined, b.def.id, b.floorY);
    }
    const inB = (bid: string, lx: number, lz: number, yawOff: number, anim: Place['anim'], id: string) => {
      const b = this.buildings.get(bid)!;
      const p = b.localToWorld(lx, 0, lz);
      add(id, p.x, p.z, b.rotY + yawOff, anim, b.def.enterable ? bid : undefined, b.floorY);
    };
    inB('smithy', 0.6, 0.6, Math.PI, 'hammer', 'smithy_anvil');
    inB('tavern', 2.2, -3.2, 0, 'sell', 'tavern_counter');
    inB('tavern', -2.8, 0.1, 0, 'drink', 'tavern_table');
    inB('tavern', 0.2, 1.65, Math.PI, 'drink', 'tavern_table2');
    inB('church', 0, -5.6, Math.PI, 'pray', 'church_altar');
    inB('carpentry', -1.2, -0.8, Math.PI, 'work', 'carpentry_bench');
    inB('stable', 0, 0.5, Math.PI, 'work', 'stable_work');
    const s0 = MARKET_STALLS[0];
    const so = toWorldXZ(0, 1.3, s0.rot);
    add('market_stall', s0.x + so.x, s0.z + so.z, s0.rot + Math.PI, 'sell');
    add('plaza', 0, -2, 0);
    add('plaza_bench', -4, 6, 1);
    add('well', WELL.x + 1.6, WELL.z + 0.5, -1.5);
    const f = FIELDS[0];
    for (let i = 0; i < 3; i++) {
      const w = toWorldXZ(-15 + i * 15, -5 + i * 6, f.rot);
      add(`field_${i}`, f.x + w.x, f.z + w.z, i, 'farm');
    }
    const ga = PALISADE.gateAngle;
    const gx = Math.cos(ga) * PALISADE.radius, gz = Math.sin(ga) * PALISADE.radius;
    add('gate_n', gx + 3, gz + 3, Math.PI, 'guard');
    add('gate_n_out', gx, gz - 4, Math.PI, 'guard');
    add('tower_top', this.towerTop.x, this.towerTop.z, Math.PI, 'guard', undefined, this.towerTop.y);
    add('tower_base', this.towerBottom.x, this.towerBottom.z, 0, 'guard');
    add('forest_edge', -80, 14, -Math.PI / 2, 'chop');
    add('patrol_1', -30, -30, 0);
    add('patrol_2', 30, -30, 0);
    add('patrol_3', 40, 20, 0);
    add('patrol_4', -35, 25, 0);
    add('woodpile_zone', this.woodDropZone.x + 1.5, this.woodDropZone.z + 1.5, 0, 'work');
    add('bandit_camp', BANDIT_CAMP.x, BANDIT_CAMP.z + 3, 0, 'sit');
    // Puerto y ampliación del pueblo.
    const pr = this.pier;
    add('pier_mid', (pr.x0 + pr.x1) / 2, pr.z + 0.6, Math.PI / 2, 'work', undefined, pr.y);
    add('pier_end', pr.x1 - 1.5, pr.z - 0.6, Math.PI / 2, 'fish', undefined, pr.y);
    add('pier_end2', pr.x1 - 3.5, pr.z + 0.8, Math.PI / 2, 'fish', undefined, pr.y);
    add('pier_start', pr.x0 - 3, pr.z, Math.PI / 2);
    add('beach_nets', this.g.hf.coastX(-14) - 16, -12.4, 0, 'work');
    add('beach_nets2', this.g.hf.coastX(40) - 16, 41.6, Math.PI, 'work');
    add('fish_rack_work', 79, -12.8, Math.PI, 'work');
    inB('boat_shed', 0, 0.5, Math.PI, 'hammer', 'boat_shed_work');
    inB('bakery', 0, -1.2, Math.PI, 'work', 'bakery_oven');
    add('salt_work', this.buildings.get('salt_store')!.doors[0]?.outside.x ?? 60, this.buildings.get('salt_store')!.doors[0]?.outside.z ?? 10, 0, 'work');
    add('field_3', FIELDS[0].x + 12, FIELDS[0].z + 10, 2, 'farm');
    add('south_lane', -10, 64, 0);
    add('harbor_lane', 70, 12, 0);
  }

  // ------------------------------------------------------------ persistencia

  serialize(): object {
    const doors: Record<string, boolean> = {};
    for (const d of this.doors.values()) doors[d.id] = d.open;
    const health: Record<string, number> = {};
    for (const b of this.buildings.values()) health[b.def.id] = b.health;
    const props = this.dynamicProps.map((p) => {
      const t = p.body.translation(), r = p.body.rotation();
      return { id: p.id, p: [t.x, t.y, t.z], q: [r.x, r.y, r.z, r.w] };
    });
    return { doors, health, gateOpen: this.gate.open, repaired: this.palisadeRepaired, props };
  }

  deserialize(d: { doors: Record<string, boolean>; health: Record<string, number>; gateOpen: boolean; repaired: boolean; props: { id: string; p: number[]; q: number[] }[] }): void {
    for (const [id, open] of Object.entries(d.doors)) {
      const door = this.doors.get(id);
      if (door) door.open = open;
    }
    for (const [id, h] of Object.entries(d.health)) this.buildings.get(id)?.setHealth(h);
    this.gate.open = d.gateOpen;
    this.gate.angle = d.gateOpen ? 0.99 : 0.01;
    this.setPalisadeRepaired(d.repaired);
    for (const pr of d.props ?? []) {
      const p = this.dynamicProps.find((x) => x.id === pr.id);
      if (!p) continue;
      p.body.setTranslation({ x: pr.p[0], y: pr.p[1], z: pr.p[2] }, true);
      p.body.setRotation({ x: pr.q[0], y: pr.q[1], z: pr.q[2], w: pr.q[3] }, true);
      p.body.sleep();
      p.mesh.position.set(pr.p[0], pr.p[1], pr.p[2]);
      p.mesh.quaternion.set(pr.q[0], pr.q[1], pr.q[2], pr.q[3]);
    }
  }
}
