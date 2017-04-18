/**
 * Created by Jerome on 24-02-17.
 */

const GameServer = require('./GameServer.js').GameServer;
const UpdatePacket = require('./UpdatePacket.js').UpdatePacket;
const AOIutils = require('../AOIutils.js').AOIutils;

function AOI(x, y, w, h) {
  this.id = AOIutils.lastAOIid++;
  this.x = x;
  this.y = y;
  this.width = w;
  this.height = h;
  this.entities = []; // list of entities situated within the area corresponding to this AOI
  this.updatePacket = new UpdatePacket();
}

AOI.prototype.getUpdatePacket = function () {
  return (this.updatePacket ? this.updatePacket : null);
};

AOI.prototype.clear = function () {
  this.updatePacket = new UpdatePacket();
};

AOI.prototype.addEntity = function (entity, previous) {
  this.entities.push(entity);
  GameServer.handleAOItransition(entity, previous);
};

AOI.prototype.deleteEntity = function (entity) {
  const idx = this.entities.indexOf(entity);
  if (idx >= 0) this.entities.splice(idx, 1);
};

module.exports.AOI = AOI;
