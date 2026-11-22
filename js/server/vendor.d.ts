declare module 'pathfinding' {
  export class Grid {
    constructor(matrix: number[][]);
    clone(): Grid;
  }

  export class AStarFinder {
    findPath(startX: number, startY: number, endX: number, endY: number, grid: Grid): [number, number][];
  }
}

declare module 'random-weighted-choice' {
  function choose<T extends { weight: number; id: string }>(choices: T[]): T['id'] | undefined;
  export = choose;
}
