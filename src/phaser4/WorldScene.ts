import * as Phaser from 'phaser4';
import EasyStar from 'easystarjs';
import type { PersonalUpdate, PlayerSnapshot, Tile, WorldUpdate } from './protocol.ts';

type Direction = 1 | 2 | 3 | 4;

type Equipment = { id: number; key: string; offsets?: Tile };

type Avatar = {
  container: Phaser.GameObjects.Container;
  armor: Phaser.GameObjects.Image;
  weapon: Phaser.GameObjects.Image;
  name: Phaser.GameObjects.Text;
  bubble: Phaser.GameObjects.Text;
  armorKey: string;
  weaponKey: string;
  direction: Direction;
  alive: boolean;
  motion?: Phaser.Tweens.Tween;
  speechTimer?: Phaser.Time.TimerEvent;
};

const idleFrame = { 1: 42, 2: 20, 3: 9, 4: 31 };
const walkFrame = { 1: 38, 2: 16, 3: 5, 4: 27 };

function directionBetween(from: Tile, to: Tile): Direction {
  if (to.x < from.x) return 1;
  if (to.y < from.y) return 2;
  return to.x > from.x ? 3 : 4;
}

function isDirection(value: number | undefined): value is Direction {
  return value === 1 || value === 2 || value === 3 || value === 4;
}

export class WorldScene extends Phaser.Scene {
  private readonly avatars = new Map<number, Avatar>();
  private readonly equipment = new Map<number, Equipment>();
  private readonly doors = new Map<string, Tile>();
  private readonly pathfinder = new EasyStar.js();
  private collision: number[][] = [];
  private tileWidth = 32;
  private tileHeight = 32;
  private heroId?: number;

  constructor(
    private readonly onReady: () => void,
    private readonly onPath: (path: Tile[], orientation: number) => void,
  ) {
    super('world');
  }

  preload() {
    this.load.tilemapTiledJSON('map', '/assets/maps/minimap_client.json');
    this.load.image('tilesheet', '/assets/tilesets/tilesheet.png');
    this.load.atlas('players', '/assets/sprites/atlas3.png', '/assets/sprites/atlas3.json');
    this.load.json('db', '/assets/json/db.json');
  }

  create() {
    const map = this.make.tilemap({ key: 'map' });
    const tileset = map.addTilesetImage('tilesheet', 'tilesheet');
    if (!tileset) throw new Error('The world tileset is missing');
    this.tileWidth = map.tileWidth;
    this.tileHeight = map.tileHeight;
    const layers = map.layers.map(({ name }, index) => {
      const layer = map.createLayer(name, tileset, 0, 0);
      if (!layer) throw new Error(`The map layer ${name} is missing`);
      return layer.setDepth(index < 4 ? index - 4 : map.heightInPixels + index);
    });
    this.collision = Array.from({ length: map.height }, (_, y) =>
      Array.from({ length: map.width }, (_, x) => Number(layers.some((layer) => {
        const tile = layer.getTileAt(x, y);
        return tile !== null && Object.hasOwn(tile.properties, 'c');
      }))),
    );
    this.pathfinder.setGrid(this.collision);
    this.pathfinder.setAcceptableTiles(0);
    this.pathfinder.enableSync();

    for (const door of map.getObjectLayer('doors')?.objects ?? []) {
      const x = Math.floor((door.x ?? 0) / this.tileWidth);
      const y = Math.floor((door.y ?? 0) / this.tileHeight);
      const to = { x: Number(door.properties?.x), y: Number(door.properties?.y) };
      if (Number.isInteger(to.x) && Number.isInteger(to.y)) this.doors.set(`${x},${y}`, to);
    }

    const { items } = this.cache.json.get('db') as { items: Record<string, Equipment> };
    for (const item of Object.values(items)) this.equipment.set(item.id, item);

    this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.input.on(Phaser.Input.Events.POINTER_UP, this.walk, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.heroId = undefined;
      this.avatars.clear();
    });
    this.onReady();
  }

  enter(player: PlayerSnapshot) {
    this.leave();
    this.heroId = player.id;
    const hero = this.addAvatar(player);
    this.cameras.main.centerOn(hero.container.x, hero.container.y);
    this.cameras.main.startFollow(hero.container, true, 1, 1, -this.tileWidth / 2, -this.tileHeight / 2);
  }

  applyWorld(update: WorldUpdate) {
    for (const player of update.newplayers ?? []) {
      if (player.id !== this.heroId) this.addAvatar(player);
    }
    for (const [id, changes] of Object.entries(update.players ?? {})) {
      const avatar = this.avatars.get(Number(id));
      if (avatar) this.updateAvatar(avatar, changes, Number(id) === this.heroId);
    }
    for (const id of update.disconnected ?? []) this.removeAvatar(id);
  }

  applySelf(update: PersonalUpdate) {
    if (update.x !== undefined && update.y !== undefined) this.reset({ x: update.x, y: update.y });
  }

  reset(tile: Tile) {
    const hero = this.heroId === undefined ? undefined : this.avatars.get(this.heroId);
    if (hero) this.place(hero, tile);
  }

  say(id: number, text: string) {
    const avatar = this.avatars.get(id);
    if (!avatar?.alive) return;
    avatar.speechTimer?.remove();
    avatar.bubble.setText(text).setVisible(Boolean(text));
    avatar.speechTimer = this.time.delayedCall(5000, () => avatar.bubble.setVisible(false));
  }

  leave() {
    if (this.heroId !== undefined) this.cameras.main.stopFollow();
    this.heroId = undefined;
    for (const id of this.avatars.keys()) this.removeAvatar(id);
  }

  private addAvatar(player: PlayerSnapshot): Avatar {
    const current = this.avatars.get(player.id);
    if (current) {
      this.updateAvatar(current, player, false);
      return current;
    }
    const container = this.add.container();
    const armor = this.add.image(0, 0, 'players', 'clotharmor_31').setOrigin(0.25, 0.35);
    const weapon = this.add.image(-18, -23, 'players', 'sword1_31').setOrigin(0, 0);
    const name = this.add.text(16, -23, player.name, {
      fontSize: '14px', color: player.id === this.heroId ? '#f4d442' : '#ffffff',
      stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5, 1);
    const bubble = this.add.text(16, -43, '', {
      fontSize: '14px', color: '#20190f', backgroundColor: '#fff5d9', align: 'center',
      wordWrap: { width: 200 }, padding: { x: 6, y: 4 },
    }).setOrigin(0.5, 1).setVisible(false);
    container.add([armor, weapon, name, bubble]);
    const avatar: Avatar = {
      container, armor, weapon, name, bubble, armorKey: 'clotharmor', weaponKey: 'sword1',
      direction: 4, alive: player.alive ?? true,
    };
    this.avatars.set(player.id, avatar);
    this.updateAvatar(avatar, player, player.id === this.heroId);
    return avatar;
  }

  private updateAvatar(avatar: Avatar, changes: Partial<PlayerSnapshot>, isHero: boolean) {
    if (changes.name !== undefined) avatar.name.setText(changes.name);
    const armor = changes.armor === undefined ? undefined : this.equipment.get(changes.armor);
    const weapon = changes.weapon === undefined ? undefined : this.equipment.get(changes.weapon);
    if (armor) avatar.armorKey = armor.key;
    if (weapon) {
      avatar.weaponKey = weapon.key;
      if (weapon.offsets) avatar.weapon.setPosition(weapon.offsets.x, weapon.offsets.y);
    }
    if (changes.alive !== undefined) avatar.alive = changes.alive;
    avatar.container.setVisible(avatar.alive);
    if (changes.x !== undefined && changes.y !== undefined) {
      this.place(avatar, { x: changes.x, y: changes.y });
    }
    if (!avatar.alive) {
      avatar.motion?.stop();
      avatar.motion = undefined;
    }
    if (!avatar.motion) this.showFrame(avatar, idleFrame[avatar.direction]);
    if (avatar.alive && changes.route && !isHero) {
      const path = this.findPath(this.tileAt(avatar), changes.route.end);
      if (path && path.length > 1) this.move(avatar, path, changes.route.orientation, changes.route.delta);
    }
  }

  private removeAvatar(id: number) {
    const avatar = this.avatars.get(id);
    if (!avatar) return;
    avatar.motion?.stop();
    avatar.speechTimer?.remove();
    avatar.container.destroy();
    this.avatars.delete(id);
  }

  private walk(pointer: Phaser.Input.Pointer) {
    if (this.heroId === undefined || (!pointer.wasTouch && !pointer.leftButtonReleased())) return;
    const hero = this.avatars.get(this.heroId);
    if (!hero?.alive) return;
    const at = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const end = { x: Math.floor(at.x / this.tileWidth), y: Math.floor(at.y / this.tileHeight) };
    const start = this.tileAt(hero);
    if (Math.abs(end.x - start.x) + Math.abs(end.y - start.y) > 28) return;
    const path = this.findPath(start, end);
    if (!path || path.length < 2 || path.length > 60) return;
    const orientation = directionBetween(path[path.length - 2], end);
    this.onPath(path, orientation);
    this.move(hero, path, orientation);
  }

  private findPath(start: Tile, end: Tile): Tile[] | null {
    if (this.collision[start.y]?.[start.x] === undefined || this.collision[end.y]?.[end.x] !== 0) return null;
    let path: Tile[] | null = null;
    this.pathfinder.findPath(start.x, start.y, end.x, end.y, (result: Tile[] | null) => { path = result; });
    this.pathfinder.calculate();
    return path;
  }

  private move(avatar: Avatar, path: Tile[], orientation?: number, latency = 0) {
    avatar.motion?.stop();
    const end = path[path.length - 1];
    avatar.motion = this.tweens.addCounter({
      from: 0, to: path.length - 1, duration: Math.max(1, (path.length - 1) * 120 - latency),
      onUpdate: (tween) => {
        const progress = tween.getValue() ?? 0;
        const index = Math.min(Math.floor(progress), path.length - 2);
        const from = path[index];
        const to = path[index + 1];
        const fraction = progress - index;
        avatar.direction = directionBetween(from, to);
        this.position(avatar, {
          x: from.x + (to.x - from.x) * fraction,
          y: from.y + (to.y - from.y) * fraction,
        });
        this.showFrame(avatar, walkFrame[avatar.direction] + Math.floor(progress * 2) % 4);
      },
      onComplete: () => {
        avatar.motion = undefined;
        if (isDirection(orientation)) avatar.direction = orientation;
        this.position(avatar, this.doors.get(`${end.x},${end.y}`) ?? end);
        this.showFrame(avatar, idleFrame[avatar.direction]);
      },
    });
  }

  private tileAt(avatar: Avatar): Tile {
    return {
      x: Math.round(avatar.container.x / this.tileWidth),
      y: Math.round(avatar.container.y / this.tileHeight),
    };
  }

  private place(avatar: Avatar, tile: Tile) {
    avatar.motion?.stop();
    avatar.motion = undefined;
    this.position(avatar, tile);
    this.showFrame(avatar, idleFrame[avatar.direction]);
  }

  private position(avatar: Avatar, tile: Tile) {
    avatar.container.setPosition(tile.x * this.tileWidth, tile.y * this.tileHeight);
    avatar.container.setDepth(avatar.container.y);
  }

  private showFrame(avatar: Avatar, frame: number) {
    const armorFrame = `${avatar.armorKey}_${frame}`;
    const weaponFrame = `${avatar.weaponKey}_${frame}`;
    if (avatar.armor.frame.name !== armorFrame && avatar.armor.texture.has(armorFrame)) avatar.armor.setFrame(armorFrame);
    if (avatar.weapon.frame.name !== weaponFrame && avatar.weapon.texture.has(weaponFrame)) avatar.weapon.setFrame(weaponFrame);
  }
}
