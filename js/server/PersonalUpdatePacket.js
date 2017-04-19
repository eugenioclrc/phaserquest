/**
 * Created by Jerome on 26-12-16.
 */

class PersonalUpdatePacket {
  constructor() {
    this.hp = []; // list of hp values to display as the result of fight actions between the player and enemies
    this.killed = []; // list of id's of monsters killed since last update
    this.used = []; // list of id's of items used/picked since last update
  }

  isEmpty() {
    if (this.life !== undefined) return false; // current value of the health of the player
    if (this.x !== undefined) return false;
    if (this.y !== undefined) return false;
    if (this.noPick !== undefined) return false; // boolean ; need to send a message about an item not being picked or not
    if (this.hp.length > 0) return false;
    if (this.killed.length > 0) return false;
    if (this.used.length > 0) return false;
    return true;
  }

  clean() { // Remove empty arrays from the package
    if (!this.hp.length) delete this.hp;
    if (!this.killed.length) delete this.killed;
    if (!this.used.length) delete this.used;
    return this;
  }

  updatePosition(x, y) {
    this.x = x;
    this.y = y;
  }

  updateLife(life) {
    this.life = life;
  }

  addHP(target, hp, from) {
    // target (boolean) ; hp : int ; from : id (int)
    this.hp.push({ target, hp, from });
  }

  addKilled(id) {
    this.killed.push(id);
  }

  addUsed(id) {
    this.used.push(id);
  }

  addNoPick() {
    this.noPick = true;
  }
}

module.exports.PersonalUpdatePacket = PersonalUpdatePacket;
