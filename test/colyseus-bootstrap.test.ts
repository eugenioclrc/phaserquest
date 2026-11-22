import { expect, test } from 'bun:test';
import { createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { Client } from '@colyseus/sdk';
import { Room, defineRoom, matchMaker } from '@colyseus/core';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { createGameServer } from '../js/server/createGameServer.ts';

class ProbeRoom extends Room {
  autoDispose = false;

  messages = {
    echo: (_client: unknown, text: string) => text,
  };
}

test('Express and Colyseus share a listener with one persistent room', async () => {
  const app = express();
  app.get('/health', (_req, res) => res.send('ok'));
  const http = createServer(app);
  const vite = await createViteServer({
    configFile: false,
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, ws: { server: http } },
  });
  app.use(vite.middlewares);
  const server = createGameServer(http, { probe: defineRoom(ProbeRoom) });
  let hmr: WebSocket | undefined;
  try {
    await server.listen(0, '127.0.0.1');
    const endpoint = 'http://127.0.0.1:' + (http.address() as AddressInfo).port;
    const client = new Client(endpoint);
    hmr = new WebSocket(endpoint.replace('http:', 'ws:') + '/?token=' + vite.config.webSocketToken, 'vite-hmr');
    const hmrReady = new Promise((resolve, reject) => {
      hmr!.addEventListener('message', ({ data }) => resolve(JSON.parse(data).type), { once: true });
      hmr!.addEventListener('error', reject, { once: true });
    });
    expect(await hmrReady).toBe('connected');
    expect(await fetch(endpoint + '/health').then(response => response.text())).toBe('ok');
    await expect(client.join('probe')).rejects.toThrow();
    await expect(client.joinOrCreate('probe')).rejects.toThrow();

    const { roomId } = await matchMaker.createRoom('probe', {});
    const room = await client.join('probe');
    expect(room.roomId).toBe(roomId);
    expect(await room.request('echo', 'hello')).toBe('hello');
    await room.leave();
    const next = await client.join('probe');
    expect(next.roomId).toBe(roomId);
    await next.leave();
  } finally {
    hmr?.close();
    await vite.close();
    await server.gracefullyShutdown(false);
  }
  expect(http.listening).toBe(false);
});
