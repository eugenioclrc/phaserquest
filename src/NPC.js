/**
 * Created by Jerome on 25-02-17.
 */

import game from './phaser-game';
import Game from './Game';
import Human from './Human';

export default class NPC extends Human {
  constructor(x, y, key) {
    // key is a string use as a key in Game.npcInfo to fetch the necessary
    // information about the NPC to create
    super(x, y, 'atlas1');
    this.types.push('NPC');
    this.typeObject = 'NPC';

    this.rate = 2; // animation rate
    this.absorbProperties(Game.npcInfo[key]);
    if (this.customAnchor) {
      this.anchor.set(this.customAnchor.x, this.customAnchor.y);
    } else {
      this.anchor.set(0, 0.25);
    }
    this.addChild(game.add.sprite(0, 4, 'atlas1', 'shadow'));
    Game.setHoverCursors(this, Game.talkCursor);
    const tile = Game.computeTileCoords(this.x, this.y);
    Game.collisionArray[tile.y][tile.x] = 1; // So that you have to walk around NPC
    this.events.onInputUp.add(Game.handleCharClick, this);
  }
}
