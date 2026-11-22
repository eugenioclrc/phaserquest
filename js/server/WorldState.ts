import { ArraySchema, schema, t, type SchemaType } from '@colyseus/schema';
import type { Tile } from '../../shared/WorldProtocol.ts';

const Position = schema({ x: t.uint16(), y: t.uint16() }, 'Position');
const PlayerState = schema({
  id: t.uint32(),
  name: t.string(),
  x: t.uint16(),
  y: t.uint16(),
  aoi: t.uint16(),
  armor: t.uint16(),
  weapon: t.uint16(),
  alive: t.boolean(),
  inFight: t.boolean(),
  targetID: t.int32().default(-1),
  routeVersion: t.uint16(),
  routeEndX: t.uint16(),
  routeEndY: t.uint16(),
  routeOrientation: t.uint8().default(0),
  routeStartedAt: t.uint32(),
}, 'PlayerState');

const MonsterRoute = schema({
  path: t.array(Position),
  delta: t.uint16(),
}, 'MonsterRoute');

const MonsterState = schema({
  id: t.uint32(),
  x: t.uint16(),
  y: t.uint16(),
  monster: t.uint16(),
  alive: t.boolean(),
  inFight: t.boolean(),
  targetID: t.int32().default(-1),
  lastHitter: t.int32().default(-1),
  routeVersion: t.uint16(),
  route: t.ref(MonsterRoute).optional(),
}, 'MonsterState');

const ItemState = schema({
  id: t.uint32(),
  x: t.uint16(),
  y: t.uint16(),
  itemID: t.uint16(),
  visible: t.boolean(),
  respawn: t.boolean(),
  chest: t.boolean(),
  inChest: t.boolean(),
  loot: t.boolean(),
}, 'ItemState');

export const SelfState = schema({
  playerId: t.uint32(),
  life: t.uint8(),
  doorX: t.int16().default(-1),
  doorY: t.int16().default(-1),
}, 'SelfState');

export const WorldState = schema({
  online: t.uint32().default(0),
  players: t.map(PlayerState).view(),
  monsters: t.map(MonsterState).view(),
  items: t.map(ItemState).view(),
  self: t.map(SelfState).view(),
}, 'WorldState');

export type WorldState = SchemaType<typeof WorldState>;
export type PlayerState = SchemaType<typeof PlayerState>;
export type MonsterState = SchemaType<typeof MonsterState>;
export type ItemState = SchemaType<typeof ItemState>;
export type VisibleEntity = PlayerState | MonsterState | ItemState;

export interface PlayerEntity extends Tile {
  category: 'player';
  id: number;
  name: string;
  aoi: number;
  armor: number;
  weapon: number;
  alive: boolean;
  inFight: boolean;
  life: number;
  lastDoor?: Tile;
  inWorld: boolean;
  target?: { id: number };
  routeVersion: number;
  route?: {
    path: Tile[];
    orientation?: number;
    departureTime: number;
  };
}

function syncPlayer(state: WorldState, player: PlayerEntity) {
  const key = String(player.id);
  const row = state.players.get(key) ?? new PlayerState();
  const route = player.route;
  if (row.routeVersion !== player.routeVersion || !route) {
    // Clients animate from the route origin using its start time.
    const anchor = route?.path[0] ?? player;
    row.x = anchor.x;
    row.y = anchor.y;
  }
  if (row.routeVersion !== player.routeVersion) {
    if (route) {
      const end = route.path[route.path.length - 1];
      row.routeEndX = end.x;
      row.routeEndY = end.y;
      row.routeStartedAt = route.departureTime >>> 0;
    }
    row.routeOrientation = route?.orientation ?? 0;
  }
  row.assign({
    id: player.id,
    name: player.name,
    aoi: player.aoi,
    armor: player.armor,
    weapon: player.weapon,
    alive: player.alive,
    inFight: player.inFight,
    targetID: player.target?.id ?? -1,
    routeVersion: player.routeVersion,
  });
  if (!state.players.has(key)) state.players.set(key, row);
}

interface MonsterEntity extends Tile {
  category: 'monster';
  id: number;
  monster: number;
  alive: boolean;
  inFight: boolean;
  inWorld: boolean;
  target?: { id: number };
  lastHitter?: number | { id: number };
  routeVersion: number;
  route?: { path: Tile[]; delta: number };
}

interface ItemEntity extends Tile {
  category: 'item';
  id: number;
  itemID: number;
  visible: boolean;
  respawn: boolean;
  chest: boolean;
  inChest: boolean;
  loot: boolean;
  inWorld: boolean;
}

export type WorldEntity = PlayerEntity | MonsterEntity | ItemEntity;
export const entityCollection = { player: 'players', monster: 'monsters', item: 'items' } as const;

export function syncEntity(state: WorldState, entity: WorldEntity) {
  if (entity.category === 'player') {
    syncPlayer(state, entity);
    return;
  }

  const key = String(entity.id);
  if (entity.category === 'monster') {
    const row = state.monsters.get(key) ?? new MonsterState();
    if (row.routeVersion !== entity.routeVersion) {
      const route = entity.route;
      row.route = route ? new MonsterRoute().assign({
        path: new ArraySchema(...route.path.map(tile => new Position().assign(tile))),
        delta: route.delta,
      }) : undefined;
    }
    row.assign({
      id: entity.id,
      x: entity.x,
      y: entity.y,
      monster: entity.monster,
      alive: entity.alive,
      inFight: entity.inFight,
      targetID: entity.target?.id ?? -1,
      lastHitter: typeof entity.lastHitter === 'number' ? entity.lastHitter : -1,
      routeVersion: entity.routeVersion,
    });
    if (!state.monsters.has(key)) state.monsters.set(key, row);
    return;
  }

  const row = state.items.get(key) ?? new ItemState();
  row.assign({
    id: entity.id,
    x: entity.x,
    y: entity.y,
    itemID: entity.itemID,
    visible: entity.visible,
    respawn: entity.respawn,
    chest: entity.chest,
    inChest: entity.inChest,
    loot: entity.loot,
  });
  if (!state.items.has(key)) state.items.set(key, row);
}
