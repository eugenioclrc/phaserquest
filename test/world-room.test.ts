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
    const first = await sdk.join('world', { id: ids[0] });
    const second = await sdk.join('world', { id: ids[1] });
    expect(first.roomId).toBe(roomId);
    expect(second.roomId).toBe(first.roomId);

    const initial = Promise.withResolvers<{ player: { id: number } }>();
    first.onMessage('init', initial.resolve);
    const secondInitial = Promise.withResolvers<unknown>();
    second.onMessage('init', secondInitial.resolve);
    first.send('ready');
    second.send('ready');
    const [{ player }] = await Promise.all([initial.promise, secondInitial.promise]);
    const duplicate = await sdk.join('world', { id: ids[0] });
    const rejected = Promise.withResolvers<number>();
    duplicate.onMessage('entryError', rejected.resolve);
    duplicate.send('ready');
    expect(await rejected.promise).toBe(4409);
    await duplicate.leave();
    const chat = Promise.withResolvers<unknown>();
    second.onMessage('chat', chat.resolve);
    first.send('chat', 'Nearby');
    expect(await chat.promise).toEqual({ id: player.id, txt: 'Nearby' });

    const token = first.reconnectionToken;
    first.reconnection.enabled = false;
    await first.leave(false);
    const resumed = await sdk.reconnect(token);
    expect(resumed.sessionId).toBe(first.sessionId);
    const snapshot = Promise.withResolvers<{ player: { id: number } }>();
    resumed.onMessage('init', snapshot.resolve);
    resumed.send('ready');
    expect((await snapshot.promise).player.id).toBe(player.id);
    await resumed.leave();
    const next = await sdk.join('world', { id: ids[0] });
    expect(next.sessionId).not.toBe(first.sessionId);
    const nextInitial = Promise.withResolvers<unknown>();
    next.onMessage('init', nextInitial.resolve);
    next.send('ready');
    await nextInitial.promise;
    await next.leave();
    await second.leave();
  } finally {
    await server.gracefullyShutdown(false);
  }
});
