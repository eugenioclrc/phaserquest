/**
 * Created by Jerome on 26-12-16.
 */

const GameServer = require('./GameServer.js').GameServer;
const AOIutils = require('../AOIutils.js').AOIutils;

// Parent class of all game objects : players, monsters and items (not NPC
// because they are not processed server-side)
class GameObject {
  setProperty(property, value) {
    // Updates a property of the object and update the AOI's around it
    // console.log(this.id+' sets '+property+' to '+value);
    this[property] = value;
    if (this.id !== undefined) this.updateAOIs(property, value);
  }

  updateAOIs(property, value) {
    // When something changes, all the AOI around the affected entity are updated
    const AOIs = this.listAdjacentAOIs(true);
    const category = this.category; // type of the affected game object: player, monster, item
    const id = this.id;
    AOIs.forEach((aoi) => {
      GameServer.updateAOIproperty(aoi, category, id, property, value);
    });
  }

  getAOIid() {
    return GameServer.AOIfromTiles.getFirst(this.x, this.y).id;
  }

  listAdjacentAOIs(onlyIDs) {
    const current = this.getAOIid();
    let AOIs = AOIutils.listAdjacentAOIs(current);
    // return strings such as 'AOI1', 'AOI13', ... instead of just 1, 13, ...
    if (!onlyIDs) {
      AOIs = AOIs.map(aoi => `AOI${aoi}`);
    }
    return AOIs;
  }
}

module.exports.GameObject = GameObject;
