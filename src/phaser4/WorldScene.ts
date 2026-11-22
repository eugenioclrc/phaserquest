import * as Phaser from 'phaser4';
import EasyStar from 'easystarjs';
import { AOIutils } from '../../shared/AOIutils.ts';
import type { PersonalUpdate, PlayerSnapshot, Tile, WorldUpdate } from './protocol.ts';

type Direction = 1 | 2 | 3 | 4;

type Equipment = { id: number; key: string; offsets?: Tile };

type Door = {
  to: Tile;
  orientation?: Direction;
  camera?: Tile;
  follow: boolean;
  bounds?: Phaser.Geom.Rectangle;
};

type DoorCrossing = { path: Tile[]; door: Door; previous?: Door };

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
  aoi?: number;
  motion?: Phaser.Tweens.Tween;
  speechTimer?: Phaser.Time.TimerEvent;
};

const idleFrame = { 1: 42, 2: 20, 3: 9, 4: 31 };
const walkFrame = { 1: 38, 2: 16, 3: 5, 4: 27 };
const doorDirection: Partial<Record<string, Direction>> = { l: 1, u: 2, r: 3, d: 4 };

function tileDistance(from: Tile, to: Tile): number {
  return Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
}

function tileKey(tile: Tile): string {
  return `${tile.x},${tile.y}`;
}

function isCrossingSource(tile: Tile, path: Tile[]): boolean {
  const start = path[0];
  return (Math.abs(tile.x - start.x) <= 1 && Math.abs(tile.y - start.y) <= 1) ||
    path.some(step => step.x === tile.x && step.y === tile.y);
}

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
  private readonly doors = new Map<string, Door>();
  private readonly crossingsByDestination = new Map<string, DoorCrossing>();
  private readonly pathfinder = new EasyStar.js();
  private collision: number[][] = [];
  private tileWidth = 32;
  private tileHeight = 32;
  private heroId?: number;
  private destination?: Phaser.GameObjects.Image;
  private cameraDoor?: Door;
  private outdoorWidth = 0;
  private lastCrossing?: DoorCrossing;

  constructor(
    private readonly onReady: () => void,
    private readonly onPath: (path: Tile[], orientation: number) => boolean,
  ) {
    super('world');
  }

  preload() {
    this.load.tilemapTiledJSON('map', '/assets/maps/minimap_client.json');
    this.load.image('tilesheet', '/assets/tilesets/tilesheet.png');
    this.load.atlas('atlas1', '/assets/sprites/atlas1.png', '/assets/sprites/atlas1.json');
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
      const properties = door.properties ?? {};
      const to = { x: Number(properties.x), y: Number(properties.y) };
      if (!Number.isInteger(to.x) || !Number.isInteger(to.y)) continue;
      const cx = Number(properties.cx);
      const cy = Number(properties.cy);
      const minX = Number(properties.min_cx);
      const minY = Number(properties.min_cy);
      const maxX = Number(properties.max_cx);
      const maxY = Number(properties.max_cy);
      this.doors.set(tileKey({ x, y }), {
        to,
        orientation: doorDirection[properties.o],
        camera: Number.isFinite(cx) && Number.isFinite(cy) ? { x: cx, y: cy } : undefined,
        follow: Object.hasOwn(properties, 'follow'),
        bounds: maxX > minX && maxY > minY ? new Phaser.Geom.Rectangle(
          minX * this.tileWidth, minY * this.tileHeight,
          (maxX - minX) * this.tileWidth, (maxY - minY) * this.tileHeight,
        ) : undefined,
      });
    }

    const { items } = this.cache.json.get('db') as { items: Record<string, Equipment> };
    for (const item of Object.values(items)) this.equipment.set(item.id, item);

    this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.destination = this.add.image(0, 0, 'atlas1', 'target_0').setOrigin(0).setDepth(-0.5).setVisible(false);
    this.input.on(Phaser.Input.Events.POINTER_UP, this.walk, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.heroId = undefined;
      this.avatars.clear();
    });
    this.onReady();
  }

  enter(player: PlayerSnapshot, nbAOIhorizontal: number, lastAOIid: number) {
    this.leave();
    AOIutils.nbAOIhorizontal = nbAOIhorizontal;
    AOIutils.lastAOIid = lastAOIid;
    this.heroId = player.id;
    this.setHeroCamera(this.addAvatar(player));
  }

  applyWorld(update: WorldUpdate) {
    for (const player of update.newplayers ?? []) {
      if (player.id !== this.heroId) this.addAvatar(player);
    }
    for (const [key, changes] of Object.entries(update.players ?? {})) {
      const id = Number(key);
      const avatar = this.avatars.get(id);
      if (avatar) this.updateAvatar(avatar, changes, id === this.heroId);
    }
    for (const id of update.disconnected ?? []) this.removeAvatar(id);

    const hero = this.heroId === undefined ? undefined : this.avatars.get(this.heroId);
    if (hero?.aoi === undefined) return;
    const nearby = AOIutils.listAdjacentAOIs(hero.aoi);
    for (const [id, avatar] of this.avatars) {
      if (avatar.aoi !== undefined && !nearby.includes(avatar.aoi)) this.removeAvatar(id);
    }
  }

  applySelf(update: PersonalUpdate) {
    if (update.x === undefined || update.y === undefined) return;
    this.crossingsByDestination.clear();
    this.lastCrossing = undefined;
    this.reset({ x: update.x, y: update.y });
    const hero = this.heroId === undefined ? undefined : this.avatars.get(this.heroId);
    if (hero) this.setHeroCamera(hero);
  }

  reset({ x, y }: Tile) {
    const hero = this.heroId === undefined ? undefined : this.avatars.get(this.heroId);
    if (!hero) return;
    // A server reset can echo the original Tiled strings after a teleport.
    const tile = { x: Number(x), y: Number(y) };
    if (!Number.isInteger(tile.x) || !Number.isInteger(tile.y)) return;
    const confirmed = this.crossingsByDestination.get(tileKey(tile));
    this.crossingsByDestination.clear();
    if (confirmed?.door.orientation) hero.direction = confirmed.door.orientation;
    this.destination?.setVisible(false);
    this.place(hero, tile);
    const crossing = this.lastCrossing;
    // The server can reach the door before or after the local tween.
    if (confirmed) {
      this.lastCrossing = confirmed;
      this.setHeroCamera(hero, confirmed.door);
    } else if (crossing) {
      this.lastCrossing = undefined;
      if (isCrossingSource(tile, crossing.path)) this.setHeroCamera(hero, crossing.previous);
    }
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
    this.destination?.setVisible(false);
    this.cameraDoor = undefined;
    this.crossingsByDestination.clear();
    this.lastCrossing = undefined;
    this.outdoorWidth = 0;
    for (const id of this.avatars.keys()) this.removeAvatar(id);
  }

  private setHeroCamera(hero: Avatar, door?: Door) {
    const camera = this.cameras.main;
    this.cameraDoor = door?.follow || door?.camera ? door : undefined;
    this.outdoorWidth = 0;
    if (door?.camera && !door.follow) {
      camera.stopFollow().removeBounds().setScroll(door.camera.x * this.tileWidth, door.camera.y * this.tileHeight);
      return;
    }
    if (door?.follow) {
      const bounds = door.bounds;
      if (bounds) camera.setBounds(bounds.x, bounds.y, Math.max(bounds.width, camera.width), bounds.height);
      else camera.setBounds(this.tileWidth - 10, this.tileHeight - 10, 170 * this.tileWidth, 311 * this.tileHeight);
    } else {
      this.updateOutdoorBounds(hero.container.y);
    }
    camera.startFollow(hero.container, true, 1, 1, 0, -this.tileHeight / 2);
  }

  private updateOutdoorBounds(y: number) {
    const width = (Math.floor(y / this.tileHeight) <= 54 ? 113 : 92) * this.tileWidth;
    if (width === this.outdoorWidth) return;
    this.outdoorWidth = width;
    this.cameras.main.setBounds(this.tileWidth - 10, this.tileHeight - 10, width, 311 * this.tileHeight);
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
    if (changes.aoi !== undefined) avatar.aoi = changes.aoi;
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
      const tile = { x: changes.x, y: changes.y };
      if (isHero) this.reset(tile);
      else this.place(avatar, tile);
    }
    if (!avatar.alive) {
      avatar.motion?.stop();
      avatar.motion = undefined;
      if (isHero) this.destination?.setVisible(false);
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
    if (tileDistance(start, end) > 28) return;
    const path = this.findPath(start, end);
    if (!path || path.length < 2 || path.length > 60) return;
    const orientation = directionBetween(path[path.length - 2], end);
    if (this.onPath(path, orientation)) this.move(hero, path, orientation);
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
    const door = this.doors.get(tileKey(end));
    const isHero = this.heroId !== undefined && this.avatars.get(this.heroId) === avatar;
    const crossing = isHero && door ? { path, door, previous: this.cameraDoor } : undefined;
    if (isHero) {
      if (crossing) this.crossingsByDestination.set(tileKey(crossing.door.to), crossing);
      this.destination?.setPosition(end.x * this.tileWidth, end.y * this.tileHeight).setVisible(true);
    }
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
        const finalDirection = door?.orientation ?? orientation;
        if (isDirection(finalDirection)) avatar.direction = finalDirection;
        this.position(avatar, door?.to ?? end);
        this.showFrame(avatar, idleFrame[avatar.direction]);
        if (isHero) {
          this.destination?.setVisible(false);
          if (crossing) {
            this.lastCrossing = crossing;
            this.setHeroCamera(avatar, crossing.door);
          }
        }
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
    if (this.outdoorWidth && this.heroId !== undefined && this.avatars.get(this.heroId) === avatar) {
      this.updateOutdoorBounds(avatar.container.y);
    }
  }

  private showFrame(avatar: Avatar, frame: number) {
    const armorFrame = `${avatar.armorKey}_${frame}`;
    const weaponFrame = `${avatar.weaponKey}_${frame}`;
    if (avatar.armor.frame.name !== armorFrame && avatar.armor.texture.has(armorFrame)) avatar.armor.setFrame(armorFrame);
    if (avatar.weapon.frame.name !== weaponFrame && avatar.weapon.texture.has(weaponFrame)) avatar.weapon.setFrame(weaponFrame);
  }
}
