/**
 * Created by Jerome on 25-02-17.
 */

import Being from './Being';
import Game from './Game';

export default class Human extends Being {
  // Child of Being, parent of NPC and Player (the common aspect being the handling of speech bubbles)
  // key is a string indicating the atlas to use as texture
  
  generateBubble() {
    this.bubble = Game.makeBubble();
    this.bubble.alpha = 0.6;
    this.bubble.exists = false;
  }

  displayBubble(text) {
    // Displays a speech bubble above a character, containing the string in text
    const maxTextWidth = 200;
    if (!text) {
      if (this.bubble) this.killBubble();
      return;
    }
    if (!this.bubble) this.generateBubble();
    this.bubble.exists = true;
    const txt = this.bubble.getChildAt(10);
    txt.text = text;
    txt.style.wordWrap = true;
    txt.style.wordWrapWidth = maxTextWidth;
    let width = Phaser.Math.clamp(txt.width, 30, maxTextWidth);
    if (width % 2 != 0) width++; // Odd widths cause gaps in the bubbles
    const height = txt.height;
    // Compute coordinates of pieces of the speech bubble
    const ls = Game.speechBubbleCornerSize;
    const rs = ls + width;
    const ts = Game.speechBubbleCornerSize;
    const bs = ts + height;
    // Tail offset: positive value to place the tail approx. in the middle of the bubble
    const tail_offset = (width + 2 * Game.speechBubbleCornerSize) / 2;
    const tail_y = bs + Game.speechBubbleCornerSize;
    this.bubble.lifespan = Phaser.Timer.SECOND * 5; // Disappears after 5 sec
    txt.anchor.x = 0.5;
    txt.x = width / 2 + Game.speechBubbleCornerSize;
    txt.y = ts;
    this.bubble.getChildAt(1).width = width; // top side
    this.bubble.getChildAt(2).x = rs; // top right corner
    this.bubble.getChildAt(3).height = height; // left side
    this.bubble.getChildAt(4).width = width; // center
    this.bubble.getChildAt(4).height = height; // center
    this.bubble.getChildAt(5).x = rs; // right side
    this.bubble.getChildAt(5).height = height; // right side
    this.bubble.getChildAt(6).y = bs; // bottom left corner
    this.bubble.getChildAt(7).width = width; // bottom side
    this.bubble.getChildAt(7).y = bs; // bottom side
    this.bubble.getChildAt(8).x = rs; // bottom right corner
    this.bubble.getChildAt(8).y = bs; // bottom right corner
    this.bubble.getChildAt(9).x = tail_offset; // tail
    this.bubble.getChildAt(9).y = tail_y; // tail
    this.bubble.postUpdate = function () { // Ensures that the bubble follows the character if he moves
      this.bubble.x = this.x - (tail_offset - 20);
      this.bubble.y = this.y + (this == Game.player ? -this.height : -(this.height + 13)) - txt.height + 16;
    }.bind(this);
    Game.sounds.play('chat');
  }

  killBubble() {
    this.bubble.kill();
  }
}
