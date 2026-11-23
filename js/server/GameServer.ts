import fs = require('node:fs');
import path = require('node:path');
import PF = require('pathfinding');
import choose = require('random-weighted-choice');
import spatial = require('../../shared/SpaceMap.ts');
import spatialAreas = require('../../shared/AOIutils.ts');
import AOI = require('./AOI.ts');
import ChestArea = require('./ChestArea.ts');
import type characters = require('./CharacterStore.ts');
import type GameObject = require('./GameObject.ts');
import Item = require('./Item.ts');
import Monster = require('./Monster.ts');
import type MovingEntity = require('./MovingEntity.ts');
import Player = require('./Player.ts');
import protocol = require('../../shared/WorldProtocol.ts');
import type { MovementCorrection, PathCommand, Tile } from '../../shared/WorldProtocol.ts';
import type {
  ChestContents, Door, EntityDefinition, ItemDefinition, LootChoice, MonsterDefinition, TiledMap, TiledObject,
} from './WorldTypes.ts';

const { SpaceMap } = spatial;
const { AOIutils } = spatialAreas;
const assetsDir = path.join(__dirname, '..', '..', 'assets');
const { maxClickDistance, maxPathLength } = protocol;
const clickOffsets = [[0, 0], [-1, 0], [0, -1], [1, 0], [0, 1]];

class GameSimulation {
  readonly changedEntities = new Set<GameObject>();
  readonly changedAreas = new Set<number>();
  mapReady = false;
  updateRate = 1000 / 12;
  regenRate = 2000;
  itemRespawnDelay = 30000;
  monsterRespawnDelay = 30000;
  itemVanishDelay = 9000;
  retryDelay = 3000;
  walkUpdateDelay = 80;
  fightUpdateDelay = 200;
  damageDelay = 1000;
  positionCheckDelay = 1000;
  lastItemID = 0;
  lastMonsterID = 0;
  lastPlayerID = 0;
  readonly players: Record<number, Player> = {};
  readonly sessionMap: Record<string, number> = Object.create(null);
  characters!: InstanceType<typeof characters.CharacterStore>;
  schedule!: (callback: () => void, delay: number) => void;
  map!: TiledMap;
  db!: {
    items: Record<string, ItemDefinition>;
    monsters: Record<string, MonsterDefinition>;
    entities: Record<number, EntityDefinition>;
    itemsIDmap: Record<number, string>;
  };
  objects: Record<string, TiledObject[]> = {};
  layers: number[][] = [];
  tilesets: Record<string, Record<number, Record<string, unknown>>> = {};
  AOIs: Record<number, AOI> = {};
  aoiFromTiles = new SpaceMap<AOI>();
  collisionGrid: number[][] = [];
  PFgrid!: PF.Grid;
  pathfinder!: PF.AStarFinder;
  doors = new SpaceMap<Door>();
  playersMap = new SpaceMap<Player>();
  items = new SpaceMap<Item>();
  monsters = new SpaceMap<Monster>();
  monstersTable: Record<number, Monster> = {};

  getPlayer(sessionId: string): Player | undefined {
    return this.players[this.sessionMap[sessionId]];
  }

  // Create a map between the numerical id's and the string id's of elements of a collection
  makeIDmap(collection: Record<string, { id: number }>, map: Record<number, string>) {
    Object.keys(collection).forEach((key) => {
      const e = collection[key];
      map[e.id] = key;
    });
  }

  // =========================
  // Code related to reading map and setting up world

  async readMap(): Promise<void> {
    const definitions = JSON.parse(fs.readFileSync(path.join(assetsDir, 'json/db.json'), 'utf8')) as
      Pick<GameSimulation['db'], 'items' | 'monsters'>;
    const entities = JSON.parse(fs.readFileSync(path.join(assetsDir, 'json/entities_server.json'), 'utf8')) as Record<number, EntityDefinition>;
    const clientEntities = JSON.parse(fs.readFileSync(path.join(assetsDir, 'json/entities_client.json'), 'utf8')) as Record<number, EntityDefinition>;
    this.db = { ...definitions, entities: Object.assign(entities, clientEntities), itemsIDmap: {} };
    this.makeIDmap(this.db.items, this.db.itemsIDmap);

    const data = await fs.promises.readFile(path.join(assetsDir, 'maps/minimap_server.json'), 'utf8');
    this.lastItemID = 0;
    this.lastMonsterID = 0;
    this.lastPlayerID = 0;
    this.changedEntities.clear();
    this.changedAreas.clear();
    this.map = JSON.parse(data) as TiledMap;
    this.objects = {};
    this.layers = [];
    this.tilesets = {};

    for (let l = 0; l < this.map.layers.length; l++) {
      const layer = this.map.layers[l];
      if (layer.type == 'objectgroup') {
        this.objects[layer.name] = layer.objects;
      } else if (layer.type == 'tilelayer') {
        this.layers.push(layer.data);
      }
    }
    for (let t = 0; t < this.map.tilesets.length; t++) {
      const tileset = this.map.tilesets[t];
      this.tilesets[tileset.name] = tileset.tileproperties;
    }

    // Iterate over all tiles and populate the AOI and collision grids.
    const { tileWidth, tileHeight } = AOIutils;
    AOIutils.nbAOIhorizontal = Math.ceil(this.map.width / tileWidth);
    AOIutils.lastAOIid = 0;
    this.AOIs = {};
    this.aoiFromTiles = new SpaceMap<AOI>();
    this.collisionGrid = [];
    for (let y = 0; y < this.map.height; y++) {
      const col = [];
      for (let x = 0; x < this.map.width; x++) {
        if (x % tileWidth == 0 && y % tileHeight == 0) {
          const area = new AOI(x, y, tileWidth, tileHeight);
          this.AOIs[area.id] = area;
        }
        this.aoiFromTiles.add(x, y, this.AOIs[AOIutils.idFromCoords(x, y)]);

        // The tileset marks blocked tiles with the "c" property.
        let collide = false;
        for (const layer of this.layers) {
          const tile = layer[y * this.map.width + x];
          if (tile) {
            const tileProperties = this.tilesets.tilesheet[tile - 1];
            if (tileProperties?.hasOwnProperty('c')) {
              collide = true;
              break;
            }
          }
        }
        col.push(+collide); // "+" to convert boolean to int
      }
      this.collisionGrid.push(col);
    }
    this.setUpDoors();
    this.setUpEntities();
    this.PFgrid = new PF.Grid(this.collisionGrid);
    this.pathfinder = new PF.AStarFinder();
    this.setUpChests();
    this.setUpRoaming();
    console.log('Map read');
    this.mapReady = true;
  }

  setUpDoors() { // Set up teleports
    this.doors = new SpaceMap<Door>();
    for (let d = 0; d < this.objects.doors.length; d++) {
      const door = this.objects.doors[d];
      const position = this.computeTileCoords(door.x, door.y);
      this.doors.add(position.x, position.y, {
        to: { x: Number(door.properties.x), y: Number(door.properties.y) },
        camera: (door.properties.hasOwnProperty('cx') ?
              { x: door.properties.cx, y: door.properties.cy }
                  : null),
        orientation: door.properties.o,
      });
    }
  }

  setUpEntities() { // Set up monsters & items
    this.playersMap = new SpaceMap<Player>();
    this.items = new SpaceMap<Item>();
    this.monsters = new SpaceMap<Monster>();
    this.monstersTable = {};
    for (let d = 0; d < this.objects.entities.length; d++) {
      const entity = this.objects.entities[d];
      if (entity.gid === undefined) continue;
      const entityInfo = this.db.entities[entity.gid - 1961];
      if (!entityInfo) continue;
      const position = this.computeTileCoords(entity.x, entity.y);
      if (entityInfo.npc) {
        this.collisionGrid[position.y][position.x] = 1;
      } else if (entityInfo.item) {
        const item = new Item(this, position.x, position.y - 1, entityInfo.sprite, true, false, false); // respawn, not chest, not loot
        this.addAtLocation(item);
      } else if (entityInfo.monster) {
        this.addMonster(position, entityInfo.sprite);
      }
    }
  }

  addMonster(position: Tile, sprite: string) { // Create a monster object and add it to all relevant data structures
    const definition = this.db.monsters[sprite];
    if (!definition) {
      console.error(`WARNING : undefined data for monster : ${sprite}`);
      return;
    }
    const monster = new Monster(this, position, definition);
    this.monstersTable[monster.id] = monster;
    this.addAtLocation(monster);
  }

  setUpChests() { // Sets up chests and chest areas
    for (let d = 0; d < this.objects.chests.length; d++) {
      const source = this.objects.chests[d];
      const position = this.computeTileCoords(source.x, source.y);
      const chest = new Item(this, position.x, position.y, source.properties.items, true, true, false); // respawn, chest, not loot
      this.addAtLocation(chest);
    }

    // A chest spawns when all monsters in its area die.
    for (let d = 0; d < this.objects.chestareas.length; d++) {
      const area = this.objects.chestareas[d];
      const { x, y, items } = area.properties;
      const chestarea = new ChestArea({ x: Number(x), y: Number(y), items }, contents => this.spawnHiddenChest(contents));
      const topleft = this.computeTileCoords(area.x, area.y);
      const bottomright = this.computeTileCoords(area.x + area.width, area.y + area.height);
      for (let x = topleft.x; x < bottomright.x; x++) {
        for (let y = topleft.y; y < bottomright.y; y++) {
          const monster = this.monsters.getFirst(x, y);
          if (monster) {
            monster.chestArea = chestarea;
            chestarea.incrementAll();
          }
        }
      }
    }
  }

  setUpRoaming() { // Sets up packs of randomly positioned monsters within an area
    for (let d = 0; d < this.objects.roaming.length; d++) {
      const roaming = this.objects.roaming[d];
      const { tilewidth, tileheight } = this.map;
      const endX = Math.ceil((roaming.x + roaming.width) / tilewidth);
      const endY = Math.ceil((roaming.y + roaming.height) / tileheight);
      const positions: Tile[] = [];
      for (let y = Math.floor(roaming.y / tileheight); y < endY; y++) {
        for (let x = Math.floor(roaming.x / tilewidth); x < endX; x++) {
          if (this.collisionGrid[y]?.[x] === 0 && !this.monsters.getFirst(x, y)) positions.push({ x, y });
        }
      }
      for (let i = 0; i < Number(roaming.properties.nb) && positions.length; i++) {
        const index = this.randomInt(0, positions.length);
        const position = positions[index];
        positions[index] = positions[positions.length - 1];
        positions.pop();
        this.addMonster(position, roaming.type);
      }
    }
  }

  async loadPlayer(sessionId: string, id: unknown, isConnected: () => boolean): Promise<Player | null> {
    const document = await this.characters.open(id);
    const mongoId = document._id.toString();
    if (!isConnected()) {
      await this.characters.close(mongoId);
      return null;
    }
    try {
      const player = new Player(this);
      player.setIDs(mongoId);
      player.getDataFromDb(document);
      this.embedPlayer(player);
      this.sessionMap[sessionId] = player.id;
      return player;
    } catch (error) {
      await this.characters.close(mongoId);
      throw error;
    }
  }

  embedPlayer(player: Player) {
    // Add the player to all the relevant data structures
    this.players[player.id] = player;
    this.addAtLocation(player);
    player.setLastSavedPosition();
  }

  async savePlayer(player: Player): Promise<void> {
    const document = player.dbTrim();
    if (await this.characters.save(player.getMongoID(), document)) {
      player.lastSavedPosition = { x: document.x, y: document.y };
    }
  }

  async removePlayer(sessionId: string): Promise<void> {
    const player = this.getPlayer(sessionId);
    if (!player) return;
    const { x, y } = player.alive ? player.lastOutdoorPosition ?? player : player.lastSavedPosition;
    this.removeFromLocation(player);
    player.die();
    delete this.players[player.id];
    delete this.sessionMap[sessionId];
    await this.characters.close(player.getMongoID(), { ...player.dbTrim(), x, y });
  }

  // ==================================
  // Code related to managing the position of the game objects in the world

  getSpaceMap(entity: GameObject): spatial.SpaceMap<GameObject> {
    // Get the spatial data structure corresponding to the kind of entity  you want to deal with
    switch (entity.category) {
      case 'item':
        return this.items;
      case 'player':
        return this.playersMap;
      case 'monster':
        return this.monsters;
    }
  }

  areaAt(x: number, y: number): AOI {
    const area = this.aoiFromTiles.getFirst(x, y);
    if (!area) throw new RangeError(`No area of interest at ${x}, ${y}`);
    return area;
  }

  addAtLocation(entity: GameObject) {
    // Add some entity to all the data structures related to position (i.e. the SpaceMap of the category of the entity, and the AOI)
    const map = this.getSpaceMap(entity);
    map.add(entity.x, entity.y, entity);
    const area = this.areaAt(entity.x, entity.y);
    area.addEntity(entity);
    entity.inWorld = true;
    this.changedEntities.add(entity);
    this.changedAreas.add(area.id);
  }

  moveAtLocation(entity: GameObject, fromX: number, fromY: number, toX: number, toY: number) {
    // Update the position of an entity in all data structures related to position (SpaceMap and AOI)
    const map = this.getSpaceMap(entity);
    map.move(fromX, fromY, toX, toY, entity);
    this.changedEntities.add(entity);
    const aoiFrom = this.areaAt(fromX, fromY);
    const aoiTo = this.areaAt(entity.x, entity.y);
    if (aoiFrom.id != aoiTo.id) {
      this.changedAreas.add(aoiFrom.id);
      this.changedAreas.add(aoiTo.id);
      entity.setProperty('aoi', aoiTo.id);
      aoiFrom.deleteEntity(entity);
      aoiTo.addEntity(entity);
    }
  }

  removeFromLocation(entity: GameObject) {
    // Remove an entity from all data structures related to position (SpaceMap and AOI)
    const map = this.getSpaceMap(entity);
    map.delete(entity.x, entity.y, entity);
    const area = this.areaAt(entity.x, entity.y);
    area.deleteEntity(entity);
    entity.inWorld = false;
    this.changedEntities.add(entity);
    this.changedAreas.add(area.id);
  }

  determineStartingPosition() {
    // Determine where a new player should appear for the first time in the game
    const checkpoints = this.objects.checkpoints;
    const startArea = checkpoints[Math.floor(Math.random() * checkpoints.length)];
    const x = this.randomInt(startArea.x, (startArea.x + startArea.width));
    const y = this.randomInt(startArea.y, (startArea.y + startArea.height));
    return { x: Math.floor(x / this.map.tilewidth), y: Math.floor(y / this.map.tileheight) };
  }

  computeTileCoords(x: number, y: number): Tile { // Convert pixel coordinates to tile coordinates
    return {
      x: Math.ceil(x / this.map.tilewidth),
      y: Math.ceil(y / this.map.tileheight),
    };
  }

  adjacentNoDiagonal(a: Tile, b: Tile) { // Check if two entites a and b are on non-diagonally adjacent tiles
    const xDiff = a.x - b.x;
    const yDiff = a.y - b.y;
    if (xDiff == 1 && yDiff == 0) {
      return 1;
    } else if (xDiff == 0 && yDiff == 1) {
      return 2;
    } else if (xDiff == -1 && yDiff == 0) {
      return 3;
    } else if (xDiff == 0 && yDiff == -1) {
      return 4;
    } else if (xDiff == 0 && yDiff == 0) { // The two entities are on the same cell
      return -1;
    } // The two entities are not on adjacent cells, nor on the same one
    return 0;
  }

  findFreeAdjacentCell(x: number, y: number): Tile | undefined {
    // When two entities are on the same tile, look for the first free adjacent tile to move one to
    const adj = [[-1, 0], [1, -1], [1, 1], [-1, 1]];
    for (let c = 0; c < 4; c++) {
      x += adj[c][0];
      y += adj[c][1];
      if (this.collisionGrid[y]?.[x] == 0) return { x, y };
    }
  }

  getMovementCorrection(id: string): MovementCorrection | null {
    const player = this.getPlayer(id);
    if (!player) return null;
    const position = { x: player.x, y: player.y };
    const route = player.route;
    if (!route || route.orientation === undefined) return position;

    const path = route.path.slice(route.step);
    if (path[0]?.x !== position.x || path[0]?.y !== position.y) path.unshift(position);
    if (path.length < 2) return position;
    const elapsed = Math.max(0, Date.now() - route.departureTime - route.step * player.speed);
    return { ...position, route: { path, orientation: route.orientation, elapsed } };
  }

  handlePath(sessionId: string, command: unknown) {
    const player = this.getPlayer(sessionId);
    if (!player?.alive || !command || typeof command !== 'object') return false;

    const { path: requested, action, or: orientation } = command as Partial<PathCommand>;
    if (!action || ![0, 3, 4].includes(action.action)) return false;
    if (typeof orientation !== 'number' || !Number.isInteger(orientation) || orientation < 1 || orientation > 4) return false;
    if (!Array.isArray(requested) || requested.length < (action.action === 0 ? 2 : 1) || requested.length > maxPathLength) return false;

    const inBounds = (tile: Tile) => tile && Number.isInteger(tile.x) && Number.isInteger(tile.y) &&
      tile.x >= 0 && tile.x < this.map.width && tile.y >= 0 && tile.y < this.map.height;
    if (!requested.every(inBounds) || (action.action === 4 && !inBounds(action))) return false;

    player.updateWalk();
    if (!player.alive) return false;
    const active = player.route;
    const { x, y } = player;
    const start = requested[0];
    const path = start.x === x && start.y === y ? requested : [{ x, y }, ...requested];
    const end = path[path.length - 1];
    // Attack and chest paths end one step before the clicked tile, facing it.
    const [dx, dy] = clickOffsets[action.action === 0 ? 0 : orientation];
    if (manhattanDistance(start.x, start.y, end.x + dx, end.y + dy) > maxClickDistance) return false;
    for (let i = 1; i < path.length; i++) {
      const tile = path[i];
      if (this.adjacentNoDiagonal(tile, path[i - 1]) <= 0 || this.collisionGrid[tile.y][tile.x]) return false;
    }

    let routeAction = action;
    if (action.action === 3) {
      if (!Number.isSafeInteger(action.id) || action.id < 0) return false;
      const monster = this.monstersTable[action.id];
      if (!monster) return false;
      if (!monster.alive) routeAction = { action: 0 };
      else if (!player.inFight || !player.target?.alive) player.setTarget(monster);
    }
    // A turn keeps the progress accrued since the last completed tile.
    const departure = active ? active.departureTime + active.step * player.speed : Date.now();
    player.setRoute(path, departure, 0, routeAction, orientation);
    if (routeAction.action !== 3 && (player.inFight || player.target)) player.endFight();
    return true;
  }

  adjacent(A: Tile, B: Tile) {
    return !(Math.abs(A.x - B.x) > 1 || Math.abs(A.y - B.y) > 1);
  }

  respawnCount(x: number, y: number, callback: () => void, delay: number) { // Sets timer to respawn a monster or item
    this.schedule(() => this.respawnSomething(x, y, callback), delay);
  }

  respawnSomething(x: number, y: number, callback: () => void) {
    // Check if the tile is not occupied by something else ; if it is, retry after a short while
    // object is the game object to respawn (a monster or an item)
    // callback is the function that should be call to make it respawn
    if (this.monsters.getFirstFiltered(x, y, ['alive']) ||
          this.playersMap.getFirstFiltered(x, y, ['alive']) ||
          this.items.getFirstFiltered(x, y, ['visible'])
      ) {
      this.respawnCount(x, y, callback, this.retryDelay); // 3s retry delay
      return;
    }
    callback();
  }

  checkDoor(player: Player) { // Check if the player ended up on a teleport
    const door = this.doors.getFirst(player.x, player.y);
    if (door) player.teleport(door);
  }

  checkItem(player: Player) { // Check if the player ended up on an item
    const item = this.items.getFirstFiltered(player.x, player.y, ['visible'], ['inChest']); // should be visible but not in a chest
    if (item) if (player.applyItem(item)) item.pick();
  }

  checkMonster(player: Player) { // Check if the player is adjacent to an aggressive monster that should attack him
    const adj = [[-1, -1], [0, -1], [1, -1], [-1, 0], [0, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
    for (let c = 0; c < 9; c++) {
      const x = player.x + adj[c][0];
      const y = player.y + adj[c][1];
      const monster = this.monsters.getFirstFiltered(x, y, ['alive', 'aggro']);
      if (monster && !this.areFighting(monster, player)) this.setUpFight(player, monster);
    }
  }

  checkAction(player: Player) {
    const action = player.route?.action;
    if (action) {
      if (action.action == 3) { // fight
        const monster = this.monstersTable[action.id];
        if (!monster?.alive || manhattanDistance(player.x, player.y, monster.x, monster.y) > maxClickDistance) {
          if (player.target?.id === action.id && (!monster?.alive || !player.inFight)) player.setTarget(null);
          return;
        }
        if (!player.alive) return;
        if (player.target !== monster) player.setTarget(monster);
        if (!this.areFighting(player, monster)) this.setUpFight(player, monster);
      } else if (action.action == 4) { // chest
        const chest = this.items.getFirstFiltered(action.x, action.y, ['visible', 'chest', 'inChest']);
        if (!chest) return;
        if (!this.adjacent(chest, player)) return;
        chest.open();
      }
    }
  }

  checkSave(player: Player) {
    if (player.alive && !player.lastOutdoorPosition && manhattanDistance(player.x, player.y, player.lastSavedPosition.x, player.lastSavedPosition.y) > 30 &&
      !this.characters.hasPendingSave(player.getMongoID())) {
      this.savePlayer(player);
    }
  }

  // ====================================
  // Code related to fighting and related concepts

  areFighting(A: MovingEntity, B: MovingEntity) {
    return (A.hasFoe(B) && B.hasFoe(A) && (A.inFight && B.inFight));
  }

  setUpFight(A: MovingEntity, B: MovingEntity | undefined) {
    if (!B || !A) return;
    const alreadyInFightA = A.inFight;
    const alreadyInFightB = B.inFight;
    A.startFight(B);
    B.startFight(A);
    if (!alreadyInFightA) A.damage();
    if (!alreadyInFightB) B.damage();
  }

  handleKill(killer: Player, target: MovingEntity) {
    this.schedule(() => {
      if (this.db.monsters[target.name]) killer.updatePacket.addKilled(this.db.monsters[target.name].id);
    }, 400);
  }

  formatLootTable(table?: Record<string, number>): LootChoice[] | undefined {
    // Convert the loot information from the JSON in a format that the rwc module will be able to use
    if (!table) return;
    const lootTable: LootChoice[] = [];
    let sum = 0;
    Object.keys(table).forEach((itm) => {
      lootTable.push({ weight: table[itm], id: itm });
      sum += table[itm];
    });
    if (sum < 10) {
      lootTable.push({ weight: (10 - sum), id: 'none' });
    }
    return lootTable;
  }

  dropLoot(table: LootChoice[] | undefined, x: number, y: number) {
    // Weighted random selection of what item should be dropped by a monster
    const defaultTable = [
      { weight: 5, id: 'none' },
      { weight: 4, id: 'item-flask' },
      { weight: 1, id: 'item-burger' },
    ];
    const lootTable = table || defaultTable;
    const itm = choose(lootTable);
    if (itm && itm != 'none') {
      const item = new Item(this, x, y, itm, false, false, true);  // no respawn, not chest, loot
      item.makeTemporary();
      this.addAtLocation(item);
    }
  }

  spawnHiddenChest(properties: ChestContents) { // If all the monsters in a chest area have been killed, spawn the corresponding chest
    if (this.items.getFirstFiltered(properties.x, properties.y, ['visible'])) return;
    const chest = new Item(this, properties.x, properties.y, properties.items, false, true, false);  // no respawn, chest, not loot
    this.schedule(() => this.addAtLocation(chest), 500);
  }

  // ============================
  // Upate code for the game objects

  update() { // called every 1/12 of sec
    for (const player of Object.values(this.players)) {
      if (player.alive) player.update();
    }
    for (const monster of Object.values(this.monstersTable)) {
      if (monster.alive) monster.update();
    }
  }

  regenerate() {
    for (const player of Object.values(this.players)) {
      if (player.alive && player.life < player.maxLife) player.regenerate();
    }
  }

  randomInt(low: number, high: number) {
    return Math.floor(Math.random() * (high - low) + low);
  }
}

function manhattanDistance(xA: number, yA: number, xB: number, yB: number) {
  return Math.abs(xA - xB) + Math.abs(yA - yB);
}

export = new GameSimulation();
