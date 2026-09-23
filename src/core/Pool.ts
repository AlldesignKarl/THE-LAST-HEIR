/** Pool genérico de objetos para evitar asignaciones en caliente. */
export class Pool<T> {
  private free: T[] = [];
  readonly active = new Set<T>();

  constructor(private readonly factory: () => T, private readonly onRelease?: (o: T) => void, prewarm = 0) {
    for (let i = 0; i < prewarm; i++) this.free.push(factory());
  }

  acquire(): T {
    const o = this.free.pop() ?? this.factory();
    this.active.add(o);
    return o;
  }

  release(o: T): void {
    if (!this.active.delete(o)) return;
    this.onRelease?.(o);
    this.free.push(o);
  }

  get size(): number {
    return this.active.size + this.free.length;
  }
}
