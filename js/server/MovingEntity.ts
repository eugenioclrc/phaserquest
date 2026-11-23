/**
 * Created by Jerome on 24-02-17.
 */

import type { PathAction, Tile } from '../../shared/WorldProtocol.ts';
import GameObject = require('./GameObject.ts');
import Route = require('./Route.ts');

abstract class MovingEntity extends GameObject {
  protected abstract updateFight(): void;
  name!: string;
  speed!: number;
  life!: number;
  maxLife!: number;
  atk!: number;
  def!: number;
  inFight = false;
  targetID: number | null = null;
  target: MovingEntity | null = null;
  alive = true;
  routeVersion = 0;
  route?: Route;
  lastHitter?: MovingEntity | number;
  private foes: MovingEntity[] = [];
  protected lastFightUpdate = Date.now();
  lastDamage = Date.now();
  lastWalkUpdate = Date.now();

  setRoute(path: Tile[], departureTime: number, latency: number, action?: PathAction, orientation?: number) {
    this.route = new Route(path, departureTime, latency, action, orientation);
    this.routeVersion++;
    if (this.inWorld) this.world.changedEntities.add(this);
  }

  setTarget(target: MovingEntity | null) {
    this.target = target;
    this.setProperty('targetID', target?.id ?? -1);
  }

  update() {
    if (this.inFight && (Date.now() - this.lastFightUpdate) >= this.world.fightUpdateDelay) this.updateFight();
    if (this.route && (Date.now() - this.lastWalkUpdate) >= this.world.walkUpdateDelay) this.updateWalk();
    if (this.isMonster() && (Date.now() - this.lastPositionCheck) >= this.world.positionCheckDelay) this.checkPosition();
  }

  updateWalk() {
    const route = this.route;
    if (!route) return;
    // Based on the speed of the entity and the time elapsed since it started moving along a path,
    // compute on which tile of the path it should be at this time. If path ended, check what should happen.
    this.lastWalkUpdate = Date.now();
    const previousX = this.x;
    const previousY = this.y;
    // this.speed is the amount of time need to travel a distance of 1 tile;
    // delta = the number of tiles traveled since departure
    const elapsed = Math.max(0, this.lastWalkUpdate - route.departureTime) / this.speed;
    let delta = this.isPlayer() ? Math.floor(elapsed) : Math.ceil(elapsed);
    const maxDelta = route.path.length - 1;
    if (delta > maxDelta) delta = maxDelta;
    route.step = delta;
    this.x = route.path[delta].x;
    this.y = route.path[delta].y;
    if (delta == maxDelta) {
      if (this.isPlayer()) {
        this.world.checkDoor(this);
        this.world.checkItem(this);
        this.world.checkAction(this);
        this.world.checkSave(this);
      }
      this.clearRoute();
    }
    if (this.x != previousX || this.y != previousY) {
      this.world.moveAtLocation(this, previousX, previousY, this.x, this.y);
      if (this.isPlayer()) this.world.checkMonster(this);
    }
  }

  clearRoute() {
    if (!this.route) return;
    this.route = undefined;
    this.routeVersion++;
    if (this.inWorld) this.world.changedEntities.add(this);
  }

  getPathEnd() {
    return this.route?.path.at(-1) ?? { x: this.x, y: this.y };
  }

  startFight(target: MovingEntity) {
    if (!this.alive || !target.alive) return;
    if (!this.target) this.setTarget(target);
    this.addFoe(target);
    this.setProperty('inFight', true);
  }

  damage() {
    if (!this.alive || !this.target || !this.target.alive) return;
    if (this.world.adjacentNoDiagonal(this, this.target) <= 0) return;
    if ((Date.now() - this.lastDamage) < this.world.damageDelay) return;
    this.lastDamage = Date.now();
    let damage = (this.atk * this.world.randomInt(5, 10)) - (this.target.def * this.world.randomInt(1, 3));
    damage = (damage <= 0 ? this.world.randomInt(1, 3) : damage);
    this.target.lastHitter = this;
    const target = this.target;
    const difference = Math.abs(target.updateLife(-damage));
    if (this.isPlayer()) {
      this.updatePacket.addHP(true, difference, target.id);
      if (!target.alive) this.world.handleKill(this, target);
    } else if (this.isMonster() && target.isPlayer()) {
      target.updatePacket.addHP(false, difference, this.id); // false = self
    }
  }

  updateLife(incr: number) {
    const tmp = this.life;
    this.life += incr;
    if (this.life <= 0) {
      this.life = 0;
      this.die();
    } else if (this.life > this.maxLife) {
      this.life = this.maxLife;
    }
    const difference = this.life - tmp;
    return difference;
  }

  die() {
    this.clearRoute();
    this.manageFoes();
    if (this.lastHitter && typeof this.lastHitter !== 'number') this.setProperty('lastHitter', this.lastHitter.id);
    this.endFight();
    this.setProperty('alive', false);
    if (this.isMonster()) {
      this.world.respawnCount(this.startX, this.startY, () => this.respawn(), this.world.monsterRespawnDelay);
      const { lootTable, x, y } = this;
      this.world.schedule(() => this.world.dropLoot(lootTable, x, y), 200);
      if (this.chestArea) this.chestArea.decrement();
    }
  }

  respawnAt(x: number, y: number) {
    const previousX = this.x;
    const previousY = this.y;
    this.x = x;
    this.y = y;
    this.life = this.maxLife;
    this.world.moveAtLocation(this, previousX, previousY, x, y);
    this.setProperty('alive', true);
  }

  endFight() {
    this.setProperty('inFight', false);
    this.setTarget(null);
  }

  manageFoes() {
    for (let i = 0; i < this.foes.length; i++) {
      const foe = this.foes[i];
      foe.endFight();
      foe.removeFoe(this);
      foe.switchOpponent();
    }
    this.foes = [];
  }

  hasFoe(foe: MovingEntity) {
    return this.foes.indexOf(foe) > -1;
  }

  addFoe(foe: MovingEntity) {
    const idx = this.foes.indexOf(foe);
    if (idx == -1) this.foes.push(foe);
  }

  removeFoe(foe: MovingEntity) {
    const idx = this.foes.indexOf(foe);
    if (idx >= 0) this.foes.splice(idx, 1);
  }

  switchOpponent() {
    if (this.foes.length) {
      this.world.schedule(() => this.world.setUpFight(this, this.foes[0]), 300);
    }
  }
}

export = MovingEntity;
