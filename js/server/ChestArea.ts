/**
 * Created by Jerome on 08-11-16.
 */

// Object representing a "chest area", that is, an area where a chest spawns
// if all present monsters are killed
import type { ChestContents } from './WorldTypes.ts';

class ChestArea {
  private actualN = 0;
  private maxN = 0;
  private active = true;

  constructor(private readonly properties: ChestContents, private readonly callback: (properties: ChestContents) => void) {}

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

export = ChestArea;
