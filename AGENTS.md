# Repository Guidelines

## Project Structure and Module Organization

- `index.html` loads the local Phaser scripts. `src/entry-game.js` registers the Home and Game states, and `src/Client.js` handles Socket.IO events.
- `phaser4.html` runs the Phaser 4 preview from `src/phaser4/` using the same game server.
- `server.js` starts Express, Socket.IO, and MongoDB. `js/server/GameServer.js` runs the world simulation and persists characters. Server entities and update packets also live in `js/server/`.
- `shared/` contains the binary protocol schemas, area-of-interest helpers, and spatial map used by both client and server.
- `assets/` holds maps, entity definitions, sprite atlases, tilesets, audio, and fonts. Keep generated `dist/` output out of commits.

## Build and Development Commands

Use Bun 1.3.10 or newer and a running MongoDB instance.

- `bun install --frozen-lockfile` installs the versions recorded in `bun.lock`.
- `bun run dev` starts the game at `http://127.0.0.1:8081`, with Vite client reloads and Bun server restarts.
- `bun run build` bundles the browser client into `dist/`.
- `bun run typecheck` checks the TypeScript modules.
- `bun run start` serves the production bundle after a build.

For database and port overrides, see the [README](README.md). Use a separate database for character tests, for example `MONGODB_DB=phaserQuest_smoke bun run dev`.

## Coding Style and Naming

Use two-space indentation, single quotes, and semicolons. Use camelCase for functions and variables and PascalCase for classes and their files, such as `Player.js`. Use ES modules in `src/` and `shared/` and CommonJS in the server. The legacy `src/.eslintrc.js` references Airbnb Base, and the current package defines no lint command.

## Testing Guidelines

Run `bun test` to verify that the client decodes a world update encoded by the server using the schemas in `shared/CoDec.ts`. Run `bun run typecheck` for TypeScript changes. Run `bun run build` and play the affected flow in a browser. For a basic smoke test, create a character, click to move, then reload and rejoin with that character. For multiplayer edits, use two separate browser profiles.

## Commits and Pull Requests

Use short, descriptive commit subjects, following examples such as `Update README.md` and `correct plugin add`. In pull requests, describe the change and how you verified it, link related issues when available, and include screenshots for visible changes.
