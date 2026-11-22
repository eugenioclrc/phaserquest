import AOI = require('../../shared/AOIutils.ts');
import type GameObject = require('./GameObject.ts');

class AreaOfInterest {
  readonly id = AOI.AOIutils.lastAOIid++;
  readonly entities: GameObject[] = [];

  constructor(public x: number, public y: number, public width: number, public height: number) {}

  addEntity(entity: GameObject) {
    this.entities.push(entity);
  }

  deleteEntity(entity: GameObject) {
    const index = this.entities.indexOf(entity);
    if (index >= 0) this.entities.splice(index, 1);
  }
}

export = AreaOfInterest;
