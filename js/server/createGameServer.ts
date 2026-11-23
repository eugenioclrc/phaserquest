import type { Server as HttpServer } from 'node:http';
import core = require('@colyseus/core');
import ws = require('@colyseus/ws-transport');

function createGameServer<T extends Record<string, core.RegisteredHandler>>(http: HttpServer, rooms: T) {
  const transport = new ws.WebSocketTransport({ noServer: true });
  transport.attachToServer(http, {
    filter: request => !['vite-hmr', 'vite-ping'].includes(request.headers['sec-websocket-protocol'] ?? ''),
  });
  Object.assign(core.matchMaker.controller, {
    exposedMethods: ['join', 'reconnect'],
    DEFAULT_CORS_HEADERS: {},
    getCorsHeaders: () => ({}),
  });
  const server = core.defineServer({ rooms, transport, greet: false, gracefullyShutdown: false });
  server.onShutdown(() => {
    http.close();
    http.closeAllConnections();
  });
  return server;
}

export = { createGameServer };
