export interface Tile {
  x: number;
  y: number;
}

export interface PlayerSnapshot extends Tile {
  id: number;
  name: string;
  armor?: number;
  weapon?: number;
  alive?: boolean;
  route?: { end: Tile; orientation?: number; delta?: number };
}

export interface WorldUpdate {
  newplayers?: PlayerSnapshot[];
  players?: Record<number, Partial<PlayerSnapshot>>;
  disconnected?: number[];
}

export interface PersonalUpdate {
  x?: number;
  y?: number;
  life?: number;
}
