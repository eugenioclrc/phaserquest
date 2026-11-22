import { expect, test } from 'bun:test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client, type Room } from '@colyseus/sdk';
import { defineRoom, matchMaker } from 'colyseus';
import { ObjectId } from 'mongodb';
import express from 'express';
import { WorldRoom } from '../js/server/WorldRoom.ts';
import { createGameServer } from '../js/server/createGameServer.ts';
import { CharacterStore } from '../js/server/CharacterStore.js';

const { GameServer } = require('../js/server/GameServer.js');

async function localPlayer(room: Room<WorldRoom>) {
  for (let i = 0; i < 100; i++) {
    const self = room.state?.self?.get(room.sessionId);
    if (self) return self.playerId;
    await Bun.sleep(10);
  }
  throw new Error('Local character state was not received');
}

test('world clients share one room, reserve characters and reconnect', async () => {
  const ids = ['100000000000000000000001', '100000000000000000000002'];
  GameServer.characters = new CharacterStore({
    findOne: async ({ _id }: { _id: ObjectId }) => {
      const index = ids.indexOf(_id.toString());
      return index < 0 ? null : { _id, name: 'Scout' + index, x: 30, y: 31 + index, weapon: 'sword1', armor: 'clotharmor' };
    },
  });
  await GameServer.readMap();
  const http = createServer(express());
  const server = createGameServer(http, { world: defineRoom(WorldRoom) });
  try {
    await server.listen(0, '127.0.0.1');
    const sdk = new Client('http://127.0.0.1:' + (http.address() as AddressInfo).port);
    const { roomId } = await matchMaker.createRoom('world', {});
    const first = await sdk.join<WorldRoom>('world', { id: ids[0] });
    const second = await sdk.join<WorldRoom>('world', { id: ids[1] });
    expect(first.roomId).toBe(roomId);
    expect(second.roomId).toBe(first.roomId);

    first.send('ready');
    second.send('ready');
    const [firstPlayer, secondPlayer] = await Promise.all([localPlayer(first), localPlayer(second)]);
    expect(firstPlayer).not.toBe(secondPlayer);
    const duplicate = await sdk.join<WorldRoom>('world', { id: ids[0] });
    const rejected = Promise.withResolvers<number>();
    duplicate.onMessage('entryError', rejected.resolve);
    duplicate.send('ready');
    expect(await rejected.promise).toBe(4409);
    await duplicate.leave();
    const chat = Promise.withResolvers<unknown>();
    second.onMessage('chat', chat.resolve);
    first.send('chat', 'Nearby');
    expect(await chat.promise).toEqual({ id: firstPlayer, txt: 'Nearby' });

    const token = first.reconnectionToken;
    first.reconnection.enabled = false;
    await first.leave(false);
    const resumed = await sdk.reconnect<WorldRoom>(token);
    expect(resumed.sessionId).toBe(first.sessionId);
    resumed.send('ready');
    expect(await localPlayer(resumed)).toBe(firstPlayer);
    await resumed.leave();
    const next = await sdk.join<WorldRoom>('world', { id: ids[0] });
    expect(next.sessionId).not.toBe(first.sessionId);
    next.send('ready');
    expect(await localPlayer(next)).not.toBe(firstPlayer);
    await next.leave();
    await second.leave();
  } finally {
    await server.gracefullyShutdown(false);
  }
});
