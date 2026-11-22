# phaserquest

Phaser Quest is a reproduction of Mozilla's [Browserquest](http://browserquest.mozilla.org/) using the following tools:
- [Phaser 4](https://phaser.io/) for the client
- [Socket.IO](https://socket.io/) and [Bun](https://bun.sh/) for the server and client-server communication

## Run locally

Install Bun 1.3.10 or newer and start MongoDB. Then run:

```sh
bun install --frozen-lockfile
bun run dev
```

Open [http://127.0.0.1:8081](http://127.0.0.1:8081). Vite reloads the browser when client code changes, and Bun restarts the game server when server code changes. Both use the same port.

Create or load a character to explore the map and chat with nearby players. Existing character saves still work, and bookmarks to `/phaser4.html` redirect to `/`. Run `bun run typecheck` to check the TypeScript modules and `bun test` to verify the binary protocol.

MongoDB defaults to `mongodb://127.0.0.1:27017` and the `phaserQuest` database. Set `MONGODB_URI` or `MONGODB_DB` to change those settings. Set `PORT` to change the HTTP port and `HOST` to change the bind address. Development binds to `127.0.0.1` by default. The existing `-p` and `--mongoPort` options also work, for example `bun run dev -p 8082 --mongoPort 27018`.

## Production

```sh
bun run build
bun run start
```

The build writes the browser bundle to `dist/`. The game server serves the bundle and the game assets alongside Socket.IO. Keep `dist/`, `assets/`, `shared/`, and the server code together when deploying. After building, runtime dependencies can be installed with `bun install --frozen-lockfile --production`.

## Code layout

- `index.html` loads the Phaser 4 client from `src/phaser4/`. `WorldScene.ts` handles gameplay rendering and input, `main.ts` connects the browser controls, and `connection.ts` exchanges updates with the server.
- `src/Decoder.ts` decodes server updates using the schemas in `shared/CoDec.ts`.
- `server.js` starts HTTP, Socket.IO, and MongoDB. `js/server/GameServer.js` runs the world simulation and persists characters.

## Further documentation

I have written and will keep writing articles about some development aspects of the game. The full list of existing articles is available [here](http://www.dynetisgames.com/tag/phaser-quest/).

Here is the detail of the topics covered so far:
- [Clients synchronization](http://www.dynetisgames.com/2017/03/19/client-updates-phaser-quest/)
- [Latency estimation](http://www.dynetisgames.com/2017/03/19/latency-estimation-phaser-quest/)
- [Interest management](http://www.dynetisgames.com/2017/03/19/latency-estimation-phaser-quest/) (the "AOI" stuff you might encounter in the code)
