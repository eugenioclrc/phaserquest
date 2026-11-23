import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import type { Tile } from '../shared/WorldProtocol.ts';
import { turnFrom, type PlayerWalk } from '../src/playerWalk.ts';
import GameServer = require('../js/server/GameServer.ts');
import Player = require('../js/server/Player.ts');

let player: Player;
const start = { x: 25, y: 28 };
const walk = (path: Tile[]) => GameServer.handlePath('walker', { path, action: { action: 0 }, or: 3 });

beforeEach(async () => {
  await GameServer.readMap();
  player = new Player(GameServer);
  Object.assign(player, start);
  player.setIDs('walker');
  GameServer.embedPlayer(player);
  GameServer.sessionMap.walker = player.id;
});

afterEach(() => {
  mock.restore();
  GameServer.removeFromLocation(player);
  delete GameServer.players[player.id];
  delete GameServer.sessionMap.walker;
});

test('a turn advances the old route before anchoring the new path to the server tile', () => {
  const clock = spyOn(Date, 'now').mockReturnValue(1000);
  const oldPath = Array.from({ length: 6 }, (_, i) => ({ x: start.x + i, y: start.y }));
  expect(walk(oldPath)).toBe(true);
  clock.mockReturnValue(1000 + 2.75 * player.speed);
  expect(walk([oldPath[3], oldPath[2]])).toBe(true);
  expect(player.route?.path).toEqual([oldPath[2], oldPath[3], oldPath[2]]);
  expect(player.route?.departureTime).toBe(1000 + 2 * player.speed);
});

test('successive mid-step turns keep the client and server on the same walking clock', () => {
  const latency = 40;
  let now = 1000;
  const clock = spyOn(Date, 'now').mockReturnValue(now + latency);
  const line = (from: Tile, direction: number) => Array.from({ length: 5 }, (_, i) => ({
    x: from.x + i * direction, y: from.y,
  }));
  GameServer.collisionGrid[start.y].fill(0, start.x - 8, start.x + 8);
  let local: PlayerWalk = { path: line(start, 1), startedAt: now };
  expect(walk(local.path)).toBe(true);
  for (let i = 0; i < 20; i++) {
    now += 170;
    clock.mockReturnValue(now + latency);
    const turn = turnFrom(local, now);
    const requested = line(turn.tile, i % 2 ? 1 : -1);
    expect(walk(requested)).toBe(true);
    local = { path: turn.previous ? [turn.previous, ...requested] : requested, startedAt: now - turn.elapsed };
    expect(player.route?.path).toEqual(local.path);
    expect(player.route?.departureTime).toBeCloseTo(local.startedAt + latency);
    expect(GameServer.getMovementCorrection('walker')?.route?.elapsed).toBeCloseTo(turn.elapsed);
  }
});

test('the range and length limits apply to the path sent by the client', () => {
  spyOn(Date, 'now').mockReturnValue(1000);
  GameServer.collisionGrid[start.y].fill(0, start.x, start.x + 31);
  const straight = Array.from({ length: 30 }, (_, i) => ({ x: start.x + 1 + i, y: start.y }));
  expect(walk(straight.slice(0, 29))).toBe(true);
  expect(walk(straight)).toBe(false);
  const detour = Array.from({ length: 60 }, (_, i) => straight[i % 2]);
  expect(walk(detour)).toBe(true);
  expect(player.route?.path).toHaveLength(61);

  GameServer.collisionGrid[start.y + 1].fill(0, start.x, start.x + 29);
  const approach = [start, ...Array.from({ length: 29 }, (_, i) => ({ x: start.x + i, y: start.y + 1 }))];
  const chest = { action: 4, x: start.x + 28, y: start.y };
  expect(walk(approach)).toBe(false);
  expect(GameServer.handlePath('walker', { path: approach, action: chest, or: 2 })).toBe(true);
});

test('walking away or clicking a dead monster releases the earlier attack target', () => {
  spyOn(Date, 'now').mockReturnValue(1000);
  const target = GameServer.monstersTable[0];
  const path = [start, { x: start.x + 1, y: start.y }];
  const attack = (id: number) => GameServer.handlePath('walker', { path, action: { action: 3, id }, or: 3 });
  expect(attack(target.id)).toBe(true);
  expect(player.target).toBe(target);
  expect(walk(path)).toBe(true);
  expect(player.target).toBeNull();
  target.alive = false;
  expect(attack(target.id)).toBe(true);
  expect(player.route?.path).toEqual(path);
  expect(player.target).toBeNull();
  expect(attack(GameServer.lastMonsterID)).toBe(false);
});

test('a moving target within click range closes to melee and steps aside on a shared tile', () => {
  GameServer.addMonster({ x: start.x + 4, y: start.y }, 'bat');
  const monster = GameServer.monstersTable[GameServer.lastMonsterID - 1];
  player.setRoute([start], Date.now(), 0, { action: 3, id: monster.id });
  GameServer.checkAction(player);
  expect(monster.target).toBe(player);
  expect(player.target).toBe(monster);
  monster.updateFight();
  expect(monster.getPathEnd()).toEqual({ x: start.x + 1, y: start.y });
  expect(player.life).toBe(player.maxLife);
  const previousX = monster.x;
  monster.x = start.x;
  GameServer.moveAtLocation(monster, previousX, monster.y, monster.x, monster.y);
  monster.updateFight();
  expect(GameServer.adjacentNoDiagonal(monster.getPathEnd(), player)).toBeGreaterThan(0);
  monster.x = start.x + 29;
  player.endFight();
  GameServer.checkAction(player);
  expect(player.inFight).toBe(false);
});

test('roaming rectangles include a partial first tile and exclude their far boundary', () => {
  const { tilewidth, tileheight } = GameServer.map;
  GameServer.collisionGrid[0].fill(0, 0, 3);
  GameServer.collisionGrid[1].fill(0, 0, 3);
  GameServer.objects.roaming = [{
    x: 1, y: 0, width: 2 * tilewidth - 1, height: tileheight, type: 'rat', properties: { nb: '10' },
  }];
  const firstId = GameServer.lastMonsterID;
  GameServer.setUpRoaming();
  const spawned = Object.values(GameServer.monstersTable).filter(m => m.id >= firstId);
  expect(spawned.map(m => [m.x, m.y]).sort()).toEqual([[0, 0], [1, 0]]);
});
