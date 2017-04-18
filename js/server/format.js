/**
 * Created by Jerome on 23-08-16.
 */

// https://github.com/bjorn/tiled/wiki/JSON-Map-Format
const fs = require('fs');
const clone = require('clone');

function Layer(w, h, name, level) {
  this.width = w;
  this.height = h;
  this.name = name;
  this.type = 'tilelayer';
  this.visible = true;
  this.x = 0;
  this.y = 0;
  this.data = []; // Array of tiles
  this.opacity = 1;
  this.properties = { // stores additional non-standard properties
    level, // high or ground
  };
}

function tileMap(map, isClient) {
    // Common to both
  this.height = map.height;
  this.width = map.width;
  this.tilewidth = map.tilewidth;
  this.tileheight = map.tileheight;
  this.layers = [];
  this.tilesets = [map.tilesets[0]];
  if (isClient) {
    this.orientation = map.orientation; // iso or ortho ; mandatory
    this.properties = map.properties;
  }
}
// Break map: don't forget the doors and entities (and later, music)
function formatMap() {
  console.log('Formatting ...');
  const path = '/../../assets/maps/';
  const name = 'map';

  fs.readFile(`${__dirname + path + name}.json`, 'utf8', (err, data) => {
    if (err) throw err;
    const map = JSON.parse(data);
        // Copy a few properties from the initial map object into a new one
    const clientmap = new tileMap(map, true);
    const servermap = new tileMap(map, false);

    const newLayers = [new Layer(map.width, map.height, 'layer0', 'ground')]; // array of ground-level layers
    const highLayers = [new Layer(map.width, map.height, 'highlayer0', 'high')]; // array of layers appearing above entities
    const clientObjectLayers = [];
    const serverObjectLayers = [];
        // Fill the layers with 0's
    fillLayer(highLayers[0], map.width * map.height);
    fillLayer(newLayers[0], map.width * map.height);
    for (let i = 0; i < map.layers.length; i++) { // Scan all layers one by one
      const layer = map.layers[i];
      if (layer.type === 'tilelayer') {
                // console.log('processing ' + layer.name);
        for (let j = 0; j < layer.data.length; j++) { // Scan all tiles one by one
          const tileProperties = map.tilesets[0].tileproperties[layer.data[j] - 1];
          if (tileProperties && tileProperties.hasOwnProperty('v')) {
            addTile(highLayers, true, j, layer.data[j], map.width, map.height);
          } else {
            addTile(newLayers, false, j, layer.data[j], map.width, map.height);
          }
        }
                // console.log('done with layer ' + layer.name);
      } else if (layer.type === 'objectgroup') {
        if (layer.name == 'doors' || layer.name == 'entities') {
          if (layer.name == 'entities') {
            clientObjectLayers.push(filterEntities(clone(layer)));
          } else {
            clientObjectLayers.push(layer);
          }
        }
        serverObjectLayers.push(layer);
      }
    }

    countTiles(newLayers);
    countTiles(highLayers);
        // findTiles(newLayers[4]);

    console.log(`${clientObjectLayers.length} client object layers`);
    console.log(`${serverObjectLayers.length} server object layers`);
    clientmap.layers = newLayers.concat(highLayers).concat(clientObjectLayers);
    servermap.layers = newLayers.concat(highLayers).concat(serverObjectLayers);

    console.log(`Initial #layers = ${map.layers.length}`);
    console.log(`New #layers = ${clientmap.layers.length}`);
    fs.writeFile(`${__dirname + path}mini${name}_client.json`, JSON.stringify(clientmap), (err) => {
      console.log('Client map written!');
            // breakMap(clientmap);
    });
    fs.writeFile(`${__dirname + path}mini${name}_server.json`, JSON.stringify(servermap), (err) => {
      console.log('Server map written!');
    });
  });
}
function countTiles(arr) {
  for (let i = 0; i < arr.length; i++) {
    const tmp = arr[i].data.slice();
    const nb = tmp.map(x => +(x > 0)).reduce((a, b) => a + b, 0);
    console.log(`${nb} tiles in layer ${i}`);
  }
}

function findTiles(layer) {
  for (let i = 0; i < layer.data.length; i++) {
    if (layer.data[i] > 0) {
      const x = i % layer.width;
      const y = Math.floor(i / layer.width);
      console.log(`tile at ${x}, ${y}`);
    }
  }
}

function addTile(layerArray, high, index, tile, w, h) {
  if (tile == 0) return;
  let depth = 0;
    // Look for the first layer wih an empty tile at the corresponding position (=index)
  while (layerArray[depth].data[index] != 0 && layerArray[depth].data[index] !== undefined) {
    depth++; // If non-empty, increase depth = look one layer further
    if (depth >= layerArray.length) { // If reached max depth, create new layer
      const name = (high ? 'highlayer' : 'layer') + depth;
      layerArray.push(new Layer(w, h, name, (high ? 'high' : 'ground')));
      fillLayer(layerArray[depth], w * h);
    }
  }
  layerArray[depth].data[index] = tile;
}

function fillLayer(layer, n) {
  for (let k = 0; k < n; k++) {
    layer.data.push(0);
  }
}

function filterEntities(layer) {
  const tmpobj = [];
  for (let i = 0; i < layer.objects.length; i++) {
    const obj = layer.objects[i];
    const gid = obj.gid;
        // gid between 6 and 12 or 18 and 27  (1961 + )
    if ((gid >= 1961 + 6 && gid <= 1961 + 12) || (gid >= 1961 + 18 && gid <= 1961 + 27)) {
      tmpobj.push(obj);
    }
  }
  layer.objects = tmpobj;
  return layer;
}

function breakMap(map) {
  const path = '/../../assets/maps/';
  const AOIwidth = 34; // 6 AOIs horizontally
  const AOIheight = 20; // 16 AOIs vertically
  const nbAOIhoriz = 6;
  const nbAOIvert = 16;
  const mapWidth = map.width;
  const nbAOI = nbAOIhoriz * nbAOIvert;
  let lastID = nbAOI - 1;
  lastID = 2;

  for (let aoi = 0; aoi <= lastID; aoi++) {
    const subMap = clone(map);
    const x = (aoi % nbAOIhoriz) * AOIwidth;
    const y = Math.floor(aoi / nbAOIhoriz) * AOIheight;
    const liststart = AOIwidth * nbAOIhoriz * y + x;  // At which index in the list corresponds the top left tile of the submap
        // console.log('linetsart : '+liststart);
    for (let i = 0; i < subMap.layers.length; i++) { // Scan all layers one by one
      const layer = subMap.layers[i];
      layer.width = AOIwidth;
      layer.height = AOIheight;
            // TODO : also filter objects
      if (layer.type === 'tilelayer') {
        let tmpdata = [];
                // console.log('data length : '+layer.data.length);
        for (let yi = 0; yi < AOIheight; yi++) {
          const begin = liststart + yi * mapWidth;
          const end = begin + AOIwidth;
          const line = layer.data.slice(begin, end);
          tmpdata = tmpdata.concat(line);
        }
        layer.data = tmpdata;
                // console.log('new data length : '+layer.data.length);
      }
    }
    fs.writeFile(`${__dirname + path}pieces/piece${aoi}.json`, JSON.stringify(subMap), (err) => {
            // console.log('Piece written');
    });
  }
}

module.exports.format = formatMap;
