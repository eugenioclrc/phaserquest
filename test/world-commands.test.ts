import { expect, test } from 'bun:test';
import GameServer = require('../js/server/GameServer.ts');
import Player = require('../js/server/Player.ts');

test('invalid paths leave an accepted route in place', async () => {
  await GameServer.readMap();
  const player = new Player(GameServer);
  player.x = 0;
  player.y = 0;
  GameServer.players[1] = player;
  GameServer.sessionMap.session = 1;
  GameServer.collisionGrid[0].splice(0, 3, 0, 0, 1);
  GameServer.collisionGrid[1].splice(0, 3, 0, 0, 0);
  const path = [{ x: 0, y: 0 }, { x: 1, y: 0 }];
  try {
    expect(GameServer.handlePath('session', { path, action: { action: 0 }, or: 3 }, 0)).toBe(true);
    const route = player.route;
    for (const input of [
      null,
      { path: [], action: { action: 0 }, or: 3 },
      { path: path.slice(0, 1), action: { action: 0 }, or: 3 },
      { path: Array.from({ length: 61 }, () => path[0]), action: { action: 0 }, or: 3 },
      { path: [path[0], { x: 0, y: -1 }], action: { action: 0 }, or: 3 },
      { path: [path[0], { x: 1.5, y: 0 }], action: { action: 0 }, or: 3 },
      { path: [path[0], { x: 2, y: 1 }], action: { action: 0 }, or: 3 },
      { path: [...path, { x: 2, y: 0 }], action: { action: 0 }, or: 3 },
      { path, action: { action: 3, id: '0' }, or: 3 },
      { path, action: { action: 4, x: 0, y: GameServer.map.height }, or: 3 },
      { path, action: { action: 0 }, or: 9 },
    ]) expect(GameServer.handlePath('session', input, 0)).toBe(false);
    const blocked = { x: 1, y: 0 };
    GameServer.collisionGrid[0][1] = 1;
    expect(GameServer.handlePath('session', { path: [blocked], action: { action: 4, ...blocked }, or: 3 }, 0)).toBe(false);
    GameServer.collisionGrid[0][1] = 0;
    expect(player.route).toBe(route);
    expect(GameServer.handlePath('session', { path: [path[0]], action: { action: 4, ...path[1] }, or: 3 }, 0)).toBe(true);
  } finally {
    delete GameServer.players[1];
    delete GameServer.sessionMap.session;
  }
});
