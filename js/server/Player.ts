/**
 * Created by Jerome on 26-12-16.
 */

import type { Tile } from '../../shared/WorldProtocol.ts';
import protocol = require('../../shared/WorldProtocol.ts');
import type GameServer = require('./GameServer.ts');
import type Item = require('./Item.ts');
import MovingEntity = require('./MovingEntity.ts');
import PersonalUpdatePacket = require('./PersonalUpdatePacket.ts');
import type { CharacterDocument, CharacterSave, Door } from './WorldTypes.ts';

class Player extends MovingEntity {
  readonly category = 'player';
  private mongoId!: string;
  weapon!: number;
  armor!: number;
  lastSavedPosition!: Tile;
  lastDoor?: Tile;
  lastOutdoorPosition?: Tile;
  updatePacket = new PersonalUpdatePacket();

  constructor(world: typeof GameServer, name = '') {
    const { x, y } = world.determineStartingPosition();
    super(world, x, y);
    this.name = name;
    this.setAOI();
    this.maxLife = 100;
    this.life = this.maxLife;
    this.speed = protocol.playerStepMs;
    this.equip(1, 'sword1');
    this.equip(2, 'clotharmor');
  }

  setAOI() {
    this.aoi = this.getAOIid();
  }

  setIDs(dbId: string) {
    this.id = this.world.lastPlayerID++;
    this.mongoId = dbId;
  }

  getMongoID() {
    return this.mongoId;
  }

  setLastSavedPosition() {
    this.lastSavedPosition = { x: this.x, y: this.y };
  }

  dbTrim(): CharacterSave {
    return {
      x: this.x, y: this.y, name: this.name,
      weapon: this.world.db.itemsIDmap[this.weapon],
      armor: this.world.db.itemsIDmap[this.armor],
    };
  }

  getDataFromDb(document: CharacterDocument) {
    this.x = Number(document.x);
    this.y = Number(document.y);
    this.name = document.name;
    this.setAOI();
    this.equip(1, document.weapon);
    // Older saves could write the burger key for Firefox armor because they shared an ID.
    this.equip(2, document.armor === 'item-burger' ? 'firefox' : document.armor);
  }

  getIndividualUpdatePackage() {
    if (this.updatePacket.isEmpty()) return null;
    const pkg = this.updatePacket;
    this.updatePacket = new PersonalUpdatePacket();
    return pkg;
  }

  updateFight() {
    this.lastFightUpdate = Date.now();
    if (!this.target || !this.target.alive) return;
    const direction = this.world.adjacentNoDiagonal(this, this.target);
    if (direction > 0) this.damage();
  }

  regenerate() {
    this.updateLife(2);
  }

  equip(type: 1 | 2, item: string) {
    const equipInfo = this.world.db.items[item];
    if (type == 1) {
      this.atk = equipInfo.atk ?? 0;
      this.setProperty('weapon', equipInfo.id);
    } else if (type == 2) {
      this.def = equipInfo.def ?? 0;
      this.setProperty('armor', equipInfo.id);
    }
  }

  applyItem(item: Item) {
    const itemInfo = this.world.db.items[item.itemKey];
    if (itemInfo === undefined) {
      console.error('WARNING : undefined data for item : ');
      console.log(item);
      return;
    }
    let picked = true;
    if (itemInfo.heals) {
      const difference = this.updateLife(itemInfo.heals);
      this.updatePacket.addHP(false, difference); // / false = self
      this.updatePacket.addUsed(itemInfo.id);
    } else if (itemInfo.equip) {
      const equipInfo = this.world.db.items[itemInfo.equip];
      const type = equipInfo.type;
      if (type === 1) { // Weapon
        if (this.atk >= (equipInfo.atk ?? 0)) { // don't pick up if a better item is already equipped
          this.updatePacket.addNoPick();
          picked = false;
        }
      } else if (type === 2) { // Armor
        if (this.def >= (equipInfo.def ?? 0)) {
          this.updatePacket.addNoPick();
          picked = false;
        }
      }
      if (picked) {
        if (type === 1 || type === 2) this.equip(type, itemInfo.equip);
        if (!this.lastOutdoorPosition) this.world.savePlayer(this);
        this.updatePacket.addUsed(equipInfo.id);
      }
    }
    return picked;
  }

  teleport(door: Door) {
    this.lastDoor = { x: this.x, y: this.y };
    if (door.camera) this.lastOutdoorPosition ??= this.lastDoor;
    else this.lastOutdoorPosition = undefined;
    this.x = door.to.x;
    this.y = door.to.y;
    this.updatePacket.teleport = { x: this.x, y: this.y };
    this.manageFoes();
    this.endFight();
  }

  revive() {
    if (this.alive) return;
    this.lastDoor = undefined;
    this.lastOutdoorPosition = undefined;
    this.respawnAt(this.lastSavedPosition.x, this.lastSavedPosition.y);
    this.updatePacket.updatePosition(this.x, this.y);
  }
}
export = Player;
