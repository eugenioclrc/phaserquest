/**
 * Created by Jerome on 24-02-17.
 */

const GameServer = require('./GameServer.js').GameServer;
const UpdatePacket = require('./UpdatePacket.js');
const AOIutils = require('../AOIutils.js').AOIutils;

class AOI {
  constructor(x, y, w, h) {
    this.id = AOIutils.lastAOIid++;
    this.x = x;
    this.y = y;
    this.width = w;
    this.height = h;
    this.entities = []; // list of entities situated within the area corresponding to this AOI
    this.updatePacket = new UpdatePacket();
  }

  getUpdatePacket() {
    return (this.updatePacket ? this.updatePacket : null);
  }

  clear() {
    this.updatePacket = new UpdatePacket();
  }

  addEntity(entity, previous) {
    this.entities.push(entity);
    GameServer.handleAOItransition(entity, previous);
  }

  deleteEntity(entity) {
    const idx = this.entities.indexOf(entity);
    if (idx >= 0) this.entities.splice(idx, 1);
  }
}

module.exports.AOI = AOI;
