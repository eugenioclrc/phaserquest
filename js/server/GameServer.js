/**
 * Created by Jerome on 28-10-16.
 */

const fs = require('fs');
const path = require('path');
const PF = require('pathfinding');
const rwc = require('random-weighted-choice'); // used to randomly decide which loot a monster should drop

const assetsDir = path.join(__dirname, '..', '..', 'assets');

const GameServer = {
  map: null, // object containing all the data about the world map
  changedEntities: new Set(),
  changedAreas: new Set(),
  mapReady: false, // is the server done processing the map or not
  // frequency of the server update loop ; rate at which the player and monsters objects will call their "update" methods
  updateRate: 1000 / 12,
  regenRate: 1000 * 2, // Rate at which the regenerate() method is called
  itemRespawnDelay: 1000 * 30, // Delay (ms) after which a respawnable item will respawn
  monsterRespawnDelay: 1000 * 30, // Delay (ms) after which a monster will respawn
  itemVanishDelay: 1000 * 9, // How long does dropped loot remain visible (ms)
  retryDelay: 1000 * 3, // Stuff don't respawn on cells occupied by players ; if a cell is occupied, the respawn call will retry after this amount of time (ms)
  walkUpdateDelay: 80, // How many ms between two updateWalk() calls
  fightUpdateDelay: 200, // How many ms between two updateFight() calls
  damageDelay: 1000, // How many ms before an entity can damage another one again
  positionCheckDelay: 1000, // How many ms before checkPosition() call
  lastItemID: 0, // ID of the last item object created
  lastMonsterID: 0,
  lastPlayerID: 0,
  players: {}, // map of all connected players, fetchable by id
  sessionMap: Object.create(null), // maps room sessions to entity IDs
};

module.exports.GameServer = GameServer;
module.exports.randomInt = randomInt;

const { spaceMap } = require('../../shared/spaceMap.ts');
const ChestArea = require('./chestarea.js').ChestArea;
const { AOIutils } = require('../../shared/AOIutils.ts');
const AOI = require('./AOI.js').AOI;
const Player = require('./Player.js').Player;
const Monster = require('./Monster.js').Monster;
const Item = require('./Item.js').Item;

GameServer.getPlayer = function (sessionId) {
  return GameServer.players[GameServer.sessionMap[sessionId]];
};

// Create a map between the numerical id's and the string id's of elements of a collection
GameServer.makeIDmap = function (collection, map) {
  Object.keys(collection).forEach((key) => {
    const e = collection[key];
    map[e.id] = key;
  });
};

// =========================
// Code related to reading map and setting up world

GameServer.readMap = async function () {
  GameServer.db = JSON.parse(fs.readFileSync(path.join(assetsDir, 'json/db.json'), 'utf8')); // Info about monsters, items, etc.
  GameServer.db.entities = JSON.parse(fs.readFileSync(path.join(assetsDir, 'json/entities_server.json'), 'utf8')); // locations of monsters, objects, chests...
  GameServer.db.client_entities = JSON.parse(fs.readFileSync(path.join(assetsDir, 'json/entities_client.json'), 'utf8')); // npc
  Object.assign(GameServer.db.entities, GameServer.db.client_entities); // merge the last two for convenience

  GameServer.db.itemsIDmap = {}; // Make a map to easily fetch string keys based on numerical id's
  GameServer.makeIDmap(GameServer.db.items, GameServer.db.itemsIDmap);

  const data = await fs.promises.readFile(path.join(assetsDir, 'maps/minimap_server.json'), 'utf8');
  GameServer.lastItemID = 0;
  GameServer.lastMonsterID = 0;
  GameServer.lastPlayerID = 0;
  GameServer.changedEntities.clear();
  GameServer.changedAreas.clear();
  GameServer.map = JSON.parse(data);
  GameServer.objects = {};
  GameServer.layers = [];
  GameServer.tilesets = {};

  for (var l = 0; l < GameServer.map.layers.length; l++) {
    const layer = GameServer.map.layers[l];
    if (layer.type == 'objectgroup') {
      GameServer.objects[layer.name] = layer.objects;
    } else if (layer.type == 'tilelayer') {
      GameServer.layers.push(layer.data);
    }
  }
  for (let t = 0; t < GameServer.map.tilesets.length; t++) {
    const tileset = GameServer.map.tilesets[t];
    GameServer.tilesets[tileset.name] = tileset.tileproperties;
  }

      // Iterate over all tiles and work out AOIs and collisions
  const { tileWidth, tileHeight } = AOIutils;
  AOIutils.nbAOIhorizontal = Math.ceil(GameServer.map.width / tileWidth);
  AOIutils.lastAOIid = 0;
  GameServer.AOIs = {}; // Maps AOI id to AOI object
  GameServer.AOIfromTiles = new spaceMap(); // map tiles coordinates to AOI id (e.g. the tile (3,2) is in AOI 0)
  GameServer.collisionGrid = [];
  for (let y = 0; y < GameServer.map.height; y++) {
    const col = [];
    for (let x = 0; x < GameServer.map.width; x++) {
              // Work out AOI
      if (x % tileWidth == 0 && y % tileHeight == 0) { // Create a new AOI at these coordinates
        const area = new AOI(x, y, tileWidth, tileHeight);
        GameServer.AOIs[area.id] = area;
      }
      GameServer.AOIfromTiles.add(x, y, GameServer.AOIs[AOIutils.idFromCoords(x, y)]);
              // Work out collisions
      let collide = false;
      for (var l = 0; l < GameServer.layers.length; l++) {
        const tile = GameServer.layers[l][y * GameServer.map.width + x];
        if (tile) {
                      // The original BrowserQuest Tiled file doesn't use a collision layer; rather, properties are added to the
                      // tileset to indicate which tiles causes collisions or not. Which is why we have to check in the tileProperties
                      // if a given tile has the property "c" or not (= collision)
          const tileProperties = GameServer.tilesets.tilesheet[tile - 1];
          if (tileProperties) {
            if (tileProperties.hasOwnProperty('c')) {
              collide = true;
              break;
            }
          }
        }
      }
      col.push(+collide); // "+" to convert boolean to int
    }
    GameServer.collisionGrid.push(col);
  }
  GameServer.PFgrid = new PF.Grid(GameServer.collisionGrid);
  GameServer.pathfinder = new PF.AStarFinder();

  GameServer.setUpDoors();
  GameServer.setUpEntities();
  GameServer.setUpChests();
  GameServer.setUpRoaming();
  console.log('Map read');
  GameServer.mapReady = true;
};

GameServer.setUpDoors = function () { // Set up teleports
  GameServer.doors = new spaceMap();
  for (let d = 0; d < GameServer.objects.doors.length; d++) {
    const door = GameServer.objects.doors[d];
    const position = GameServer.computeTileCoords(door.x, door.y);
    GameServer.doors.add(position.x, position.y, {
      to: { x: Number(door.properties.x), y: Number(door.properties.y) },
      camera: (door.properties.hasOwnProperty('cx') ?
            { x: door.properties.cx, y: door.properties.cy }
                : null),
      orientation: door.properties.o,
    });
  }
};

GameServer.setUpEntities = function () { // Set up monsters & items
  GameServer.playersMap = new spaceMap();
  GameServer.items = new spaceMap();
  GameServer.monsters = new spaceMap();
  GameServer.monstersTable = {};
  for (let d = 0; d < GameServer.objects.entities.length; d++) {
    const entity = GameServer.objects.entities[d];
    if (!GameServer.db.entities.hasOwnProperty(entity.gid - 1961)) continue;
    const entityInfo = GameServer.db.entities[entity.gid - 1961];
    const position = GameServer.computeTileCoords(entity.x, entity.y);
    if (entityInfo.npc) {
      GameServer.collisionGrid[position.y][position.x] = 1;
    } else if (entityInfo.item) {
      const item = new Item(position.x, position.y - 1, entityInfo.sprite, true, false, false); // respawn, not chest, not loot
      GameServer.addAtLocation(item);
    } else if (entityInfo.monster) {
      GameServer.addMonster(position, entityInfo.sprite);
    }
  }
};

GameServer.addMonster = function (position, sprite) { // Create a monster object and add it to all relevant data structures
    // position are the tile coordinates at which to create the monster
    // sprite is the name of the sprite of the monster, which also works as its string key in the JSON
  const monster = new Monster(position.x, position.y, sprite);
  GameServer.monstersTable[monster.id] = monster;
  GameServer.addAtLocation(monster);
};

GameServer.setUpChests = function () { // Sets up chests and chest areas
  for (var d = 0; d < GameServer.objects.chests.length; d++) {
    var chest = GameServer.objects.chests[d];
    const position = GameServer.computeTileCoords(chest.x, chest.y);
    var chest = new Item(position.x, position.y, chest.properties.items, true, true, false); // respawn, chest, not loot
    GameServer.addAtLocation(chest);
  }

    // Chest areas are areas where a chest will spawn if all monsters are killed
  GameServer.chestareas = {};
  for (var d = 0; d < GameServer.objects.chestareas.length; d++) {
    const area = GameServer.objects.chestareas[d];
    const chestarea = new ChestArea(area.properties, GameServer.spawnHiddenChest);
    GameServer.chestareas[d] = chestarea;
        // Compute the size of the area
    const topleft = GameServer.computeTileCoords(area.x, area.y);
    const bottomright = GameServer.computeTileCoords(area.x + area.width, area.y + area.height);
        // Count all monsters within that area, to configure the chest area properly
    for (let x = topleft.x; x < bottomright.x; x++) {
      for (let y = topleft.y; y < bottomright.y; y++) {
        const monster = GameServer.monsters.getFirst(x, y);
        if (monster) {
          monster.chestArea = chestarea;
          chestarea.incrementAll();
        }
      }
    }
  }
};

GameServer.setUpRoaming = function () { // Sets up packs of randomly positioned monsters within an area
  for (let d = 0; d < GameServer.objects.roaming.length; d++) {
    var roaming = GameServer.objects.roaming[d];
    const positions = new Set(); // use a set of positions to avoid having multiple monsters on the same tile
    while (positions.size < roaming.properties.nb) {
      const x = randomInt(roaming.x, (roaming.x + roaming.width));
      const y = randomInt(roaming.y, (roaming.y + roaming.height));
      positions.add(GameServer.computeTileCoords(x, y));
    }
    positions.forEach((pos) => {
      GameServer.addMonster(pos, roaming.type);
    });
  }
};

GameServer.loadPlayer = async function (sessionId, id, isConnected) {
  const document = await GameServer.characters.open(id);
  const mongoId = document._id.toString();
  if (!isConnected()) {
    await GameServer.characters.close(mongoId);
    return null;
  }
  try {
    const player = new Player();
    player.setIDs(mongoId);
    player.getDataFromDb(document);
    GameServer.embedPlayer(player);
    GameServer.sessionMap[sessionId] = player.id;
    return player;
  } catch (error) {
    await GameServer.characters.close(mongoId);
    throw error;
  }
};

GameServer.embedPlayer = function (player) {
    // Add the player to all the relevant data structures
  GameServer.players[player.id] = player;
  GameServer.addAtLocation(player);
  player.setLastSavedPosition();
};

GameServer.savePlayer = async function (player) {
  const document = player.dbTrim();
  if (await GameServer.characters.save(player.getMongoID(), document)) {
    player.lastSavedPosition = { x: document.x, y: document.y };
  }
};

GameServer.removePlayer = async function (sessionId) {
  const player = GameServer.getPlayer(sessionId);
  if (!player) return;
  GameServer.removeFromLocation(player);
  player.die();
  delete GameServer.players[player.id];
  delete GameServer.sessionMap[sessionId];
  await GameServer.characters.close(player.getMongoID());
};

// ==================================
// Code related to managing the position of the game objects in the world

GameServer.getSpaceMap = function (entity) {
    // Get the spatial data structure corresponding to the kind of entity  you want to deal with
  switch (entity.category) {
    case 'item':
      return GameServer.items;
      break;
    case 'player':
      return GameServer.playersMap;
      break;
    case 'monster':
      return GameServer.monsters;
      break;
  }
};

GameServer.addAtLocation = function (entity) {
    // Add some entity to all the data structures related to position (i.e. the spaceMap of the category of the entity, and the AOI)
  const map = GameServer.getSpaceMap(entity);
  map.add(entity.x, entity.y, entity);
  const area = GameServer.AOIfromTiles.getFirst(entity.x, entity.y);
  area.addEntity(entity);
  entity.inWorld = true;
  GameServer.changedEntities.add(entity);
  GameServer.changedAreas.add(area.id);
};

GameServer.moveAtLocation = function (entity, fromX, fromY, toX, toY) {
    // Update the position of an entity in all data structures related to position (spaceMap and AOI)
  const map = GameServer.getSpaceMap(entity);
  map.move(fromX, fromY, toX, toY, entity);
  GameServer.changedEntities.add(entity);
  const AOIfrom = GameServer.AOIfromTiles.getFirst(fromX, fromY);
  const AOIto = GameServer.AOIfromTiles.getFirst(entity.x, entity.y);
  if (AOIfrom.id != AOIto.id) {
    GameServer.changedAreas.add(AOIfrom.id);
    GameServer.changedAreas.add(AOIto.id);
    entity.setProperty('aoi', AOIto.id);
    AOIfrom.deleteEntity(entity);
    AOIto.addEntity(entity);
  }
};

GameServer.removeFromLocation = function (entity) {
    // Remove an entity from all data structures related to position (spaceMap and AOI)
  const map = GameServer.getSpaceMap(entity);
  map.delete(entity.x, entity.y, entity);
  const area = GameServer.AOIfromTiles.getFirst(entity.x, entity.y);
  area.deleteEntity(entity);
  entity.inWorld = false;
  GameServer.changedEntities.add(entity);
  GameServer.changedAreas.add(area.id);
};

GameServer.determineStartingPosition = function () {
    // Determine where a new player should appear for the first time in the game
  const checkpoints = GameServer.objects.checkpoints;
  const startArea = checkpoints[Math.floor(Math.random() * checkpoints.length)];
  const x = randomInt(startArea.x, (startArea.x + startArea.width));
  const y = randomInt(startArea.y, (startArea.y + startArea.height));
  return { x: Math.floor(x / GameServer.map.tilewidth), y: Math.floor(y / GameServer.map.tileheight) };
};

GameServer.computeTileCoords = function (x, y) { // Convert pixel coordinates to tile coordinates
  return {
    x: Math.ceil(x / GameServer.map.tilewidth),
    y: Math.ceil(y / GameServer.map.tileheight),
  };
};

GameServer.adjacentNoDiagonal = function (a, b) { // Check if two entites a and b are on non-diagonally adjacent tiles
  const Xdiff = a.x - b.x;
  const Ydiff = a.y - b.y;
  if (Xdiff == 1 && Ydiff == 0) {
    return 1;
  } else if (Xdiff == 0 && Ydiff == 1) {
    return 2;
  } else if (Xdiff == -1 && Ydiff == 0) {
    return 3;
  } else if (Xdiff == 0 && Ydiff == -1) {
    return 4;
  } else if (Xdiff == 0 && Ydiff == 0) { // The two entities are on the same cell
    return -1;
  } // The two entities are not on adjacent cells, nor on the same one
  return 0;
};

GameServer.findFreeAdjacentCell = function (x, y) {
    // When two entities are on the same tile, look for the first free adjacent tile to move one to
  const adj = [[-1, 0], [1, -1], [1, 1], [-1, 1]];
  for (let c = 0; c < 4; c++) {
    x += adj[c][0];
    y += adj[c][1];
    if (GameServer.collisionGrid[y][x] == 0) return { x, y };
  }
};

GameServer.getMovementCorrection = function (id) {
  const player = GameServer.getPlayer(id);
  if (!player) return null;
  const position = { x: player.x, y: player.y };
  const route = player.route;
  if (!route) return position;

  const path = route.path.slice(route.step);
  if (path[0]?.x !== position.x || path[0]?.y !== position.y) path.unshift(position);
  if (path.length < 2) return position;
  return { ...position, route: { path, orientation: route.orientation } };
};

GameServer.convertPath = function (p) {
    // The pathfinding for players and monsters are done using two different pathfinding libraries, with slightly different
    // format to represent the coordinates; this function converts the array format into the object format
  const path = [];
  for (let i = 0; i < p.length; i++) {
    path.push({ x: p[i][0], y: p[i][1] });
  }
  return path;
};

GameServer.handlePath = function (sessionId, command, latencyMs) {
  const player = GameServer.getPlayer(sessionId);
  if (!player?.alive || !command || typeof command !== 'object') return false;

  const { path, action, or: orientation } = command;
  if (!action || ![0, 3, 4].includes(action.action)) return false;
  if (!Number.isInteger(orientation) || orientation < 1 || orientation > 4) return false;
  if (!Array.isArray(path) || path.length < (action.action === 0 ? 2 : 1) || path.length > 60) return false;

  const inBounds = tile => tile && Number.isInteger(tile.x) && Number.isInteger(tile.y) &&
    tile.x >= 0 && tile.x < GameServer.map.width && tile.y >= 0 && tile.y < GameServer.map.height;
  if (!path.every(inBounds) || (action.action === 4 && !inBounds(action))) return false;

  const start = path[0];
  const end = path[path.length - 1];
  if (manhattanDistance(start.x, start.y, end.x, end.y) > AOIutils.tileHeight + 8) return false;
  if (Math.abs(start.x - player.x) > 1 || Math.abs(start.y - player.y) > 1) return false;
  if (GameServer.collisionGrid[start.y][start.x] && (start.x !== player.x || start.y !== player.y)) return false;
  for (let i = 1; i < path.length; i++) {
    const tile = path[i];
    if (!GameServer.adjacent(tile, path[i - 1]) || GameServer.collisionGrid[tile.y][tile.x]) return false;
  }

  if (action.action === 3) {
    if (!Number.isSafeInteger(action.id) || action.id < 0) return false;
    const monster = GameServer.monstersTable[action.id];
    if (!monster?.alive) return false;
    if (!player.inFight || !player.target?.alive) player.setTarget(monster);
  }
  player.setRoute(path, Date.now() - latencyMs, latencyMs, action, orientation);
  if (player.inFight && action.action !== 3) player.endFight();
  return true;
};

GameServer.adjacent = function (A, B) {
  return !(Math.abs(A.x - B.x) > 1 || Math.abs(A.y - B.y) > 1);
};

GameServer.respawnCount = function (x, y, object, callback, delay) { // Sets timer to respawn a monster or item
    // object is the game object to respawn (a monster or an item)
    // callback is the function that should be call to make it respawn
    // delay is the amoutn of ms to wait before calling the callback
  GameServer.schedule(GameServer.respawnSomething, delay, x, y, object, callback);
};

GameServer.respawnSomething = function (x, y, object, callback) {
    // Check if the tile is not occupied by something else ; if it is, retry after a short while
    // object is the game object to respawn (a monster or an item)
    // callback is the function that should be call to make it respawn
  if (GameServer.monsters.getFirstFiltered(x, y, ['alive']) ||
        GameServer.playersMap.getFirstFiltered(x, y, ['alive']) ||
        GameServer.items.getFirstFiltered(x, y, ['visible'])
    ) {
    GameServer.respawnCount(x, y, object, callback, GameServer.retryDelay); // 3s retry delay
    return;
  }
  callback.call(object);
};

GameServer.checkDoor = function (player) { // Check if the player ended up on a teleport
  const door = GameServer.doors.getFirst(player.x, player.y);
  if (door) player.teleport(door);
};

GameServer.checkItem = function (player) { // Check if the player ended up on an item
  const item = GameServer.items.getFirstFiltered(player.x, player.y, ['visible'], ['inChest']); // should be visible but not in a chest
  if (item) if (player.applyItem(item)) item.pick();
};

GameServer.checkMonster = function (player) { // Check if the player is adjacent to an aggressive monster that should attack him
  const adj = [[-1, -1], [0, -1], [1, -1], [-1, 0], [0, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
  for (let c = 0; c < 9; c++) {
    const x = player.x + adj[c][0];
    const y = player.y + adj[c][1];
    const monster = GameServer.monsters.getFirstFiltered(x, y, ['alive', 'aggro']);
    if (monster && !GameServer.areFighting(monster, player)) GameServer.setUpFight(player, monster);
  }
};

GameServer.checkAction = function (player) {
  if (player.route.action) {
    const action = player.route.action;
    if (action.action == 3) { // fight
      const monster = GameServer.monstersTable[action.id];
      if (!monster?.alive || GameServer.adjacentNoDiagonal(player, monster) <= 0) {
        if (player.target?.id === action.id && (!monster?.alive || !player.inFight)) player.setTarget(null);
        return;
      }
      if (!player.alive) return;
      if (player.target !== monster) player.setTarget(monster);
      if (!GameServer.areFighting(player, monster)) GameServer.setUpFight(player, monster);
    } else if (action.action == 4) { // chest
      const chest = GameServer.items.getFirstFiltered(action.x, action.y, ['visible', 'chest', 'inChest']);
      if (!chest) return;
      if (!GameServer.adjacent(chest, player)) return;
      chest.open();
    }
  }
};

GameServer.checkSave = function (player) {
    // save the progress of the player if the distance to his last saved position is greater than 30,
    // but only if he's outdoor (x < 92). Saving position indoor might cause camera issues when reloading the game.
  if (player.x < 92 && manhattanDistance(player.x, player.y, player.lastSavedPosition.x, player.lastSavedPosition.y) > 30) {
    GameServer.savePlayer(player);
  }
};

// ====================================
// Code related to fighting and related concepts

GameServer.areFighting = function (A, B) {
  return (A.hasFoe(B) && B.hasFoe(A) && (A.inFight && B.inFight));
};

GameServer.setUpFight = function (A, B) {
  if (!B || !A) return;
  const alreadyInFightA = A.inFight;
  const alreadyInFightB = B.inFight;
  A.startFight(B);
  B.startFight(A);
  if (!alreadyInFightA) A.damage();
  if (!alreadyInFightB) B.damage();
};

GameServer.handleKill = function (killer, target) {
  GameServer.schedule(() => {
    if (GameServer.db.monsters[target.name]) killer.updatePacket.addKilled(GameServer.db.monsters[target.name].id);
  }, 400);
};

GameServer.formatLootTable = function (table) {
    // Convert the loot information from the JSON in a format that the rwc module will be able to use
  if (!table) return;
  const lootTable = [];
  let sum = 0;
  Object.keys(table).forEach((itm) => {
    lootTable.push({ weight: table[itm], id: itm });
    sum += table[itm];
  });
  if (sum < 10) {
    lootTable.push({ weight: (10 - sum), id: 'none' });
  }
  return lootTable;
};

GameServer.dropLoot = function (table, x, y) {
    // Weighted random selection of what item should be dropped by a monster
  const defaultTable = [
        { weight: 5, id: 'none' },
        { weight: 4, id: 'item-flask' },
        { weight: 1, id: 'item-burger' },
  ];
  const lootTable = table || defaultTable;
  const itm = rwc(lootTable);
  if (itm && itm != 'none') {
    const item = new Item(x, y, itm, false, false, true);  // no respawn, not chest, loot
    item.makeTemporary();
    GameServer.addAtLocation(item);
  }
};

GameServer.spawnHiddenChest = function (properties) { // If all the monsters in a chest area have been killed, spawn the corresponding chest
  if (GameServer.items.getFirstFiltered(properties.x, properties.y, ['visible'])) return;
  const chest = new Item(properties.x, properties.y, properties.items, false, true, false);  // no respawn, chest, not loot
  GameServer.schedule((properties, chest) => {
    GameServer.addAtLocation(chest);
  }, 500, properties, chest);
};

// ============================
// Upate code for the game objects

GameServer.update = function () { // called every 1/12 of sec
  Object.keys(GameServer.players).forEach((key) => {
    const player = GameServer.players[key];
    if (player.alive) player.update();
  });
  Object.keys(GameServer.monstersTable).forEach((key) => {
    const monster = GameServer.monstersTable[key];
    if (monster.alive) monster.update();
  });
};

GameServer.regenerate = function () {
  Object.keys(GameServer.players).forEach((key) => {
    const player = GameServer.players[key];
    if (player.alive && player.life < player.maxLife) player.regenerate();
  });
};

function randomInt(low, high) {
  return Math.floor(Math.random() * (high - low) + low);
}

function manhattanDistance(xA, yA, xB, yB) {
  return Math.abs(xA - xB) + Math.abs(yA - yB);
}
