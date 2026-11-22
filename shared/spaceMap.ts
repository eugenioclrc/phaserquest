/**
 * Created by Jerome on 09-11-16.
 */

type CollectedMethod<T> = {
  [K in keyof T]-?: T[K] extends () => unknown ? K : never;
}[keyof T];

// A sparse coordinate map that preserves entity order within each tile.
class spaceMap<T extends object> {
  [x: number]: Partial<Record<number, T[]>> | undefined;

  add(x: number, y: number, object: T): void {
    const existingColumn = Object.hasOwn(this, x) ? this[x] : undefined;
    const column = existingColumn ?? (this[x] = {});
    const objects = Object.hasOwn(column, y) ? column[y] : undefined;
    (objects ?? (column[y] = [])).push(object);
  }

  delete(x: number, y: number, object: T): void {
    const objects = this.get(x, y);
    if (!objects) return;
    const index = objects.indexOf(object);
    if (index >= 0) objects.splice(index, 1);
  }

  move(x1: number, y1: number, x2: number, y2: number, object: T): void {
    this.delete(x1, y1, object);
    this.add(x2, y2, object);
  }

  get(x: number, y: number): T[] | null {
    const column = Object.hasOwn(this, x) ? this[x] : undefined;
    if (!column || !Object.hasOwn(column, y)) return null;
    return column[y] ?? null;
  }

  getFirst(x: number, y: number): T | null | undefined {
    const objects = this.get(x, y);
    return objects ? objects[0] : null;
  }

  getFirstFiltered(x: number, y: number, filters: readonly (keyof T)[], notFilters: readonly (keyof T)[] = []): T | null {
    const objects = this.get(x, y);
    if (!objects) return null;
    for (const object of objects) {
      if (!filters.every(key => object[key])) return null;
      if (!notFilters.some(key => object[key])) return object;
    }
    return null;
  }

  getAll(): T[];
  getAll<K extends CollectedMethod<T>>(fnCall: K): ReturnType<Extract<T[K], () => unknown>>[];
  getAll(fnCall?: CollectedMethod<T>): unknown[] {
    let result: unknown[] = [];
    for (const x of Object.keys(this)) {
      const column = this[Number(x)];
      if (!column) continue;
      for (const objects of Object.values(column)) {
        if (!objects) continue;
        if (fnCall) {
          for (const object of objects) {
            const method = object[fnCall] as (this: T) => unknown;
            result.push(method.call(object));
          }
        } else {
          result = result.concat(objects);
        }
      }
    }
    return result;
  }
}

export { spaceMap };
