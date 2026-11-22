# phaserquest

Phaser Quest is a reproduction of Mozilla's [Browserquest](http://browserquest.mozilla.org/) using the following tools:
- The [Phaser](https://phaser.io/) framework for the client 
- [Socket.io](http://socket.io/) and [Node.js](https://nodejs.org/en/) for the server and client-server communication

## Run locally

Install Bun 1.3.10 or newer and start MongoDB. Then run:

```sh
bun install --frozen-lockfile
bun run dev
```

Open [http://127.0.0.1:8081](http://127.0.0.1:8081). Vite reloads the browser when client code changes, and Bun restarts the game server when server code changes. Both use the same port.

MongoDB defaults to `mongodb://127.0.0.1:27017` and the `phaserQuest` database. Set `MONGODB_URI` or `MONGODB_DB` to change those settings. Set `PORT` to change the HTTP port and `HOST` to change the bind address. Development binds to `127.0.0.1` by default. The existing `-p` and `--mongoPort` options also work, for example `bun run dev -p 8082 --mongoPort 27018`.

## Production

```sh
bun run build
bun run start
```

The build writes the browser bundle to `dist/`. The game server serves the bundle and the game assets alongside Socket.IO. Keep `dist/`, `assets/`, and the server code together when deploying. After building, runtime dependencies can be installed with `bun install --frozen-lockfile --production`.

## Code layout

- `src/entry-game.js` registers the Phaser home and gameplay states.
- `src/Game.js` handles gameplay rendering and input. `src/Client.js` exchanges updates with the server.
- `server.js` starts HTTP, Socket.IO, and MongoDB. `js/server/GameServer.js` runs the world simulation and persists characters.

## Further documentation

I have written and will keep writing articles about some development aspects of the game. The full list of existing articles is available [here](http://www.dynetisgames.com/tag/phaser-quest/).

Here is the detail of the topics covered so far:
- [Clients synchronization](http://www.dynetisgames.com/2017/03/19/client-updates-phaser-quest/)
- [Latency estimation](http://www.dynetisgames.com/2017/03/19/latency-estimation-phaser-quest/)
- [Interest management](http://www.dynetisgames.com/2017/03/19/latency-estimation-phaser-quest/) (the "AOI" stuff you might encounter in the code)
