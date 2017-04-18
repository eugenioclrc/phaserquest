/**
 * Created by Jerome on 08-11-16.
 */

// Object representing a "chest area", that is, an area where a chest spawns
// if all present monsters are killed
class ChestArea {
  constructor(properties, callback) {
    // number of monsters currently in the area
    this.actualN = 0;
    // total number of monsters normally in the area
    this.maxN = 0;
    // properties such as the coordinates of the chest and its content (read
    // from the Tiled map)
    this.properties = properties;
    // an area is active only once all its monsters have respawn. Before then,
    // killing monsters in it won't trigger the chest.
    this.active = true;
    this.callback = callback;
  }

  incrementAll() {
    this.actualN += 1;
    this.maxN += 1;
  }

  increment() {
    this.actualN += 1;
      // Called when a monster respawns; when they have all respawned, the area becomes active again
    if (this.actualN === this.maxN) {
      this.active = true;
    }
  }

  decrement() {
    this.actualN -= 1;
    // Spawn the chest when all the monsters of an active area have been cleared
    if (this.active && this.actualN === 0) {
      this.callback(this.properties);
      // Will become active again when all monsters have respawn, not before
      this.active = false;
    }
  }
}

module.exports.ChestArea = ChestArea;
