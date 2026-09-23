/**
 * Navegación por grafo de visibilidad (sin navmesh; ver RIESGOS R5).
 * Nodos: lugares, esquinas infladas de edificios, portón, brecha y
 * puntos de caminos. Aristas: segmentos libres de obstáculos.
 * Lógica pura: los obstáculos se pasan como datos.
 */
import { segmentIntersectsOBB, segmentsIntersect, toWorldXZ } from '../core/math';

export interface OBB { x: number; z: number; hw: number; hd: number; rot: number }
export interface Wall { ax: number; az: number; bx: number; bz: number; /** Se puede desactivar (brecha reparada, portón). */ id?: string }

export interface NavNode { id: number; x: number; z: number; name?: string; edges: { to: number; cost: number; crosses?: string[] }[] }

export class NavGraph {
  readonly nodes: NavNode[] = [];
  private disabledWalls = new Set<string>();

  constructor(private readonly obbs: OBB[], private readonly walls: Wall[]) {}

  addNode(x: number, z: number, name?: string): number {
    const id = this.nodes.length;
    this.nodes.push({ id, x, z, name, edges: [] });
    return id;
  }

  /** Nodos en las esquinas infladas de cada obstáculo rectangular. */
  addObstacleCorners(inflate: number): void {
    for (const o of this.obbs) {
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const w = toWorldXZ(sx * (o.hw + inflate), sz * (o.hd + inflate), o.rot);
        const x = o.x + w.x, z = o.z + w.z;
        if (!this.insideObstacle(x, z)) this.addNode(x, z);
      }
    }
  }

  insideObstacle(x: number, z: number, margin = 0): boolean {
    for (const o of this.obbs) {
      const c = Math.cos(o.rot), s = Math.sin(o.rot);
      const dx = x - o.x, dz = z - o.z;
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      if (Math.abs(lx) < o.hw + margin && Math.abs(lz) < o.hd + margin) return true;
    }
    return false;
  }

  setWallEnabled(id: string, enabled: boolean): void {
    if (enabled) this.disabledWalls.delete(id);
    else this.disabledWalls.add(id);
  }

  /** ¿Segmento libre de obstáculos? */
  clear(ax: number, az: number, bx: number, bz: number): boolean {
    for (const o of this.obbs) if (segmentIntersectsOBB(ax, az, bx, bz, o.x, o.z, o.hw, o.hd, o.rot)) return false;
    for (const w of this.walls) {
      if (w.id && this.disabledWalls.has(w.id)) continue;
      if (segmentsIntersect(ax, az, bx, bz, w.ax, w.az, w.bx, w.bz)) return false;
    }
    return true;
  }

  /** Solo obstáculos fijos (sin muros dinámicos). */
  private clearStatic(ax: number, az: number, bx: number, bz: number): boolean {
    for (const o of this.obbs) if (segmentIntersectsOBB(ax, az, bx, bz, o.x, o.z, o.hw, o.hd, o.rot)) return false;
    for (const w of this.walls) {
      if (w.id) continue;
      if (segmentsIntersect(ax, az, bx, bz, w.ax, w.az, w.bx, w.bz)) return false;
    }
    return true;
  }

  build(maxEdge = 80): void {
    const n = this.nodes.length;
    for (const node of this.nodes) node.edges.length = 0;
    const dyn = this.walls.filter((w) => w.id);
    for (let i = 0; i < n; i++) {
      const a = this.nodes[i];
      for (let j = i + 1; j < n; j++) {
        const b = this.nodes[j];
        const d = Math.hypot(a.x - b.x, a.z - b.z);
        if (d > maxEdge || d < 0.01) continue;
        if (!this.clearStatic(a.x, a.z, b.x, b.z)) continue;
        // Muros dinámicos que cruza esta arista (se evalúan al buscar).
        const crosses = dyn.filter((w) => segmentsIntersect(a.x, a.z, b.x, b.z, w.ax, w.az, w.bx, w.bz)).map((w) => w.id!);
        const e = crosses.length ? { cost: d, crosses: [...new Set(crosses)] } : { cost: d };
        a.edges.push({ to: j, ...e });
        b.edges.push({ to: i, ...e });
      }
    }
  }

  private edgeOpen(e: { crosses?: string[] }): boolean {
    if (!e.crosses) return true;
    for (const id of e.crosses) if (!this.disabledWalls.has(id)) return false;
    return true;
  }

  private visibleNodes(x: number, z: number, k: number): number[] {
    const cands = this.nodes
      .map((n) => ({ id: n.id, d: Math.hypot(n.x - x, n.z - z) }))
      .sort((a, b) => a.d - b.d);
    const out: number[] = [];
    for (const c of cands) {
      if (c.d > 150) break;
      const n = this.nodes[c.id];
      if (this.clear(x, z, n.x, n.z)) out.push(c.id);
      if (out.length >= k) break;
    }
    return out;
  }

  /**
   * Camino de A a B como lista de puntos (sin incluir A). Si no hay camino,
   * devuelve [B] (el agente irá en línea recta y el steering evitará).
   */
  findPath(ax: number, az: number, bx: number, bz: number): { x: number; z: number }[] {
    if (this.clear(ax, az, bx, bz)) return [{ x: bx, z: bz }];
    const starts = this.visibleNodes(ax, az, 6);
    const ends = new Set(this.visibleNodes(bx, bz, 6));
    if (!starts.length || !ends.size) return [{ x: bx, z: bz }];
    const N = this.nodes.length;
    const g = new Float64Array(N).fill(Infinity);
    const f = new Float64Array(N).fill(Infinity);
    const prev = new Int32Array(N).fill(-1);
    const open = new Set<number>();
    const h = (i: number) => Math.hypot(this.nodes[i].x - bx, this.nodes[i].z - bz);
    for (const s of starts) {
      g[s] = Math.hypot(this.nodes[s].x - ax, this.nodes[s].z - az);
      f[s] = g[s] + h(s);
      open.add(s);
    }
    let found = -1;
    let guard = 0;
    while (open.size && guard++ < 5000) {
      let cur = -1, best = Infinity;
      for (const i of open) if (f[i] < best) { best = f[i]; cur = i; }
      if (ends.has(cur)) { found = cur; break; }
      open.delete(cur);
      for (const e of this.nodes[cur].edges) {
        if (!this.edgeOpen(e)) continue;
        const ng = g[cur] + e.cost;
        if (ng < g[e.to]) {
          g[e.to] = ng;
          f[e.to] = ng + h(e.to);
          prev[e.to] = cur;
          open.add(e.to);
        }
      }
    }
    if (found < 0) return [{ x: bx, z: bz }];
    const path: { x: number; z: number }[] = [{ x: bx, z: bz }];
    for (let c = found; c >= 0; c = prev[c]) path.push({ x: this.nodes[c].x, z: this.nodes[c].z });
    path.reverse();
    return this.smooth(ax, az, path);
  }

  /** Quita puntos intermedios innecesarios (string pulling simple). */
  private smooth(ax: number, az: number, path: { x: number; z: number }[]): { x: number; z: number }[] {
    const out: { x: number; z: number }[] = [];
    let cx = ax, cz = az;
    let i = 0;
    while (i < path.length) {
      let j = path.length - 1;
      while (j > i && !this.clear(cx, cz, path[j].x, path[j].z)) j--;
      out.push(path[j]);
      cx = path[j].x; cz = path[j].z;
      i = j + 1;
    }
    return out;
  }
}
