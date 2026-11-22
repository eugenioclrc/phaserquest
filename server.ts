import pm2 = require('@pm2/io');
import fs = require('node:fs/promises');
import http = require('node:http');
import path = require('node:path');
import util = require('node:util');
import express = require('express');
import mongoDriver = require('mongodb');
import characters = require('./js/server/CharacterStore.ts');
import gs = require('./js/server/GameServer.ts');
import Player = require('./js/server/Player.ts');
import type { CharacterDocument } from './js/server/WorldTypes.ts';
import type { ViteDevServer } from 'vite';

// PM2's V8 compatibility probes scan the Bun heap on each metrics refresh.
pm2.init({ metrics: { v8: false } });

const { access } = fs;
const { createServer } = http;
const { join } = path;
const { parseArgs } = util;
const { MongoClient } = mongoDriver;
const { CharacterStore, CharacterError, characterId } = characters;
const { values: options } = parseArgs({
  options: {
    dev: { type: 'boolean' },
    port: { type: 'string', short: 'p' },
    mongoPort: { type: 'string', default: '27017' },
  },
});

const app = express();
const server = createServer(app);
app.use('/api/characters', express.json({ limit: '4kb' }));
app.post('/api/characters', async (req, res) => {
  const body: { id?: unknown; name?: unknown } | null | undefined = req.body;
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 20) return res.sendStatus(400);
  if (!gs.mapReady) return res.sendStatus(503);
  try {
    const id = characterId(body?.id);
    res.json({ id: await gs.characters.create(id, new Player(gs, name).dbTrim()) });
  } catch (error) {
    res.sendStatus(characterStatus(error));
  }
});
app.post('/api/characters/delete', async (req, res) => {
  try {
    const body: { id?: unknown } | null | undefined = req.body;
    res.json({ ok: await gs.characters.delete(body?.id) });
  } catch (error) {
    res.sendStatus(characterStatus(error));
  }
});

function characterStatus(error: unknown) {
  if (!(error instanceof CharacterError)) return 503;
  if (error.code === 'missing') return 400;
  if (error.code === 'busy') return 409;
  return 503;
}

app.use('/assets', express.static(join(__dirname, 'assets')));
app.get('/phaser4.html', (req, res) => {
  res.redirect('/');
});

async function start() {
  const dist = join(__dirname, 'dist');
  if (!options.dev) {
    await access(join(dist, 'index.html')).catch(() => {
      throw new Error('Run bun run build before bun run start.');
    });
    app.use(express.static(dist));
  }

  const mongo = new MongoClient(process.env.MONGODB_URI || 'mongodb://127.0.0.1:' + options.mongoPort, {
    serverSelectionTimeoutMS: 5000,
  });
  await mongo.connect();
  gs.characters = new CharacterStore(mongo.db(process.env.MONGODB_DB || 'phaserQuest').collection<CharacterDocument>('players'));

  let vite: ViteDevServer | undefined;
  if (options.dev) {
    const { createServer: createViteServer } = await import('vite');
    vite = await createViteServer({
      root: __dirname,
      server: { middlewareMode: true, ws: { server } },
    });
    app.use(vite.middlewares);
  }

  await gs.readMap();
  const { defineRoom, matchMaker } = await import('@colyseus/core');
  const { createGameServer } = await import('./js/server/createGameServer.ts');
  const { WorldRoom } = await import('./js/server/WorldRoom.ts');
  const gameServer = createGameServer(server, { world: defineRoom(WorldRoom) });
  gameServer.onBeforeShutdown(async () => {
    await vite?.close();
  });
  const port = Number(options.port ?? process.env.PORT ?? 8081);
  const host = process.env.HOST || (options.dev ? '127.0.0.1' : undefined);
  await gameServer.listen(port, host);
  await matchMaker.createRoom('world', {});
  const address = server.address();
  if (address && typeof address !== 'string') {
    console.log('PhaserQuest listening at http://' + (host || 'localhost') + ':' + address.port);
  }

  let stopping = false;
  async function shutdown() {
    if (stopping) return;
    stopping = true;
    try {
      await gameServer.gracefullyShutdown(false);
    } finally {
      await mongo.close();
    }
    // Bun may keep transport handles alive after the listeners close.
    process.exit(0);
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start().catch((err) => {
  console.error('PhaserQuest could not start.', err instanceof Error ? err.message : err);
  process.exit(1);
});
