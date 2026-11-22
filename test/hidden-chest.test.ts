import { expect, test } from 'bun:test';
import GameServer = require('../js/server/GameServer.ts');
import { syncEntity, WorldState } from '../js/server/WorldState.ts';

test('the hidden chest from Tiled coordinates syncs as a numeric tile', async () => {
  await GameServer.readMap();
  const schedule = GameServer.schedule;
  GameServer.schedule = callback => callback();
  try {
    expect(GameServer.items.getFirstFiltered(71, 268, ['visible', 'chest'])).toBeNull();
    for (const [x, y] of [[73, 267], [68, 268], [70, 269]]) {
      const chestArea = GameServer.monsters.getFirst(x, y)?.chestArea;
      if (!chestArea) throw new Error('Missing monster in the hidden chest area');
      chestArea.decrement();
    }

    const chest = GameServer.items.getFirstFiltered(71, 268, ['visible', 'chest']);
    if (!chest) throw new Error('The hidden chest did not spawn');
    const state = new WorldState();
    syncEntity(state, chest);
    const item = state.items.get(String(chest.id));
    expect(item?.x).toBe(71);
    expect(item?.y).toBe(268);
  } finally {
    GameServer.schedule = schedule;
  }
});
