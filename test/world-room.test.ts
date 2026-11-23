import { expect, test } from 'bun:test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client, type Room } from '@colyseus/sdk';
import core = require('@colyseus/core');
import { ObjectId } from 'mongodb';
import express from 'express';
import type { Tile } from '../shared/WorldProtocol.ts';
import WorldRoom from '../js/server/WorldRoom.ts';
import { createGameServer } from '../js/server/createGameServer.ts';
import { CharacterStore } from '../js/server/CharacterStore.ts';
import type { CharacterSave } from '../js/server/WorldTypes.ts';
import { characterCollection } from './character-collection.ts';

import GameServer = require('../js/server/GameServer.ts');

const { defineRoom, matchMaker } = core;

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
  const saves = new Map<string, CharacterSave>();
  let pendingSave: Promise<unknown> | undefined;
  GameServer.characters = new CharacterStore(characterCollection({
    findOne: async ({ _id }: { _id: ObjectId }) => {
      const index = ids.indexOf(_id.toString());
      const save = saves.get(_id.toString());
      return index < 0 ? null : { _id, name: 'Scout' + index, x: '30', y: String(31 + index), weapon: 'sword1', armor: 'clotharmor', ...save };
    },
    updateOne: async ({ _id }, { $set }) => {
      await pendingSave;
      saves.set(_id.toString(), $set);
      return { matchedCount: 1 };
    },
  }));
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
    const messages: unknown[] = [];
    second.onMessage('chat', message => { messages.push(message); chat.resolve(message); });
    expect(await first.request('chat', 'Nearby')).toBe(true);
    expect(await chat.promise).toEqual({ id: firstPlayer, txt: 'Nearby' });
    expect(await first.request('chat', 'Too soon')).toBe(false);

    const player = GameServer.getPlayer(first.sessionId);
    if (!player) throw new Error('The first character did not enter');
    player.lastWalkUpdate = Date.now() + 5000;
    player.setRoute([{ x: 30, y: 31 }, { x: 31, y: 31 }, { x: 32, y: 31 }], Date.now(), 0, { action: 0 }, 3);
    player.x = 31;
    if (!player.route) throw new Error('The player route was not set');
    player.route.step = 1;
    GameServer.moveAtLocation(player, 30, 31, 31, 31);

    const corrected = Promise.withResolvers<unknown>();
    first.onMessage('reset', corrected.resolve);
    first.send('path', { path: [], action: { action: 0 }, or: 3 });
    expect(await corrected.promise).toEqual({
      x: 31, y: 31, route: { path: [{ x: 31, y: 31 }, { x: 32, y: 31 }], orientation: 3, elapsed: expect.any(Number) },
    });
    expect(messages).toEqual([{ id: firstPlayer, txt: 'Nearby' }]);

    const token = first.reconnectionToken;
    first.reconnection.enabled = false;
    await first.leave(false);
    const room = matchMaker.getLocalRoomById(roomId) as WorldRoom;
    for (let i = 0; i < 100 && room.state.online !== 1; i++) await Bun.sleep(10);
    expect(room.state.online).toBe(1);
    player.updatePacket.addKilled(7);
    room.broadcastPatch();
    const resumed = await sdk.reconnect<WorldRoom>(token);
    const updates: unknown[] = [];
    resumed.onMessage('playerEvents', update => updates.push(update));
    expect(resumed.sessionId).toBe(first.sessionId);
    expect(await ready(resumed)).toMatchObject({ x: 31, y: 31 });
    expect(await localPlayer(resumed)).toBe(firstPlayer);
    for (let i = 0; i < 100 && resumed.state.players.get(String(firstPlayer))?.routeOrientation !== 3; i++) {
      await Bun.sleep(10);
    }
    expect(resumed.state.players.get(String(firstPlayer))).toMatchObject({ routeOrientation: 3, x: 30 });
    for (let i = 0; i < 50 && !updates.length; i++) await Bun.sleep(10);
    expect(updates).toEqual([{ killed: [7] }]);
    await resumed.leave();
    const next = await sdk.join<WorldRoom>('world', { id: ids[0] });
    expect(next.sessionId).not.toBe(first.sessionId);
    expect(await ready(next)).toMatchObject({ x: 31, y: 31 });
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
    loaded.reconnection.enabled = false;
    await loaded.leave(false);
    for (let i = 0; i < 100 && room.state.online !== 0; i++) await Bun.sleep(10);
    expect(room.state.online).toBe(0);
    const finalSave = Promise.withResolvers<void>();
    pendingSave = finalSave.promise;
    const closing = room.disconnect();
    try {
      const closedEarly = await Promise.race([closing.then(() => true), Bun.sleep(100).then(() => false)]);
      expect(closedEarly).toBe(false);
    } finally {
      finalSave.resolve();
      await closing;
    }
  } finally {
    await server.gracefullyShutdown(false);
  }
}, 18000);
