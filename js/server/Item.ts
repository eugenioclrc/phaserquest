/**
 * Created by Jerome on 24-02-17.
 */


import type GameServer = require('./GameServer.ts');
import GameObject = require('./GameObject.ts');

class Item extends GameObject {
  readonly category = 'item';
  visible = false;
  inChest: boolean;
  itemID!: number;
  itemKey!: string;

  constructor(
    world: typeof GameServer, x: number, y: number, private readonly content: string | undefined,
    readonly respawn: boolean, readonly chest: boolean, readonly loot: boolean,
  ) {
    super(world, x, y);
    this.id = world.lastItemID++;
    this.inChest = chest;
    this.spawn();
  }

  pick() {
    if (!this.visible) return;
    this.setProperty('visible', false);
    if (this.respawn) {
      this.world.respawnCount(this.x, this.y, () => this.spawn(), this.world.itemRespawnDelay);
    } else {
      this.world.removeFromLocation(this);
    }
  }

  open() {
    this.setProperty('inChest', false);
    this.makeTemporary();
  }

  makeTemporary() {
    this.world.schedule(() => this.pick(), this.world.itemVanishDelay);
  }

  spawn() {
    this.setProperty('inChest', this.chest);
    this.setProperty('visible', true);
    this.setContent();
  }

  setContent() {
    const content = (this.content ?? 'item-flask').split(',');
    const item = (this.chest ? 'item-' : '') + content[Math.floor(Math.random() * content.length)];
    const itemID = (this.world.db.items[item] ? this.world.db.items[item].id : 100);
    this.itemKey = item;
    this.setProperty('itemID', itemID);
  }
}

export = Item;
