import { expect, spyOn, test } from 'bun:test';
import { ObjectId } from 'mongodb';
import { CharacterStore } from '../js/server/CharacterStore.ts';
import type { CharacterSave } from '../js/server/WorldTypes.ts';
import { SpaceMap } from '../shared/SpaceMap.ts';
import { characterCollection } from './character-collection.ts';
import GameServer = require('../js/server/GameServer.ts');
import Player = require('../js/server/Player.ts');

test('tile filters find visible loot behind hidden items and chests', () => {
  const items = new SpaceMap<{ visible: boolean; inChest: boolean }>();
  const loot = { visible: true, inChest: false };
  items.add(0, 0, { visible: false, inChest: false });
  items.add(0, 0, { visible: true, inChest: true });
  items.add(0, 0, loot);
  expect(items.getFirstFiltered(0, 0, ['visible'], ['inChest'])).toBe(loot);
});

test('monster pathfinding uses every blocked tile in the world collision grid', async () => {
  await GameServer.readMap();
  const mismatches = GameServer.collisionGrid.flatMap((row, y) => row.flatMap((blocked, x) =>
    GameServer.PFgrid.isWalkableAt(x, y) === !blocked ? [] : [{ x, y }],
  ));
  expect(mismatches).toEqual([]);
});

test('a roaming area with one tile places at most one monster there', async () => {
  await GameServer.readMap();
  const areas = GameServer.objects.roaming;
  const count = GameServer.lastMonsterID;
  const tile = { x: 0, y: 0 };
  const collision = GameServer.collisionGrid[0][0];
  GameServer.collisionGrid[0][0] = 0;
  GameServer.objects.roaming = [{ ...areas[0], ...tile, width: 1, height: 1, properties: { nb: '3' } }];
  try {
    GameServer.setUpRoaming();
    expect(GameServer.lastMonsterID - count).toBe(1);
    expect(GameServer.monsters.get(0, 0)).toHaveLength(1);
  } finally {
    GameServer.objects.roaming = areas;
    GameServer.collisionGrid[0][0] = collision;
  }
});

test('invalid paths leave an accepted route in place', async () => {
  await GameServer.readMap();
  const player = new Player(GameServer);
  player.x = 0;
  player.y = 0;
  player.setLastSavedPosition();
  GameServer.players[1] = player;
  GameServer.sessionMap.session = 1;
  GameServer.collisionGrid[0].splice(0, 3, 0, 0, 1);
  GameServer.collisionGrid[1].splice(0, 3, 0, 0, 0);
  const path = [{ x: 0, y: 0 }, { x: 1, y: 0 }];
  try {
    expect(GameServer.handlePath('session', { path, action: { action: 0 }, or: 3 })).toBe(true);
    const route = player.route;
    for (const input of [
      null,
      { path: [], action: { action: 0 }, or: 3 },
      { path: path.slice(0, 1), action: { action: 0 }, or: 3 },
      { path: Array.from({ length: 61 }, () => path[0]), action: { action: 0 }, or: 3 },
      { path: [path[0], { x: 0, y: -1 }], action: { action: 0 }, or: 3 },
      { path: [path[0], { x: 1.5, y: 0 }], action: { action: 0 }, or: 3 },
      { path: [path[0], { x: 1, y: 1 }], action: { action: 0 }, or: 3 },
      { path: [{ x: 1, y: 1 }, { x: 0, y: 1 }], action: { action: 0 }, or: 3 },
      { path: [path[0], { x: 2, y: 1 }], action: { action: 0 }, or: 3 },
      { path: [...path, { x: 2, y: 0 }], action: { action: 0 }, or: 3 },
      { path, action: { action: 3, id: '0' }, or: 3 },
      { path, action: { action: 4, x: 0, y: GameServer.map.height }, or: 3 },
      { path, action: { action: 0 }, or: 9 },
    ]) expect(GameServer.handlePath('session', input)).toBe(false);
    const blocked = { x: 1, y: 0 };
    GameServer.collisionGrid[0][1] = 1;
    expect(GameServer.handlePath('session', { path: [blocked], action: { action: 4, ...blocked }, or: 3 })).toBe(false);
    GameServer.collisionGrid[0][1] = 0;
    expect(player.route).toBe(route);
    expect(GameServer.handlePath('session', { path: [path[0]], action: { action: 4, ...path[1] }, or: 3 })).toBe(true);
    expect(GameServer.handlePath('session', { path: [{ x: 1, y: 1 }], action: { action: 4, ...path[1] }, or: 3 })).toBe(false);
  } finally {
    delete GameServer.players[1];
    delete GameServer.sessionMap.session;
  }
});

test('changing direction preserves the time needed to complete a tile step', async () => {
  await GameServer.readMap();
  const player = new Player(GameServer);
  player.x = 0;
  player.y = 0;
  GameServer.players[1] = player;
  GameServer.sessionMap.session = 1;
  GameServer.collisionGrid[1].splice(0, 2, 0, 0);
  player.setLastSavedPosition();
  const clock = spyOn(Date, 'now').mockReturnValue(1000);
  try {
    const start = { x: 0, y: 0 };
    expect(GameServer.handlePath('session', { path: [start, { x: 0, y: 1 }], action: { action: 0 }, or: 2 })).toBe(true);
    clock.mockReturnValue(1080);
    player.updateWalk();
    expect({ x: player.x, y: player.y }).toEqual(start);

    expect(GameServer.handlePath('session', { path: [{ x: 0, y: 1 }, { x: 1, y: 1 }], action: { action: 0 }, or: 3 })).toBe(true);
    clock.mockReturnValue(1120);
    player.updateWalk();
    expect({ x: player.x, y: player.y }).toEqual({ x: 0, y: 1 });
    clock.mockReturnValue(1240);
    player.updateWalk();
    expect({ x: player.x, y: player.y }).toEqual({ x: 1, y: 1 });
  } finally {
    clock.mockRestore();
    delete GameServer.players[1];
    delete GameServer.sessionMap.session;
  }
});

test('one pending autosave still allows a final save at the entrance to an interior', async () => {
  await GameServer.readMap();
  const _id = new ObjectId();
  const document = { _id, x: 30, y: 31, name: 'Scout', weapon: 'sword1', armor: 'clotharmor' };
  const pending = Promise.withResolvers<{ matchedCount: number }>();
  const writes: CharacterSave[] = [];
  const store = GameServer.characters = new CharacterStore(characterCollection({
    findOne: async () => document,
    updateOne: async (_filter, { $set }) => {
      writes.push($set);
      return pending.promise;
    },
  }));
  const player = (await GameServer.loadPlayer('session', _id.toString(), () => true))!;
  player.x = 61;
  GameServer.moveAtLocation(player, 30, 31, 61, 31);
  GameServer.checkSave(player);
  player.x = 62;
  GameServer.moveAtLocation(player, 61, 31, 62, 31);
  GameServer.checkSave(player);

  player.teleport({ to: { x: 99, y: 31 }, camera: { x: '90', y: '25' }, orientation: 's' });
  GameServer.moveAtLocation(player, 62, 31, 99, 31);
  const leaving = GameServer.removePlayer('session');
  const reopening = store.open(_id.toString());
  pending.resolve({ matchedCount: 1 });
  await leaving;
  await reopening;
  await store.close(_id.toString());
  expect(writes.map(({ x, y }) => ({ x, y }))).toEqual([{ x: 61, y: 31 }, { x: 62, y: 31 }]);
});

test('doors track the outdoor entrance across rooms, exits and revives', async () => {
  await GameServer.readMap();
  const player = new Player(GameServer);
  player.x = 104;
  player.y = 7;
  player.setLastSavedPosition();
  GameServer.checkDoor(player);
  expect(player.lastOutdoorPosition).toEqual({ x: 104, y: 7 });
  player.teleport({ to: { x: 155, y: 158 }, camera: { x: '141', y: '157' }, orientation: 'u' });
  expect(player.lastOutdoorPosition).toEqual({ x: 104, y: 7 });
  GameServer.checkDoor(player);
  expect(player.lastOutdoorPosition).toBeUndefined();
  expect(player).toMatchObject({ x: 104, y: 6 });

  player.y = 7;
  GameServer.checkDoor(player);
  player.die();
  player.revive();
  expect(player.lastOutdoorPosition).toBeUndefined();
  expect(player).toMatchObject({ x: 104, y: 7 });
});

test('leaving outdoors saves the current position and leaving dead saves the respawn tile', async () => {
  await GameServer.readMap();
  const _id = new ObjectId();
  const document = { _id, x: 95, y: 30, name: 'Scout', weapon: 'sword1', armor: 'clotharmor' };
  const writes: CharacterSave[] = [];
  GameServer.characters = new CharacterStore(characterCollection({
    findOne: async () => document,
    updateOne: async (_filter, { $set }) => {
      writes.push($set);
      return { matchedCount: 1 };
    },
  }));
  for (const dead of [false, true]) {
    const player = (await GameServer.loadPlayer('session', _id.toString(), () => true))!;
    player.x = 100;
    GameServer.moveAtLocation(player, 95, 30, 100, 30);
    if (dead) player.die();
    await GameServer.removePlayer('session');
  }
  expect(writes.map(({ x, y }) => ({ x, y }))).toEqual([{ x: 100, y: 30 }, { x: 95, y: 30 }]);
});
