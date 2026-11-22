/**
 * Created by Jerome on 26-12-16.
 */

const GameServer = require('./GameServer.js').GameServer;

// Parent class of all game objects : players, monsters and items (not NPC
// because they are not processed server-side)
class GameObject {
  setProperty(property, value) {
    if (this[property] === value) return;
    this[property] = value;
    if (this.inWorld) GameServer.changedEntities.add(this);
  }

  getAOIid() {
    return GameServer.AOIfromTiles.getFirst(this.x, this.y).id;
  }
}

module.exports.GameObject = GameObject;
