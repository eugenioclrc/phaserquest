/**
 * Created by Jerome on 24-02-17.
 */

const { AOIutils } = require('../../shared/AOIutils.ts');

class AOI {
  constructor(x, y, w, h) {
    this.id = AOIutils.lastAOIid++;
    this.x = x;
    this.y = y;
    this.width = w;
    this.height = h;
    this.entities = []; // list of entities situated within the area corresponding to this AOI
  }

  addEntity(entity) {
    this.entities.push(entity);
  }

  deleteEntity(entity) {
    const idx = this.entities.indexOf(entity);
    if (idx >= 0) this.entities.splice(idx, 1);
  }
}

module.exports.AOI = AOI;
