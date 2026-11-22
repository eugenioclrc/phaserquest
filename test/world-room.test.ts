import { expect, test } from 'bun:test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client, type Room } from '@colyseus/sdk';
import { defineRoom, matchMaker } from 'colyseus';
import { ObjectId } from 'mongodb';
import express from 'express';
import type { Tile } from '../shared/WorldProtocol.ts';
import { WorldRoom } from '../js/server/WorldRoom.ts';
import { createGameServer } from '../js/server/createGameServer.ts';
import { CharacterStore } from '../js/server/CharacterStore.js';

const { GameServer } = require('../js/server/GameServer.js');

function ready(room: Room<WorldRoom>) {
  const position = Promise.withResolvers<Tile>();
  room.onMessage('ready', position.resolve);
  room.send('ready');
  return position.promise;
}

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
      return index < 0 ? null : { _id, name: 'Scout' + index, x: '30', y: String(31 + index), weapon: 'sword1', armor: 'clotharmor' };
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

    const [originalPosition] = await Promise.all([ready(first), ready(second)]);
    expect(originalPosition).toMatchObject({ x: 30, y: 31 });
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

    const player = GameServer.getPlayer(first.sessionId);
    player.lastWalkUpdate = Date.now() + 5000;
    player.setRoute([{ x: 30, y: 31 }, { x: 31, y: 31 }, { x: 32, y: 31 }], Date.now(), 0, { action: 0 }, 3);
    player.x = 31;
    GameServer.moveAtLocation(player, 30, 31, 31, 31);

    const token = first.reconnectionToken;
    first.reconnection.enabled = false;
    await first.leave(false);
    const resumed = await sdk.reconnect<WorldRoom>(token);
    expect(resumed.sessionId).toBe(first.sessionId);
    expect(await ready(resumed)).toMatchObject({ x: 31, y: 31 });
    expect(await localPlayer(resumed)).toBe(firstPlayer);
    for (let i = 0; i < 100 && resumed.state.players.get(String(firstPlayer))?.routeOrientation !== 3; i++) {
      await Bun.sleep(10);
    }
    expect(resumed.state.players.get(String(firstPlayer))).toMatchObject({ routeOrientation: 3, x: 30 });
    await resumed.leave();
    const next = await sdk.join<WorldRoom>('world', { id: ids[0] });
    expect(next.sessionId).not.toBe(first.sessionId);
    await ready(next);
    expect(await localPlayer(next)).not.toBe(firstPlayer);
    await next.leave();

    const expired = second.reconnectionToken;
    second.reconnection.enabled = false;
    await second.leave(false);
    await Bun.sleep(10100);
    await expect(sdk.reconnect<WorldRoom>(expired)).rejects.toThrow();
    const loaded = await sdk.join<WorldRoom>('world', { id: ids[1] });
    await ready(loaded);
    expect(await localPlayer(loaded)).not.toBe(secondPlayer);
    await loaded.leave();
  } finally {
    await server.gracefullyShutdown(false);
  }
}, 18000);
