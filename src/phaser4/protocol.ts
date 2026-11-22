export interface Tile {
  x: number;
  y: number;
}

export type PathAction = { action: 0 } | { action: 3; id: number } | { action: 4; x: number; y: number };

export interface PlayerSnapshot extends Tile {
  id: number;
  name: string;
  aoi?: number;
  armor?: number;
  weapon?: number;
  alive?: boolean;
  inFight?: boolean;
  targetID?: number;
  route?: { end: Tile; orientation?: number; delta?: number };
}

export interface MonsterSnapshot extends Tile {
  id: number;
  monster: number;
  alive?: boolean;
  inFight?: boolean;
  targetID?: number;
  lastHitter?: number;
  route?: { path: Tile[]; delta: number };
}

export interface WorldUpdate {
  newplayers?: PlayerSnapshot[];
  players?: Record<number, Partial<PlayerSnapshot>>;
  newmonsters?: MonsterSnapshot[];
  monsters?: Record<number, Partial<MonsterSnapshot>>;
  disconnected?: number[];
}

export interface PersonalUpdate {
  x?: number;
  y?: number;
  life?: number;
  hp?: { hp: number; target: boolean; from?: number }[];
  killed?: number[];
}
