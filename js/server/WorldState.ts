import { schema, t, type SchemaType } from '@colyseus/schema';
import type { Tile } from '../../shared/WorldProtocol.ts';

const Position = schema({ x: t.uint16(), y: t.uint16() }, 'Position');
const PlayerRoute = schema({
  end: t.ref(Position),
  orientation: t.uint8(),
  delta: t.uint16(),
}, 'PlayerRoute');

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
  routeVersion: t.uint32(),
  route: t.ref(PlayerRoute).optional(),
}, 'PlayerState');

export const SelfState = schema({
  playerId: t.uint32(),
  life: t.uint8(),
}, 'SelfState');

export const WorldState = schema({
  online: t.uint32().default(0),
  aoiColumns: t.uint16(),
  aoiCount: t.uint16(),
  players: t.map(PlayerState).view(),
  self: t.map(SelfState).view(),
}, 'WorldState');

export type WorldState = SchemaType<typeof WorldState>;
export type PlayerState = SchemaType<typeof PlayerState>;

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
  inWorld: boolean;
  target?: { id: number };
  routeVersion: number;
  route?: {
    path: Tile[];
    orientation?: number;
    delta: number;
  };
}

export function syncPlayer(state: WorldState, player: PlayerEntity) {
  const key = String(player.id);
  const row = state.players.get(key) ?? new PlayerState();
  if (row.routeVersion !== player.routeVersion) {
    const route = player.route;
    row.route = route ? new PlayerRoute().assign({
      end: new Position().assign(route.path[route.path.length - 1]),
      orientation: route.orientation ?? 0,
      delta: route.delta,
    }) : undefined;
  }
  row.assign({
    id: player.id,
    name: player.name,
    x: player.x,
    y: player.y,
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
