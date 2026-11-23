/**
 * Created by Jerome on 24-02-17.
 */

import type { Tile } from '../../shared/WorldProtocol.ts';
import type ChestArea = require('./ChestArea.ts');
import type GameServer = require('./GameServer.ts');
import MovingEntity = require('./MovingEntity.ts');
import type { LootChoice, MonsterDefinition } from './WorldTypes.ts';

class Monster extends MovingEntity {
  readonly category = 'monster';
  readonly monster: number;
  readonly startX: number;
  readonly startY: number;
  readonly aggro: boolean;
  readonly lootTable?: LootChoice[];
  chestArea?: ChestArea;
  lastPositionCheck = Date.now();

  constructor(world: typeof GameServer, { x, y }: Tile, info: MonsterDefinition) {
    super(world, x, y);
    this.id = world.lastMonsterID++;
    this.startX = x;
    this.startY = y;
    this.lootTable = world.formatLootTable(info.lootTable);
    this.monster = info.id;
    this.aggro = info.aggressive ?? true;
    this.maxLife = info.life;
    this.life = this.maxLife;
    this.speed = info.speed;
    this.atk = info.atk;
    this.def = info.def;
    this.name = info.name;
  }

  respawn() {
    this.respawnAt(this.startX, this.startY);
    if (this.chestArea) this.chestArea.increment();
  }

  updateFight() {
    this.lastFightUpdate = Date.now();
    if (!this.alive || !this.target?.alive) return;
    const direction = this.world.adjacentNoDiagonal(this, this.target);
    let end: Tile | undefined;
    if (direction === -1) { // Player is on very same cell
      end = this.world.findFreeAdjacentCell(this.x, this.y);
    } else if (direction === 0) { // Player is not on adjacent cell
      end = (this.target.route ? this.target.getPathEnd() : { x: this.target.x, y: this.target.y });
    }
    if (direction > 0) {
      this.damage();
    } else if (end) {
      this.move(end, direction !== -1);
    }
  }

  checkPosition() {
    this.lastPositionCheck = Date.now();
    if (!this.inFight && !this.route && (this.x != this.startX || this.y != this.startY)) this.move({ x: this.startX, y: this.startY }, false);
  }

  move(end: Tile, stopBeforeEnd: boolean) {
    const steps = this.world.pathfinder.findPath(this.x, this.y, end.x, end.y, this.world.PFgrid.clone());
    if (stopBeforeEnd) steps.pop();
    if (!steps.length) return;

    const path = steps.map(([x, y]) => ({ x, y }));
    const next = path[path.length - 1];
    const currentEnd = this.getPathEnd();
    if (this.route && next.x === currentEnd.x && next.y === currentEnd.y) return;
    this.setRoute(path, Date.now(), 0);
  }
}
export = Monster;
