import type { ObjectId } from 'mongodb';
import type { Tile } from '../../shared/WorldProtocol.ts';

export interface CharacterSave extends Tile {
  name: string;
  weapon: string;
  armor: string;
}

export interface CharacterDocument extends Omit<CharacterSave, keyof Tile> {
  _id: ObjectId;
  x: number | string;
  y: number | string;
}

export interface ItemDefinition {
  id: number;
  type: number;
  atk?: number;
  def?: number;
  heals?: number;
  equip?: string;
}

export interface MonsterDefinition {
  id: number;
  name: string;
  life: number;
  speed: number;
  atk: number;
  def: number;
  aggressive?: boolean;
  lootTable?: Record<string, number>;
}

export interface EntityDefinition {
  sprite: string;
  npc?: boolean;
  item?: boolean;
  monster?: boolean;
}

export interface LootChoice {
  weight: number;
  id: string;
}

export interface Door {
  to: Tile;
  camera: { x: string; y: string } | null;
  orientation: string;
}

export interface ChestContents extends Tile {
  items: string;
}

export interface TiledObject extends Tile {
  width: number;
  height: number;
  gid?: number;
  type: string;
  properties: Record<string, string>;
}

export interface TiledObjectLayer {
  type: 'objectgroup';
  name: string;
  width?: number;
  height?: number;
  objects: TiledObject[];
}

export interface TiledTileLayer {
  type: 'tilelayer';
  width: number;
  height: number;
  data: number[];
}

export interface TiledMap {
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  orientation?: string;
  properties?: Record<string, unknown>;
  layers: (TiledTileLayer | TiledObjectLayer)[];
  tilesets: { name: string; tileproperties: Record<number, Record<string, unknown>> }[];
}
