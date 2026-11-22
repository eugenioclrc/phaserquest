import type GameServer = require('./GameServer.ts');
import type Item = require('./Item.ts');
import type Monster = require('./Monster.ts');
import type Player = require('./Player.ts');

abstract class GameObject {
  abstract readonly category: 'player' | 'monster' | 'item';
  id!: number;
  aoi!: number;
  inWorld = false;

  constructor(protected readonly world: typeof GameServer, public x: number, public y: number) {}

  setProperty<K extends keyof this>(property: K, value: this[K]) {
    if (this[property] === value) return;
    this[property] = value;
    if (this.inWorld) this.world.changedEntities.add(this);
  }

  getAOIid() {
    return this.world.areaAt(this.x, this.y).id;
  }

  isPlayer(): this is Player {
    return this.category === 'player';
  }

  isMonster(): this is Monster {
    return this.category === 'monster';
  }

  isItem(): this is Item {
    return this.category === 'item';
  }
}

export = GameObject;
