import { expect, test } from 'bun:test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@colyseus/sdk';
import { defineRoom, matchMaker } from 'colyseus';
import { ObjectId } from 'mongodb';
import express from 'express';
import { WorldRoom } from '../js/server/WorldRoom.ts';
import { createGameServer } from '../js/server/createGameServer.ts';
import { CharacterStore } from '../js/server/CharacterStore.js';

const { GameServer } = require('../js/server/GameServer.js');

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
    first.send('ready');
    await until(() => first.state?.self?.has(first.sessionId));
    const second = await client.join<WorldRoom>('world', { id: ids[1] });
    const distant = await client.join<WorldRoom>('world', { id: ids[2] });
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

    await distant.leave();
    await second.leave();
    await first.leave();
  } finally {
    await server.gracefullyShutdown(false);
  }
});
