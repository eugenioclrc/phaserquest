import type { Server as HttpServer } from 'node:http';
import { defineServer, matchMaker, type RegisteredHandler } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';

export function createGameServer<T extends Record<string, RegisteredHandler>>(http: HttpServer, rooms: T) {
  const transport = new WebSocketTransport({ noServer: true });
  transport.attachToServer(http, {
    filter: request => !['vite-hmr', 'vite-ping'].includes(request.headers['sec-websocket-protocol'] ?? ''),
  });
  matchMaker.controller.exposedMethods = ['join', 'reconnect'];
  const server = defineServer({ rooms, transport, greet: false, gracefullyShutdown: false });
  server.onShutdown(() => {
    http.close();
    http.closeAllConnections();
  });
  return server;
}
