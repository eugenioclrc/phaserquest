import type { PlayerEvents, Tile } from '../../shared/WorldProtocol.ts';

class PersonalUpdatePacket {
  private readonly hp: NonNullable<PlayerEvents['hp']> = [];
  private readonly killed: number[] = [];
  private readonly used: number[] = [];
  private noPick?: boolean;
  private x?: number;
  private y?: number;
  teleport?: Tile;

  isEmpty() {
    return this.x === undefined && this.y === undefined && this.teleport === undefined &&
      this.noPick === undefined && !this.hp.length && !this.killed.length && !this.used.length;
  }

  clean(): PlayerEvents & Partial<Tile> & { teleport?: Tile } {
    const update: PlayerEvents & Partial<Tile> & { teleport?: Tile } = {};
    if (this.x !== undefined) update.x = this.x;
    if (this.y !== undefined) update.y = this.y;
    if (this.teleport) update.teleport = this.teleport;
    if (this.noPick !== undefined) update.noPick = this.noPick;
    if (this.hp.length) update.hp = this.hp;
    if (this.killed.length) update.killed = this.killed;
    if (this.used.length) update.used = this.used;
    return update;
  }

  updatePosition(x: number, y: number) {
    this.x = x;
    this.y = y;
  }

  addHP(target: boolean, hp: number, monsterId?: number) {
    this.hp.push({ target, hp, monsterId });
  }

  addKilled(id: number) {
    this.killed.push(id);
  }

  addUsed(id: number) {
    this.used.push(id);
  }

  addNoPick() {
    this.noPick = true;
  }
}

export = PersonalUpdatePacket;
