/**
 * Acciones del jugador invocadas por interactuables e inventario:
 * puertas, portón, dormir, agua, fuego/cocina, escaleras, comer, soltar.
 */
import * as THREE from 'three';
import type { Game } from '../game/Game';
import type { Door } from '../world/Buildings';
import { itemDef } from '../data/items';
import { DOCUMENTS } from '../data/documents';

export class Actions {
  constructor(private readonly g: Game) {}

  toggleDoor(d: Door): void {
    if (d.locked) {
      this.g.bus.emit('notify', { text: 'Está cerrada con llave.', kind: 'info' });
      this.g.bus.emit('sfx', { id: 'door_locked', x: d.worldPos.x, y: d.worldPos.y, z: d.worldPos.z });
      return;
    }
    d.open = !d.open;
    this.g.bus.emit('sfx', { id: d.open ? 'door_open' : 'door_close', x: d.worldPos.x, y: d.worldPos.y, z: d.worldPos.z });
  }

  toggleGate(): void {
    const s = this.g.settlement;
    s.gate.open = !s.gate.open;
    this.g.bus.emit('sfx', { id: 'gate', x: s.gate.pos.x, y: s.gate.pos.y, z: s.gate.pos.z });
    this.g.bus.emit('notify', { text: s.gate.open ? 'Abres el portón.' : 'Cierras el portón y echas la tranca.', kind: 'info' });
  }

  /** Abre el diálogo de descanso. */
  sleep(): void {
    this.g.ui.openSleep();
  }

  /** Duerme/espera `hours`. Devuelve false si hay peligro cerca. */
  rest(hours: number, sleeping: boolean): boolean {
    const g = this.g;
    if (g.combatDanger()) {
      g.bus.emit('notify', { text: 'No puedes descansar con enemigos cerca.', kind: 'warning' });
      return false;
    }
    if (g.raids?.active) {
      g.bus.emit('notify', { text: '¡Hay un ataque en curso!', kind: 'warning' });
      return false;
    }
    g.time.advanceHours(hours);
    g.vitals.timeSkip(hours, sleeping);
    g.npcs?.onTimeSkip();
    g.animals?.onTimeSkip();
    g.bus.emit('player:slept', { hours });
    g.bus.emit('notify', { text: sleeping ? `Duermes. Despiertas: ${g.time.periodName().toLowerCase()}, día ${g.time.day}.` : `Descansas ${hours} h.`, kind: 'info' });
    if (sleeping) g.save.save('auto');
    return true;
  }

  /** Horas hasta el alba (06:30). */
  hoursUntilDawn(): number {
    const h = this.g.time.hourFloat;
    const target = 6.5;
    let d = target - h;
    if (d <= 0) d += 24;
    return Math.round(d * 10) / 10;
  }

  waterLabel(): string {
    const inv = this.g.inventory;
    if (inv.has('bucket')) return 'Pozo · Beber / llenar cubo';
    if (inv.has('waterskin_empty')) return 'Pozo · Beber / llenar odre';
    return 'Pozo · Beber';
  }

  useWater(source: string): void {
    const g = this.g;
    const inv = g.inventory;
    if (inv.has('bucket')) {
      inv.remove('bucket'); inv.add('bucket_water');
      g.equipment.validate();
      g.bus.emit('notify', { text: 'Llenas el cubo de agua.', kind: 'item' });
      g.bus.emit('sfx', { id: 'water_fill' });
      return;
    }
    if (inv.has('waterskin_empty')) {
      inv.remove('waterskin_empty'); inv.add('waterskin');
      g.bus.emit('notify', { text: 'Llenas el odre.', kind: 'item' });
      g.bus.emit('sfx', { id: 'water_fill' });
      return;
    }
    g.vitals.eat(0, 30);
    g.bus.emit('sfx', { id: 'drink' });
    g.bus.emit('notify', { text: source === 'pozo' ? 'Bebes agua fresca del pozo.' : 'Bebes del arroyo.', kind: 'info' });
  }

  hearthLabel(fireId: string): string {
    const f = this.g.fires.fires.get(fireId);
    if (!f) return '';
    const inv = this.g.inventory;
    if (!f.lit) return inv.has('firewood') ? 'Hogar · Encender (1 leña)' : 'Hogar apagado · Necesitas leña';
    if (inv.has('meat_raw')) return 'Hogar · Asar carne';
    if (inv.has('firewood') && f.fuel < 6) return `Hogar · Añadir leña (${f.fuel.toFixed(1)} h)`;
    return `Hogar encendido (${f.fuel.toFixed(1)} h)`;
  }

  useFire(fireId: string): void {
    const g = this.g;
    const f = g.fires.fires.get(fireId);
    if (!f) return;
    const inv = g.inventory;
    if (!f.lit) {
      if (!inv.has('firewood')) {
        g.bus.emit('notify', { text: 'Necesitas leña para encender el fuego.', kind: 'warning' });
        return;
      }
      inv.remove('firewood');
      f.fuel = 4;
      g.fires.setLit(fireId, true);
      g.bus.emit('sfx', { id: 'fire_light', x: f.pos.x, y: f.pos.y, z: f.pos.z });
      g.bus.emit('notify', { text: 'Enciendes el fuego.', kind: 'info' });
      return;
    }
    if (inv.has('meat_raw')) {
      this.cookAll();
      return;
    }
    if (inv.has('firewood') && f.fuel < 6) {
      inv.remove('firewood');
      f.fuel += 4;
      g.bus.emit('notify', { text: 'Añades leña al fuego.', kind: 'info' });
    }
  }

  /** Asa toda la carne cruda (lleva tiempo de juego). */
  cookAll(): void {
    const g = this.g;
    const n = g.inventory.count('meat_raw');
    if (n <= 0) return;
    const fire = g.fires.nearestCookFire(g.player.pos, 3);
    if (!fire) {
      g.bus.emit('notify', { text: 'Necesitas un fuego encendido cerca.', kind: 'warning' });
      return;
    }
    g.inventory.remove('meat_raw', n);
    g.inventory.add('meat_cooked', n);
    g.time.advanceHours(0.25 * Math.min(4, n));
    g.bus.emit('sfx', { id: 'sizzle' });
    g.bus.emit('item:acquired', { itemId: 'meat_cooked', count: n, source: 'craft' });
    g.bus.emit('notify', { text: `Asas ${n} ${n > 1 ? 'piezas' : 'pieza'} de carne.`, kind: 'item' });
  }

  /** Subir/bajar escalera con una breve transición. */
  climbLadder(bottom: THREE.Vector3, top: THREE.Vector3, topThreshold: number): void {
    const g = this.g;
    const goingUp = g.player.pos.y < topThreshold;
    const dest = goingUp ? top : bottom;
    g.interaction.drop(false);
    g.ui.fade(0.35, () => {
      g.player.teleport(dest.x, dest.y + 0.05, dest.z);
    });
    g.bus.emit('sfx', { id: 'ladder' });
  }

  /** Usar un objeto del inventario (comer, beber, leer, equipar). */
  useItem(id: string): void {
    const g = this.g;
    const d = itemDef(id);
    if (!g.inventory.has(id)) return;
    if (d.doc) {
      this.read(d.doc);
      return;
    }
    if (d.food) {
      if (d.id === 'waterskin') {
        g.inventory.remove('waterskin');
        g.inventory.add('waterskin_empty');
      } else if (d.id !== 'waterskin_empty') {
        g.inventory.remove(id);
      }
      g.vitals.eat(d.food.hunger, d.food.thirst, d.food.warmth ?? 0);
      if (d.food.health) {
        if (d.food.health > 0) {
          g.vitals.heal(d.food.health);
          g.vitals.bleeding = 0;
        } else g.vitals.hurt(-d.food.health);
      }
      g.bus.emit('item:removed', { itemId: id, count: 1, reason: 'consume' });
      g.bus.emit('sfx', { id: d.category === 'drink' ? 'drink' : 'eat' });
      g.equipment.validate();
      return;
    }
    if (d.weapon || d.offhand || d.armor || d.handTool) {
      g.equipment.equip(id);
      g.bus.emit('sfx', { id: 'equip' });
      return;
    }
    if (id === 'satchel_rodrigo') {
      g.story?.openSatchel();
      return;
    }
  }

  read(docId: string): void {
    const doc = DOCUMENTS[docId];
    if (!doc) return;
    this.g.ui.openDocument(doc);
    this.g.bus.emit('doc:read', { docId });
    this.g.bus.emit('sfx', { id: 'paper' });
  }

  /** Suelta un objeto del inventario como objeto físico delante del jugador. */
  dropItem(id: string, count = 1): void {
    const g = this.g;
    const n = g.inventory.remove(id, count);
    if (n <= 0) return;
    g.equipment.validate();
    const f = g.player.forward(new THREE.Vector3());
    const e = g.player.eyePosition(1, new THREE.Vector3());
    const p = e.addScaledVector(f.setY(Math.max(-0.2, f.y)), 0.8);
    g.worldItems.spawn(id, p.x, p.y - 0.2, p.z, { count: n, rotY: g.player.yaw, velocity: new THREE.Vector3(f.x * 1.5, 0.5, f.z * 1.5) });
    g.bus.emit('item:removed', { itemId: id, count: n, reason: 'drop' });
  }
}
