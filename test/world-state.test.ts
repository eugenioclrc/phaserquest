import { expect, test } from 'bun:test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@colyseus/sdk';
import { defineRoom, matchMaker } from '@colyseus/core';
import { ObjectId } from 'mongodb';
import express from 'express';
import { WorldRoom } from '../js/server/WorldRoom.ts';
import { createGameServer } from '../js/server/createGameServer.ts';
import { CharacterStore } from '../js/server/CharacterStore.js';

const { GameServer } = require('../js/server/GameServer.js');
const { Item } = require('../js/server/Item.js');

async function until(ready: () => boolean) {
  const end = Date.now() + 1500;
  while (!ready()) {
    if (Date.now() > end) throw new Error('Expected state patch did not arrive');
    await Bun.sleep(10);
  }
}

test('state contains only nearby avatars and the local character health', async () => {
  const ids = ['200000000000000000000001', '200000000000000000000002', '200000000000000000000003'];
  GameServer.characters = new CharacterStore({
    findOne: async ({ _id }: { _id: ObjectId }) => {
      const index = ids.indexOf(_id.toString());
      if (index < 0) return null;
      return { _id, name: 'Scout' + index, x: index === 2 ? 99 : 12 + index, y: 12, weapon: 'sword1', armor: 'clotharmor' };
    },
  });
  await GameServer.readMap();
  const http = createServer(express());
  const server = createGameServer(http, { world: defineRoom(WorldRoom) });
  try {
    await server.listen(0, '127.0.0.1');
    const client = new Client('http://127.0.0.1:' + (http.address() as AddressInfo).port);
    await matchMaker.createRoom('world', {});
    const first = await client.join<WorldRoom>('world', { id: ids[0] });
    first.onMessage('ready', () => {});
    first.send('ready');
    await until(() => first.state?.self?.has(first.sessionId));
    const second = await client.join<WorldRoom>('world', { id: ids[1] });
    const distant = await client.join<WorldRoom>('world', { id: ids[2] });
    second.onMessage('ready', () => {});
    distant.onMessage('ready', () => {});
    second.send('ready');
    distant.send('ready');
    await until(() => first.state.online === 3 && first.state.players.size === 2 && distant.state?.players.size === 1);
    expect(first.state.self.size).toBe(1);
    expect(first.state.self.get(first.sessionId)?.life).toBe(100);
    expect(first.state.self.has(second.sessionId)).toBe(false);
    expect(first.state.self.get(first.sessionId)?.playerId).toBe(0);

    const player = GameServer.getPlayer(second.sessionId);
    const firstPlayerId = String(first.state.self.get(first.sessionId)!.playerId);
    const playerKey = String(player.id);
    const move = (x: number) => {
      const from = player.x;
      player.x = x;
      GameServer.moveAtLocation(player, from, player.y, x, player.y);
    };
    move(99);
    await until(() => !first.state.players.has(playerKey) && !second.state.players.has(firstPlayerId));
    expect(second.state.players.size).toBe(2);
    expect(distant.state.players.has(playerKey)).toBe(true);
    expect(second.state.self.size).toBe(1);

    move(13);
    await until(() => first.state.players.has(playerKey) && !distant.state.players.has(playerKey));
    player.updateLife(-23);
    await until(() => second.state.self.get(second.sessionId)?.life === 77);
    expect(first.state.self.get(first.sessionId)?.life).toBe(100);

    GameServer.addMonster({ x: 14, y: 12 }, 'rat');
    const monster = GameServer.monstersTable[GameServer.lastMonsterID - 1];
    const monsterKey = String(monster.id);
    monster.lastWalkUpdate = Date.now() + 10000;
    monster.setRoute([{ x: 14, y: 12 }, { x: 15, y: 12 }, { x: 16, y: 12 }], Date.now(), 0);
    await until(() => first.state.monsters?.get(monsterKey)?.route?.path.length === 3);
    expect(distant.state.monsters?.has(monsterKey)).toBe(false);
    const version = first.state.monsters.get(monsterKey)!.routeVersion;
    monster.x = 15;
    GameServer.moveAtLocation(monster, 14, 12, 15, 12);
    await until(() => first.state.monsters.get(monsterKey)?.x === 15);
    expect(first.state.monsters.get(monsterKey)?.routeVersion).toBe(version);
    monster.clearRoute();
    monster.x = 99;
    GameServer.moveAtLocation(monster, 15, 12, 99, 12);
    await until(() => !first.state.monsters.has(monsterKey) && distant.state.monsters.has(monsterKey));
    expect(distant.state.monsters.get(monsterKey)?.route).toBeUndefined();

    const item = new Item(14, 12, 'flask', false, true, false);
    GameServer.addAtLocation(item);
    const itemKey = String(item.id);
    await until(() => first.state.items.get(itemKey)?.inChest === true);
    expect(distant.state.items.has(itemKey)).toBe(false);
    item.open();
    await until(() => first.state.items.get(itemKey)?.inChest === false);
    item.pick();
    await until(() => !first.state.items.has(itemKey));

    const hits = Promise.withResolvers<{ hp: { hp: number; monsterId: number; target: boolean }[] }>();
    second.onMessage('playerEvents', hits.resolve);
    player.updatePacket.addHP(false, 10, 0);
    player.updatePacket.addHP(true, 13, monster.id);
    expect((await hits.promise).hp).toEqual([
      { target: false, hp: 10, monsterId: 0 }, { target: true, hp: 13, monsterId: monster.id },
    ]);

    player.equip(1, 'sword2');
    await until(() => first.state.players.get(playerKey)?.weapon === GameServer.db.items.sword2.id);
    player.updateLife(-player.life);
    await until(() => second.state.self.get(second.sessionId)?.life === 0);
    const revived = Promise.withResolvers<unknown>();
    second.onMessage('revived', revived.resolve);
    second.send('revive');
    expect(await revived.promise).toEqual({ x: 13, y: 12 });
    expect(second.state.self.get(second.sessionId)?.life).toBe(100);

    await distant.leave();
    await second.leave();
    await first.leave();
  } finally {
    await server.gracefullyShutdown(false);
  }
});
