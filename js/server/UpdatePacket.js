/**
 * Created by Jerome on 26-12-16.
 */

class UpdatePacket {
  constructor() {
  // new player objects to add to the world
    this.newplayers = [];
    this.newitems = [];
    this.newmonsters = [];
  // list of id's of disconnected players since last update
    this.disconnected = [];
  // list of player objects already existing for which properties have been update
    this.players = {};
    this.items = {};
    this.monsters = {};
  }

  addObject(object) {
    const switchCategory = {
      player: this.newplayers,
      item: this.newitems,
      monster: this.newmonsters,
    };
    const arr = switchCategory[object.category];
    // Check that the object to insert is not already present (possible since
    // when pulling updates from neighboring AOIs)
    for (let i = 0; i < arr.length; i += 1) {
      if (arr[i].id === object.id) return;
    }
    arr.push(object.trim());
  }

  addDisconnect(playerID) {
    this.disconnected.push(playerID);
  }

  updateRoute(type, entityID, route) {
    const map = (type === 'player' ? this.players : this.monsters);
    if (!map[entityID]) {
      map[entityID] = {};
    }
    map[entityID].route = route;
  }

  updateProperty(type, id, property, value) {
    // console.log('updating property type = '+type+', id = '+id+', prop = '+property+', val = '+value);
    const mapType = {
      item: this.items,
      player: this.players,
      monster: this.monsters,
    };

    const map = mapType[type];

    if (!map[id]) {
      map[id] = {};
    }
    if (map[id][property] !== value) {
      map[id][property] = value;
    }
  }

// Remove "echo", i.e. redundant info or info reflected to the player having sent it
  removeEcho(playerID) {
    // The target player of an update package should not receive route info about itself
    if (this.players[playerID]) {
      delete this.players[playerID].route;
      if (Object.keys(this.players[playerID]).length === 0) {
        delete this.players[playerID];
      }
    }
    // Iterate throught the list of newplayer objects
    let i = this.newplayers.length;
    while (i--) {
      const n = this.newplayers[i];
      // if the newplayer is the target player of the update packet, info is echo, removed
      if (n.id === playerID) {
        this.newplayers.splice(i, 1);
      } else {
        // Otherwise, check for redundancies between player and newplayer objects and remove them
        for (let j = 0; j < Object.keys(this.players).length; j += 1) {
          const key = Object.keys(this.players)[j];
          if (n.id === key) {
            delete this.players[Object.keys(this.players)[j]];
          }
        }
      }
    }
  }
// Get updates about all entities present in the list of AOIs
  synchronize(AOI) {
    for (let i = 0; i < AOI.entities.length; i += 1) {
      // don't send the trimmed version, the trim is done in adObject()
      this.addObject(AOI.entities[i]);
    }
  }

  isEmpty() {
    if (Object.keys(this.players).length > 0) return false;
    if (Object.keys(this.monsters).length > 0) return false;
    if (Object.keys(this.items).length > 0) return false;
    if (this.newplayers.length > 0) return false;
    if (this.newitems.length > 0) return false;
    if (this.newmonsters.length > 0) return false;
    if (this.disconnected.length > 0) return false;
    return true;
  }

  clean() {
    if (!Object.keys(this.players).length) delete this.players;
    if (!Object.keys(this.monsters).length) delete this.monsters;
    if (!Object.keys(this.items).length) delete this.items;
    if (!this.newplayers.length) delete this.newplayers;
    if (!this.newitems.length) delete this.newitems;
    if (!this.newmonsters.length) delete this.newmonsters;
    if (!this.disconnected.length) delete this.disconnected;
    return this;
  }
}
module.exports = UpdatePacket;
