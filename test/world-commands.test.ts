import { expect, test } from 'bun:test';
const { GameServer } = require('../js/server/GameServer.js');

test('invalid paths leave an accepted route in place', () => {
  const routes: unknown[] = [];
  const player = { x: 0, y: 0, alive: true, setRoute: (path: unknown) => routes.push(path) };
  GameServer.players[1] = player;
  GameServer.sessionMap.session = 1;
  GameServer.collisionGrid = [[0, 0, 1], [0, 0, 0]];
  GameServer.map = { width: 3, height: 2 };
  GameServer.monstersTable = { 0: { alive: true } };
  const path = [{ x: 0, y: 0 }, { x: 1, y: 0 }];
  try {
    expect(GameServer.handlePath('session', { path, action: { action: 0 }, or: 3 }, 0)).toBe(true);
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
      { path, action: { action: 4, x: 0, y: 100 }, or: 3 },
      { path, action: { action: 0 }, or: 9 },
    ]) expect(GameServer.handlePath('session', input, 0)).toBe(false);
    expect(routes).toEqual([path]);
    expect(GameServer.handlePath('session', { path: [path[0]], action: { action: 4, ...path[1] }, or: 3 }, 0)).toBe(true);
  } finally {
    delete GameServer.players[1];
    delete GameServer.sessionMap.session;
  }
});
