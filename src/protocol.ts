import type { PlayerEvents, Tile } from '../shared/WorldProtocol.ts';
export type { PathAction, Tile } from '../shared/WorldProtocol.ts';

export interface PlayerSnapshot extends Tile {
  id: number;
  name: string;
  aoi?: number;
  armor?: number;
  weapon?: number;
  alive?: boolean;
  inFight?: boolean;
  targetID?: number;
  routeVersion?: number;
  route?: { end: Tile; orientation: number; elapsed: number };
}

export interface MonsterSnapshot extends Tile {
  id: number;
  monster: number;
  alive?: boolean;
  inFight?: boolean;
  targetID?: number;
  lastHitter?: number;
  routeVersion?: number;
  route?: { path: Tile[]; delta: number };
}

export interface ItemSnapshot extends Tile {
  id: number;
  itemID: number;
  visible: boolean;
  respawn: boolean;
  chest: boolean;
  inChest: boolean;
  loot: boolean;
}

export interface WorldUpdate {
  newPlayers?: PlayerSnapshot[];
  players?: Record<number, Partial<PlayerSnapshot>>;
  newMonsters?: MonsterSnapshot[];
  monsters?: Record<number, Partial<MonsterSnapshot>>;
  newItems?: ItemSnapshot[];
  items?: Record<number, Partial<ItemSnapshot>>;
  removedPlayers?: number[];
  removedMonsters?: number[];
  removedItems?: number[];
}

export interface PersonalUpdate extends PlayerEvents {
  x?: number;
  y?: number;
  life?: number;
}
