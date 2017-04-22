/**
 * Created by Jerome on 14-10-16.
 */
/*
 * Author: Jerome Renaux
 * E-mail: jerome.renaux@gmail.com
 */
/* global Phaser */
import game from './phaser-game';
import Game from './Game';
import Client from './Client';
import Player from './Player';

// used to map the orientation of the player, stored as a number, to the actual
// name of the orientation
// (used to select the right animations to play, by name)
const orientationsDict = {
  1: 'left',
  2: 'up',
  3: 'right',
  4: 'down',
};


// Helper function to make a sprite object absorb all the properties of a
// provided JSON object; Object.assign() should work as well

Phaser.Sprite.prototype.absorbProperties = function absorbProperties(object) {
  Object.keys(object).forEach((k) => {
    if (object[k]) {
      this[k] = object[k];
    }
  });
};

// Being is the topmost class encompassing all "living" sprites, be it players,
// NPC or monsters (not items)
export default class Being extends Phaser.Sprite {
  constructor(x, y, key) {
    super(game, x, y, key);
    this.types = ['Being'];
    this.typeObject = 'Being';
    // key is the string indicating which atlas to use
    // Call to constructor of parent
    this.speed = 0;
    this.destination = null;
    game.add.existing(this);
  }

  setAnimations(object) {
  // object is the sprite to animate
  // Players and monsters have a bunch of similar needs in terms of animations:
  // - Moving in all 4 directions
  // - Attacking in all 4 directions
  // - Idling in all 4 directions
  // + dying
  // This function sets up the animations for all cases by specifying which
  // frames should be used for each, based on
  // default frames or JSON data from db.json
    let frames = this.frames || this.defaultFrames;
    let framePrefix;
    if (object === this.weapon) {
      frames = this.defaultFrames;
      framePrefix = this.weapon.name;
    } else {
      framePrefix = (object.typeObject === 'Monster' ? this.monsterName : this.armorName);
    }
    const rates = { // Rates of the different kinds of animations
      '': 8,
      idle_: (frames.idle_rate ? frames.idle_rate : 2),
      attack_: 14,
    };
    let deathframes;
    if (frames.death) {
    // Fetch death animation, or make a default one
      deathframes = Phaser.Animation.generateFrameNames(`${framePrefix}_`, frames.death[0], frames.death[1]);
    } else {
      deathframes = Phaser.Animation.generateFrameNames('death_', 0, 5);
    }
    object.animations.add('death', deathframes, 8, false);
    const prefixes = ['', 'idle_', 'attack_'];
    const directions = ['down', 'up', 'left', 'right'];
    for (let p = 0; p < prefixes.length; p += 1) {
      for (let d = 0; d < directions.length; d += 1) {
        const animation = prefixes[p] + directions[d];
        if (frames[animation]) {
          // The frames data for a given animation in the JSON is an array of
          // two (optionally three) values :
          // 0 : number of the beginning frame of the animation
          // 1 : number of the end frame of the animation
          // (2 : number of the frame to come back to at the end of the animation,
          // if not end frame)
          // The final animation will consist in all frames between begin and
          // end, + the optional comeback frame
          const fms = Phaser.Animation.generateFrameNames(`${framePrefix}_`, frames[animation][0], frames[animation][1]);
          // if comeback frame, add it
          if (frames[animation][2]) {
            fms.push(`${framePrefix}_${frames[animation][2]}`);
          }
          // The last boolean is whether the animation should loop or
          // not ; always the case except for attacks
          object.animations.add(animation, fms, rates[prefixes[p]], (prefixes[p] !== 'attack_'));
        }
      }
    }
  }

  // Start idling animation, in the appropriate orientation
  idle(force) {
    // force is a boolean to indicate if the animation should be forced to play,
    // or if it can depend from the situation (see animate() )
    this.animate(`idle_${orientationsDict[this.orientation]}`, force);
  }

  attackAndDisplay(hp) { // Attack a target and display HP above it subsequently
    // hp is the integer of hit points to display
    if (!this.target) return;
    this.attack();
    this.target.displayHP(hp);
  }

  attack() {
    const Player = require('./Player').default;
    if (!this.target) return;
    const direction = Game.adjacent(this, this.target);
    if (direction > 0) this.orientation = direction;
    this.animate(`attack_${orientationsDict[this.orientation]}`, false);
    if (this.inCamera) {
      const sound = (this instanceof Player ? 'hit1' : 'hurt');
      Game.sounds.play(sound);
    }
    if (this.target.deathmark) {
      setTimeout((_target) => {
        _target.die(true);
      }, 500, this.target);
    }
    this.idle();
  }

  flagForDeath() {
    this.deathmark = true;
  }

  displayHP(hp) {
    // hp is the integer of hit points to display
    let color = 'hit';
    if (this.isPlayer) {
      color = hp >= 0 ? 'heal' : 'hurt';
    }
    Game.displayHP(hp, color, this, Game.HPdelay);
    if (this.isPlayer && hp > 0) Game.sounds.play('heal');
  }

  endFight() {
    if (this.fightTween) this.fightTween.stop();
    this.fightTween = null;
    this.inFight = false;
    this.deathmark = false;
    this.idle(false);
    // don't nullify target
  }

  adjustStartPosition(start) {
    // Prevents small "hiccups" in the tween when changing direction while already moving
    // start is a 2-tuple of the coordinates of the starting position to adjust
    switch (this.orientation) {
      case 3: // right
        if (this.x % 32 !== 0) {
          start.x += 1;
        }
        break;
      case 4: // down
        if (this.y % 32 !== 0) {
          start.y += 1;
        }
        break;
      default:
        break;
    }
    return start;
  }

  pathfindingCallback(finalOrientation, action, delta, sendToServer, path) {
    // This function is called when the pathfinding algorithm has successfully
    // found a path to navigate finalOrientation is a value between 1 and 4
    // indicatinh the orientation the player should have at the end of the path
    // action is a small object containing data about what to do once the path
    // is ended (talk to NPC, fight monster, ...) delta is some value based on
    // latency, that will slightly adjust the speed of the movement to compensate
    // for the latency sendToServer is a boolean indicating if the computed
    // path should be sent to the server (because it's the path that the player
    // wants to follow) path is an array of 2-tuples of coordinates
    if (path === null && this.isPlayer) {
      Game.moveTarget.visible = false;
      Game.marker.visible = true;
    } else if (path !== null) {
      if (action.action === 3 || action.action === 4) { // fight or chest
        finalOrientation = Game.computeFinalOrientation(path);
        path.pop(); // The player should stop right before the target, not at its location
      }
      const actionToSend = (action.action !== 1 ? action : { action: 0 });
      if (this.isPlayer && sendToServer && path.length) {
        Client.sendPath(path, actionToSend, finalOrientation);
      }
      this.move(path, finalOrientation, action, delta);
    }
  }

  move(path, finalOrientation, action, delta) {
    // This function make a sprite move according to a determined path
    // action is a small object containing data about what to do once the path
    // is ended (talk to NPC, fight monster, ...)
    // delta is some value based on latency, that will slightly adjust the
    // speed of the movement to compensate for the latency (e.g. if you receive
    // information that player A moved to a specific location, but you have
    // 200ms latency, A should move 200ms faster to arrive at the end location
    // at the same time as he would if you had received the message instantly)
    if (!path.length) {
      this.finishMovement(finalOrientation, action);
      return;
    }
    // Converts the cell coordinates in pixels coordinates, for the movement tween
    const xSteps = [];
    const ySteps = [];
    for (let q = 0; q < path.length; q += 1) {
      xSteps.push(path[q].x * Game.map.tileWidth);
      ySteps.push(path[q].y * Game.map.tileWidth);
    }
    const tween = game.add.tween(this);
    // timestamp at which the orientation of the sprite was checked for the last time
    this.lastOrientationCheck = 0;
    // duration of the movement, based on player speed, path length and latency
    const duration = Math.ceil(Math.max(1, (path.length * this.speed) - delta));
    tween.to({ x: xSteps, y: ySteps }, duration);
    // Rate at which the orientation of the sprite will be checked (see below)
    const checkRate = (this instanceof Player ? 0.7 : 0.4);
    tween.onUpdateCallback(function onUpdateCallback() {
      // At a regular interval (not each frame!), check in which direction the
      // sprite has moved and change its orientation accordingly
      if (Date.now() - this.lastOrientationCheck < this.speed * checkRate) {
        return;
      }
      this.lastOrientationCheck = Date.now();
      if (this.position.x > this.previousPosition.x) { // right
        this.orient(3);
      } else if (this.position.x < this.previousPosition.x) { // left
        this.orient(1);
      } else if (this.position.y > this.previousPosition.y) { // down
        this.orient(4);
      } else if (this.position.y < this.previousPosition.y) { // up
        this.orient(2);
      }
      this.animate(orientationsDict[this.orientation], false);
    }, this);
    tween.onComplete.add(function finishMove() {
      this.finishMovement(finalOrientation, action);
    }, this);
    this.tween = tween;
    tween.start();
  }

  orient(orientation) {
    // orientation is a value between 1 and 4 (see orientationsDict)
    if (this.orientation !== orientation) this.orientation = orientation;
  }

  stopMovement(complete) {
    // complete is a boolean indicating if the onComplete callback should be called
    this.tween.stop(complete);
    this.tween = null;
  }

  setPosition(x, y) {
    this.x = x * Game.map.tileWidth;
    this.y = y * Game.map.tileHeight;
  }

  finishMovement(finalOrientation, action) {
    const Player = require('./Player').default;

    // Called whenever a path has been travelled to its end; based on the action
    // object, the appropriate action is taken finalOrientation is a value between
    // 1 and 4 indicatinh the orientation the player should have at the end of the
    // path action is a small object containing data about what to do once the
    // path is ended (talk to NPC, fight monster, ...)
    if (this.isPlayer) {
      if (action.action === 1) { // talk
        action.character.displayBubble(action.text);
        if (!Game.speakAchievement) Game.handleSpeakAchievement();
      }
      Game.moveTarget.visible = false;
      Game.handleLocationAchievements();
    }
    // Check if the path ends on a teleport, and if so, teleport player
    if (this instanceof Player) {
      const door = Game.detectElement(Game.doors, this.x, this.y);
      if (door) finalOrientation = this.teleport(door);
    }
    if (finalOrientation) this.orient(finalOrientation);
    this.tween = null;
    this.idle(false);
    Game.sortEntities();
  }

  hasMoved() {
    return (this.position.x !== this.previousPosition.x) ||
      (this.position.y !== this.previousPosition.y);
  }

  animate(animation, force) {
    // Manage animations, depending on which animation is requested and which one
    // is currently playing animation is the string of the name of the animation
    // to play (death, attack_left, idle_right...)

    // If the requested animation is death, or the "force" flag is true, start
    // the requested animation no matter what
    if (animation === 'death' || force) {
      this.animations.stop();
      this.animations.play(animation);
      if (this.weapon) {
        // Weapon and character animations always need to be the same
        this.weapon.animations.play(animation);
      }
      return;
    }
    const currentAnim = this.animations.currentAnim;
    // If the currently playing animation is death, cancel the play of any other animation
    if (currentAnim.name === 'death') {
      return;
    }
    // if the current animation is not looping, let it finish before playing the requested one
    if (currentAnim.isPlaying && !currentAnim.loop) {
      // Make sure not to re-play the same animation
      if (currentAnim.name !== animation) {
        currentAnim.onComplete.addOnce(function completeAnim() {
          this.animate(animation, false);
        }, this);
      }
    } else { // if no animation is playing or it is looping, start the requested one immediately
      this.animations.play(animation);
      if (this.weapon) this.weapon.animations.play(animation);
    }
  }

  delayedDeath(delay) {
    setTimeout((_being) => {
      _being.die(true);
    }, delay, this);
  }

  delayedKill(delay) {
    setTimeout((_being) => {
      _being.kill();
    }, delay, this);
  }
}
