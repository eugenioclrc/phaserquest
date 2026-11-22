const { access } = require('node:fs/promises');
const { createServer } = require('node:http');
const { join } = require('node:path');
const { parseArgs } = require('node:util');
const express = require('express');
const { Server } = require('socket.io');
const { MongoClient } = require('mongodb');

const { CharacterStore, characterId } = require('./js/server/CharacterStore.js');
const gs = require('./js/server/GameServer.js').GameServer;
const { Player } = require('./js/server/Player.js');
const { CoDec } = require('./shared/CoDec.ts');
const Encoder = require('./js/server/Encoder.ts');

const { values: options } = parseArgs({
  options: {
    dev: { type: 'boolean' },
    port: { type: 'string', short: 'p' },
    mongoPort: { type: 'string', default: '27017' },
  },
});

const app = express();
const server = createServer(app);
const io = new Server(server, {
  serveClient: false,
  destroyUpgrade: !options.dev, // Let Vite handle its own WebSocket upgrades on the dev server.
});
server.enableBinary = true;
gs.server = server;

app.use('/api/characters', express.json({ limit: '4kb' }));
app.post('/api/characters', async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!name || name.length > 20) return res.sendStatus(400);
  if (!gs.mapReady) return res.sendStatus(503);
  try {
    const id = characterId(req.body.id);
    res.json({ id: await gs.characters.create(id, new Player(name).dbTrim()) });
  } catch (error) {
    res.sendStatus(characterStatus(error));
  }
});
app.post('/api/characters/delete', async (req, res) => {
  try {
    res.json({ ok: await gs.characters.delete(req.body?.id) });
  } catch (error) {
    res.sendStatus(characterStatus(error));
  }
});

function characterStatus(error) {
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
  gs.characters = new CharacterStore(mongo.db(process.env.MONGODB_DB || 'phaserQuest').collection('players'));

  if (options.dev) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      root: __dirname,
      server: { middlewareMode: true, ws: { server } },
    });
    app.use(vite.middlewares);
  }

  server.clientUpdateRate = 1000 / 5;
  gs.readMap();
  server.setUpdateLoop();
  const port = Number(options.port ?? process.env.PORT ?? 8081);
  const host = process.env.HOST || (options.dev ? '127.0.0.1' : undefined);
  server.listen(port, host, () => {
    console.log('PhaserQuest listening at http://' + (host || 'localhost') + ':' + server.address().port);
  });
}

io.on('connection', (socket) => {
  console.log(`connection widht ID ${socket.id}`);
  console.log(`${server.getNbConnected()} already connected`);
  socket.pings = [];
  socket.latency = 0;
  let initializing = false;

  socket.on('ponq', (sentStamp) => {
        // Compute a running estimate of the latency of a client each time an interaction takes place between client and server
        // The running estimate is the median of the last 20 sampled values
    const ss = server.getShortStamp();
    let delta = (ss - sentStamp) / 2;
    if (delta < 0) delta = 0;
    socket.pings.push(delta); // socket.pings is the list of the 20 last latencies
    if (socket.pings.length > 20) socket.pings.shift(); // keep the size down to 20
    const sortedPings = socket.pings.toSorted((a, b) => a - b);
    socket.latency = sortedPings[Math.floor((sortedPings.length - 1) / 2)];
  });

  socket.on('init-world', async (data) => {
    if (!data || initializing || !gs.checkSocketID(socket.id)) return;
    if (!gs.mapReady) {
      socket.emit('wait');
      return;
    }
    initializing = true;
    try {
      const player = await gs.loadPlayer(socket.id, data.id, () => socket.connected);
      if (player) server.sendInitializationPacket(socket, gs.createInitializationPacket(player.id));
    } catch (error) {
      if (socket.connected) socket.emit('dbError', { code: error.code ?? 'unavailable' });
    } finally {
      initializing = false;
    }
  });

  socket.on('revive', () => {
    gs.revivePlayer(gs.getPlayerID(socket.id));
  });

  socket.on('path', (data) => {
    if (!gs.handlePath(socket.id, data, socket.latency)) socket.emit('reset', gs.getCurrentPosition(socket.id));
  });

  socket.on('chat', (txt) => {
    if (typeof txt !== 'string' || !txt.trim() || txt.length > 300) return;
    const sender = gs.getPlayer(socket.id);
    if (!sender) return;
    const nearbyAreas = sender.listAdjacentAOIs(true);
    for (const player of Object.values(gs.players)) {
      if (player !== sender && nearbyAreas.includes(player.aoi)) {
        io.to(player.socketID).emit('chat', { id: sender.id, txt });
      }
    }
  });

  socket.on('disconnect', () => {
    console.log(`Disconnection widht ID ${socket.id}`);
    if (gs.getPlayer(socket.id)) gs.removePlayer(socket.id);
  });
});

server.setUpdateLoop = function () {
  setInterval(gs.updatePlayers, server.clientUpdateRate);
};

server.sendInitializationPacket = function (socket, packet) {
  packet = server.addStamp(packet);
  if (server.enableBinary) packet = Encoder.encode(packet, CoDec.initializationSchema);
  socket.emit('init', packet);
};

server.sendUpdate = function (socketID, pkg) {
  pkg = server.addStamp(pkg);
  pkg.latency = Math.floor(io.sockets.sockets.get(socketID)?.latency ?? 0);
  if (server.enableBinary) pkg = Encoder.encode(pkg, CoDec.finalUpdateSchema);
  if (pkg) io.in(socketID).emit('update', pkg);
};

server.getNbConnected = function () {
  return Object.keys(gs.players).length;
};

server.addStamp = function (pkg) {
  pkg.stamp = server.getShortStamp();
  return pkg;
};

server.getShortStamp = function () {
  return parseInt(Date.now().toString().substr(-9));
};

start().catch((err) => {
  console.error('PhaserQuest could not start.', err.message);
  process.exit(1);
});
