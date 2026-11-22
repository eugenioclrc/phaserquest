import type * as Phaser from 'phaser';
import type { MonsterSnapshot, Tile } from './protocol.ts';

export type MonsterDefinition = {
  id: number;
  name: string;
  achievement?: number;
  speed: number;
  customAnchor?: Tile;
  frames: Record<string, number[] | number>;
};

export class MonsterView {
  readonly sprite: Phaser.GameObjects.Image;
  alive = true;
  inFight = false;
  targetID?: number;
  private facing = 'down';
  private routeVersion?: number;
  private route?: { path: Tile[]; start: number };
  private diedAt?: number;

  constructor(
    scene: Phaser.Scene,
    private readonly key: string,
    private readonly definition: MonsterDefinition,
    private readonly width: number,
    private readonly height: number,
    snapshot: MonsterSnapshot,
  ) {
    const anchor = definition.customAnchor ?? { x: 0.25, y: 0.2 };
    this.sprite = scene.add.image(0, 0, 'monsters', `${key}_0`).setOrigin(anchor.x, anchor.y)
      .setInteractive({ pixelPerfect: true, useHandCursor: true });
    this.alive = snapshot.alive ?? true;
    this.apply(snapshot, scene.time.now);
  }

  get tile(): Tile {
    return { x: Math.round(this.sprite.x / this.width), y: Math.round(this.sprite.y / this.height) };
  }

  apply(changes: Partial<MonsterSnapshot>, now: number) {
    const changedRoute = changes.routeVersion !== undefined && changes.routeVersion !== this.routeVersion;
    if (changes.routeVersion !== undefined) this.routeVersion = changes.routeVersion;
    if ((changedRoute || !changes.route) && changes.x !== undefined && changes.y !== undefined) {
      this.place(changes.x, changes.y);
      this.route = undefined;
    }
    if (changes.targetID !== undefined) this.targetID = changes.targetID < 0 ? undefined : changes.targetID;
    if (changes.inFight !== undefined) this.inFight = changes.inFight;
    if (changes.alive !== undefined) {
      if (!changes.alive && this.alive) this.diedAt = now;
      if (changes.alive) this.diedAt = undefined;
      this.alive = changes.alive;
    }
    if (!this.alive) {
      this.route = undefined;
      this.sprite.setVisible(this.diedAt !== undefined);
    } else {
      this.sprite.setVisible(true);
      const route = changes.route;
      if (changedRoute && route?.path.length) {
        const offset = route.path.findIndex(tile => tile.x === changes.x && tile.y === changes.y);
        this.route = { path: route.path, start: now - route.delta - Math.max(0, offset) * this.definition.speed };
      }
    }
  }

  render(now: number, target?: Tile) {
    if (!this.sprite.visible) return;
    const frames = this.definition.frames;
    if (!this.alive) {
      const range = Array.isArray(frames.death) ? frames.death : [0, 5];
      const index = range[0] + Math.floor((now - (this.diedAt ?? now)) / 125);
      if (index > range[1]) this.sprite.setVisible(false);
      else this.frame(frames.death ? this.key : 'death', index);
      return;
    }

    let animation = 'idle_';
    let rate = typeof frames.idle_rate === 'number' ? frames.idle_rate : 2;
    let elapsed = now;
    if (this.route) {
      const path = this.route.path;
      const progress = Math.min((now - this.route.start) / this.definition.speed, path.length - 1);
      const i = Math.floor(progress);
      const from = path[i];
      const to = path[i + 1];
      if (to) {
        this.face(from, to);
        this.place(from.x + (to.x - from.x) * (progress - i), from.y + (to.y - from.y) * (progress - i));
        animation = '';
        rate = 8;
      } else {
        this.place(from.x, from.y);
        this.route = undefined;
      }
    }
    if (!this.route && this.inFight && target) {
      const from = this.tile;
      if (Math.abs(from.x - target.x) + Math.abs(from.y - target.y) === 1) {
        this.face(from, target);
        const attack = frames[`attack_${this.facing}`];
        if (Array.isArray(attack) && now % 1000 < (attack[1] - attack[0] + 1) * 1000 / 14) {
          animation = 'attack_';
          rate = 14;
          elapsed = now % 1000;
        }
      }
    }
    const range = frames[animation + this.facing];
    if (Array.isArray(range)) {
      this.frame(this.key, range[0] + Math.floor(elapsed * rate / 1000) % (range[1] - range[0] + 1));
    }
  }

  private face(from: Tile, to: Tile) {
    if (from.x !== to.x) this.facing = to.x < from.x ? 'left' : 'right';
    else this.facing = to.y < from.y ? 'up' : 'down';
  }

  private place(x: number, y: number) {
    this.sprite.setPosition(x * this.width, y * this.height).setDepth(y * this.height);
  }

  private frame(prefix: string, index: number) {
    const name = `${prefix}_${index}`;
    if (this.sprite.frame.name !== name && this.sprite.texture.has(name)) this.sprite.setFrame(name);
  }
}
