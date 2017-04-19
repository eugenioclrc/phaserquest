/**
 * Created by Jerome on 24-02-17.
 */


const GameServer = require('./GameServer.js').GameServer;
const GameObject = require('./GameObject.js').GameObject; // Parent class of all game objects : players, monsters and items (not NPC because they are not processed server-side)

class Item extends GameObject {
  constructor(x, y, content, respawn, chest, loot) {
    super();
    this.id = GameServer.lastItemID++;
    this.x = x;
    this.y = y;
    this.category = 'item';
    // content is the array of possible items in case of a chest, or the item itself in case of non-chest ;
    // 'item' will be the final content, randomly picked from 'content' in setContent()
    this.content = content;
    this.respawn = respawn; // can the item respawn after being piked (boolean)
    this.chest = chest; // is the item contained in a chest (boolean)
    this.inChest = chest; // is the item currently within its chest, or has the chest been opened (boolean)
    this.loot = loot; // is the item some loot from a monster (boolean) ; only used client-side
    this.spawn();
  }


  trim() {
    const trimmed = {};
    const broadcastProperties = ['id', 'x', 'y', 'itemID', 'visible', 'respawn', 'chest', 'inChest', 'loot'];
    for (let p = 0; p < broadcastProperties.length; p++) {
      trimmed[broadcastProperties[p]] = this[broadcastProperties[p]];
    }
    return trimmed;
  }

  pick() {
    if (!this.visible) return;
    this.setProperty('visible', false);
    if (this.respawn) {
      GameServer.respawnCount(this.x, this.y, this, this.spawn, GameServer.itemRespawnDelay);
    } else {
      GameServer.removeFromLocation(this);
    }
  }

  open() {
    this.setProperty('inChest', false);
    this.makeTemporary();
  }

  makeTemporary() {
    setTimeout((item) => {
      item.pick();
    }, GameServer.itemVanishDelay, this);
  }

  spawn() {
    this.setProperty('inChest', this.chest);
    this.setProperty('visible', true);
    this.setContent();
  }

  setContent() {
    if (this.content === undefined) this.content = 'item-flask';
    const content = this.content.split(',');
    const item = (this.chest ? 'item-' : '') + content[Math.floor(Math.random() * content.length)];
    const itemID = (GameServer.db.items[item] ? GameServer.db.items[item].id : 100);
    this.itemKey = item;
    this.setProperty('itemID', itemID);
  }
}

module.exports.Item = Item;
