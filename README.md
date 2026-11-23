# phaserquest

Phaser Quest is a reproduction of Mozilla's [Browserquest](http://browserquest.mozilla.org/) using the following tools:
- [Phaser 4](https://phaser.io/) for the client
- [Colyseus](https://colyseus.io/framework/) and [Bun](https://bun.sh/) for the server and client-server communication

## Run locally

Install Bun 1.3.10 or newer and start MongoDB. If you installed MongoDB with Homebrew on Apple Silicon, start it in a separate terminal with this command.

```sh
mongod --config /opt/homebrew/etc/mongod.conf
```

From the project directory, run:

```sh
bun install --frozen-lockfile
bun run dev
```

Open [http://127.0.0.1:8081](http://127.0.0.1:8081). Vite reloads the browser when client code changes, and Bun restarts the game server when server code changes. Both use the same port.

Create or load a character to explore the map and chat with nearby players. Existing character saves still work, and bookmarks to `/phaser4.html` redirect to `/`. Run `bun run typecheck` to check the TypeScript modules and `bun test` to verify room lifecycle, commands, character persistence and visibility. The room tests use local ephemeral ports.

MongoDB defaults to `mongodb://127.0.0.1:27017` and the `phaserQuest` database. Set `MONGODB_URI` or `MONGODB_DB` to change those settings. Set `PORT` to change the HTTP port and `HOST` to change the bind address. Development binds to `127.0.0.1` by default. The existing `-p` and `--mongoPort` options also work, for example `bun run dev -p 8082 --mongoPort 27018`.

## Production

```sh
bun run build
bun run start
```

The build writes the browser bundle to `dist/`. The game server serves the bundle and the game assets alongside the Colyseus WebSocket endpoint. Keep `dist/`, `assets/`, `shared/`, and the server code together when deploying. After building, runtime dependencies can be installed with `bun install --frozen-lockfile --production`.

Behind a reverse proxy, set `TRUST_PROXY_HOPS` to the number of trusted proxies between the client and the server so the character API counts requests per client. The default is `0` for direct connections. Only use a positive count when every incoming connection traverses that many trusted proxies.

## Code layout

- `index.html` loads the Phaser 4 client from `src/`. `WorldScene.ts` handles gameplay rendering and input, `main.ts` connects the browser controls, and `connection.ts` exchanges updates with the server.
- `server.ts` starts HTTP, MongoDB and one persistent Colyseus room named `world`.
- `js/server/GameServer.ts` runs the simulation. `js/server/WorldRoom.ts` manages sessions and uses `js/server/WorldState.ts` to synchronize nearby entities and each player's own health. `js/server/CharacterStore.ts` reads and writes MongoDB saves.

## Deploy or roll back

Deploy the server and browser build from the same revision. Run one game server against the character database at a time. To roll back, stop the running server and start the previous server with its matching browser build and the same MongoDB collection. Both versions read the existing player documents.

## Further documentation

I have written and will keep writing articles about some development aspects of the game. The full list of existing articles is available [here](http://www.dynetisgames.com/tag/phaser-quest/).

Here is the detail of the topics covered so far:
- [Clients synchronization](http://www.dynetisgames.com/2017/03/19/client-updates-phaser-quest/)
- [Latency estimation](http://www.dynetisgames.com/2017/03/19/latency-estimation-phaser-quest/)
- [Interest management](http://www.dynetisgames.com/2017/03/19/latency-estimation-phaser-quest/) (the "AOI" stuff you might encounter in the code)
