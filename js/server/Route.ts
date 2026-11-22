import type { PathAction, Tile } from '../../shared/WorldProtocol.ts';

class Route {
  step = 0;
  readonly delta: number;

  constructor(
    readonly path: Tile[],
    readonly departureTime: number,
    latency: number,
    readonly action?: PathAction,
    readonly orientation?: number,
  ) {
    this.delta = Math.floor(latency);
  }
}

export = Route;
