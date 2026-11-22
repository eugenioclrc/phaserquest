import { playerStepMs } from '../../shared/WorldProtocol.ts';
import * as Phaser from 'phaser';
import EasyStar from 'easystarjs';
import type { ItemSnapshot, PathAction, PersonalUpdate, PlayerSnapshot, Tile, WorldUpdate } from './protocol.ts';
import { MonsterView, type MonsterDefinition } from './MonsterView.ts';

type Direction = 1 | 2 | 3 | 4;

type ItemDefinition = {
  id: number;
  type?: number;
  msg?: string;
  offsets?: Tile;
  customAnchor?: Tile;
};

type ItemView = { data: ItemSnapshot; sprite: Phaser.GameObjects.Image };

type NpcDefinition = { atlasKey: string; nbFrames: number; dialogue: string[]; customAnchor?: Tile };
type MapEntity = { npc?: boolean; sprite: string };
type Speaker = { bubble: Phaser.GameObjects.Text; speechTimer?: Phaser.Time.TimerEvent };
type NpcView = Speaker & {
  tile: Tile;
  sprite: Phaser.GameObjects.Sprite;
  dialogue: string[];
  nextLine: number;
};

type Door = {
  to: Tile;
  orientation?: Direction;
  camera?: Tile;
  follow: boolean;
  bounds?: Phaser.Geom.Rectangle;
};

type DoorCrossing = { path: Tile[]; door: Door; previous?: Door };

type Avatar = Speaker & {
  container: Phaser.GameObjects.Container;
  armor: Phaser.GameObjects.Image;
  weapon: Phaser.GameObjects.Image;
  name: Phaser.GameObjects.Text;
  armorKey: string;
  weaponKey: string;
  direction: Direction;
  alive: boolean;
  inFight?: boolean;
  targetID?: number;
  routeVersion?: number;
  motion?: Phaser.Tweens.Tween;
};

const npcTilesetFirstGid = 1961;
const idleFrame = { 1: 42, 2: 20, 3: 9, 4: 31 };
const walkFrame = { 1: 38, 2: 16, 3: 5, 4: 27 };
const attackFrame = { 1: 33, 2: 11, 3: 0, 4: 22 };
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
  private readonly monsters = new Map<number, MonsterView>();
  private readonly species = new Map<number, { key: string; definition: MonsterDefinition }>();
  private readonly items = new Map<number, ItemView>();
  private readonly itemDefinitions = new Map<number, ItemDefinition & { key: string }>();
  private readonly npcs = new Map<string, NpcView>();
  private firstDialogueShown = false;
  private damageLabels?: Phaser.GameObjects.Group;
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
    private readonly onPath: (path: Tile[], orientation: number, action?: PathAction) => boolean,
    private readonly onHeroAlive: (alive: boolean) => void,
    private readonly onHeroEquipment: (slot: 'armor' | 'weapon', key: string) => void,
    private readonly onFirstDialogue: () => void,
    private readonly onOutdoorArrival: (tile: Tile) => void,
  ) {
    super('world');
  }

  preload() {
    this.load.tilemapTiledJSON('map', '/assets/maps/minimap_client.json');
    this.load.image('tilesheet', '/assets/tilesets/tilesheet.png');
    this.load.atlas('atlas1', '/assets/sprites/atlas1.png', '/assets/sprites/atlas1.json');
    this.load.atlas('players', '/assets/sprites/atlas3.png', '/assets/sprites/atlas3.json');
    this.load.atlas('monsters', '/assets/sprites/atlas4.png', '/assets/sprites/atlas4.json');
    this.load.json('db', '/assets/json/db.json');
    this.load.json('entities', '/assets/json/entities_client.json');
    this.load.audioSprite('sounds', '/assets/audio/sounds.json', ['/assets/audio/sounds.mp3', '/assets/audio/sounds.ogg']);
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
    const { items, monsters, npc } = this.cache.json.get('db') as {
      items: Record<string, ItemDefinition>;
      monsters: Record<string, MonsterDefinition>;
      npc: Record<string, NpcDefinition>;
    };
    this.createNpcs(map, npc);
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

    for (const [key, item] of Object.entries(items)) this.itemDefinitions.set(item.id, { ...item, key });
    for (const [key, definition] of Object.entries(monsters)) this.species.set(definition.id, { key, definition });
    this.damageLabels = this.add.group();

    this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.destination = this.add.image(0, 0, 'atlas1', 'target_0').setOrigin(0).setDepth(-0.5).setVisible(false);
    this.input.on(Phaser.Input.Events.POINTER_UP, this.walk, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.heroId = undefined;
      this.avatars.clear();
      this.monsters.clear();
      this.items.clear();
      this.npcs.clear();
    });
    this.onReady();
  }

  enter(player: PlayerSnapshot, doorSource?: Tile) {
    this.leave();
    this.heroId = player.id;
    const hero = this.addAvatar(player);
    this.setHeroCamera(hero, doorSource && this.doors.get(tileKey(doorSource)));
    if (hero.alive && player.route) {
      const path = this.findPath(player, player.route.end);
      if (path && path.length > 1) this.move(hero, path, player.route.orientation, player.route.elapsed % playerStepMs);
    }
  }

  applyWorld(update: WorldUpdate) {
    for (const item of update.newItems ?? []) {
      let view = this.items.get(item.id);
      if (!view) {
        const sprite = this.add.image(0, 0, 'players', 'chest').setInteractive({ useHandCursor: true });
        view = { data: { ...item }, sprite };
        this.items.set(item.id, view);
      }
      this.updateItem(view, item);
    }
    for (const [key, changes] of Object.entries(update.items ?? {})) {
      const view = this.items.get(Number(key));
      if (view) this.updateItem(view, changes);
    }
    for (const snapshot of update.newMonsters ?? []) {
      const current = this.monsters.get(snapshot.id);
      const species = this.species.get(snapshot.monster);
      if (current) current.apply(snapshot, this.time.now);
      else if (species) {
        this.monsters.set(snapshot.id, new MonsterView(
          this, species.key, species.definition, this.tileWidth, this.tileHeight, snapshot,
        ));
      }
    }
    for (const [key, changes] of Object.entries(update.monsters ?? {})) {
      const monster = this.monsters.get(Number(key));
      if (!monster) continue;
      if (monster.alive && changes.alive === false && this.cameras.main.worldView.contains(monster.sprite.x, monster.sprite.y)) {
        this.playSound('kill2');
      }
      monster.apply(changes, this.time.now);
    }
    for (const player of update.newPlayers ?? []) {
      if (player.id !== this.heroId) this.addAvatar(player);
    }
    for (const [key, changes] of Object.entries(update.players ?? {})) {
      const id = Number(key);
      const avatar = this.avatars.get(id);
      if (avatar) this.updateAvatar(avatar, changes, id === this.heroId);
    }
    for (const id of update.removedPlayers ?? []) this.removeAvatar(id);
    for (const id of update.removedMonsters ?? []) {
      this.monsters.get(id)?.sprite.destroy();
      this.monsters.delete(id);
    }
    for (const id of update.removedItems ?? []) {
      const item = this.items.get(id);
      if (item) this.removeItem(item);
    }
  }

  itemInfo(id: number) {
    return this.itemDefinitions.get(id);
  }

  monsterInfo(id: number) {
    return this.species.get(id)?.definition;
  }

  playSound(name: string) {
    if (!this.sound.mute && !this.sound.locked && this.cache.audio.exists('sounds')) this.sound.playAudioSprite('sounds', name);
  }

  applySelf(update: PersonalUpdate) {
    const hero = this.heroId === undefined ? undefined : this.avatars.get(this.heroId);
    if (!hero) return;
    for (const hit of update.hp ?? []) {
      const target = hit.target
        ? (hit.monsterId === undefined ? undefined : this.monsters.get(hit.monsterId)?.sprite)
        : hero.container;
      if (!target) continue;
      const healing = !hit.target && hit.monsterId === undefined;
      if (!healing || hit.hp > 0) this.playSound(healing ? 'heal' : hit.target ? 'hit1' : 'hurt');
      const text = this.add.text(target.x + this.tileWidth / 2, target.y - 20, `${healing ? '+' : '−'}${hit.hp}`, {
        fontSize: '18px', color: healing ? '#79ea84' : '#ffac96', stroke: '#29160c', strokeThickness: 3,
      }).setOrigin(0.5, 1).setDepth(100000);
      this.damageLabels?.add(text);
      this.tweens.add({ targets: text, y: text.y - 28, alpha: 0, duration: 800, onComplete: () => text.destroy() });
    }
    if (update.life === 0) this.updateAvatar(hero, { alive: false }, true);
    if (update.x === undefined || update.y === undefined) return;
    this.crossingsByDestination.clear();
    this.lastCrossing = undefined;
    this.reset({ x: update.x, y: update.y });
    this.updateAvatar(hero, { alive: true }, true);
    this.setHeroCamera(hero);
  }

  update(time: number) {
    for (const monster of this.monsters.values()) {
      const target = monster.targetID === undefined ? undefined : this.avatars.get(monster.targetID);
      monster.render(time, target?.alive ? this.tileAt(target) : undefined);
    }
    for (const avatar of this.avatars.values()) {
      if (!avatar.inFight || !avatar.alive || avatar.motion || avatar.targetID === undefined) continue;
      const monster = this.monsters.get(avatar.targetID);
      const tile = this.tileAt(avatar);
      const target = monster?.tile;
      if (!monster?.alive || !target || tileDistance(tile, target) !== 1) {
        this.showFrame(avatar, idleFrame[avatar.direction]);
        continue;
      }
      avatar.direction = directionBetween(tile, target);
      const frame = Math.floor(time % 1000 * 14 / 1000);
      this.showFrame(avatar, frame < 5 ? attackFrame[avatar.direction] + frame : idleFrame[avatar.direction]);
    }
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
      if (!confirmed.previous) this.onOutdoorArrival(confirmed.path[confirmed.path.length - 1]);
      this.lastCrossing = confirmed;
      this.setHeroCamera(hero, confirmed.door);
    } else if (crossing) {
      this.lastCrossing = undefined;
      if (isCrossingSource(tile, crossing.path)) this.setHeroCamera(hero, crossing.previous);
    }
  }

  say(id: number, text: string) {
    const avatar = this.avatars.get(id);
    if (avatar?.alive) this.showSpeech(avatar, text);
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
    for (const monster of this.monsters.values()) monster.sprite.destroy();
    this.monsters.clear();
    for (const { sprite } of this.items.values()) sprite.destroy();
    this.items.clear();
    this.damageLabels?.clear(true, true);
    this.firstDialogueShown = false;
    for (const npc of this.npcs.values()) {
      npc.nextLine = 0;
      this.showSpeech(npc, '');
    }
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

  private updateItem(view: ItemView, changes: Partial<ItemSnapshot>) {
    const { data, sprite } = view;
    if (data.inChest && changes.inChest === false && this.cameras.main.worldView.contains(sprite.x, sprite.y)) {
      this.playSound('chest');
    }
    Object.assign(data, changes);
    if (!data.visible && !data.respawn) {
      this.removeItem(view);
      return;
    }
    const item = this.itemInfo(data.itemID);
    const frame = data.inChest ? 'chest' : item && `${item.key}_0`;
    const anchor = data.inChest ? undefined : item?.customAnchor;
    const y = data.y * this.tileHeight;
    sprite.setPosition(data.x * this.tileWidth, y).setDepth(y - 0.25);
    if (frame && sprite.texture.has(frame)) {
      sprite.setFrame(frame).setOrigin(anchor?.x ?? 0, anchor?.y ?? (data.inChest ? 0 : 0.25));
      sprite.setVisible(data.visible);
    } else {
      sprite.setVisible(false);
    }
  }

  private removeItem({ data, sprite }: ItemView) {
    sprite.destroy();
    this.items.delete(data.id);
  }

  private createNpcs(map: Phaser.Tilemaps.Tilemap, definitions: Record<string, NpcDefinition>) {
    const entities = this.cache.json.get('entities') as Record<number, MapEntity>;
    for (const { x, y, gid } of map.getObjectLayer('entities')?.objects ?? []) {
      if (x === undefined || y === undefined || gid === undefined) continue;
      const entity = entities[gid - npcTilesetFirstGid];
      const definition = entity?.npc ? definitions[entity.sprite] : undefined;
      if (!definition) continue;
      const tile = { x: Math.floor(x / this.tileWidth), y: Math.floor(y / this.tileHeight) };
      this.collision[tile.y][tile.x] = 1;
      const { atlasKey, customAnchor, nbFrames, dialogue } = definition;
      this.add.image(x, y + 4, 'atlas1', 'shadow').setOrigin(0).setDepth(y - 0.25);
      const sprite = this.add.sprite(x, y, 'atlas1', `${atlasKey}_0`)
        .setOrigin(customAnchor?.x ?? 0, customAnchor?.y ?? 0.25).setDepth(y)
        .setInteractive({ cursor: 'url(/assets/sprites/talk.png), auto' });
      if (nbFrames > 1) {
        const animation = `npc-${atlasKey}`;
        if (!this.anims.exists(animation)) {
          this.anims.create({
            key: animation,
            frames: this.anims.generateFrameNames('atlas1', { prefix: `${atlasKey}_`, end: nbFrames - 1 }),
            frameRate: 2,
            repeat: -1,
          });
        }
        sprite.play(animation);
      }
      const bubble = this.makeSpeechBubble(x + this.tileWidth / 2, y - sprite.displayOriginY - 13)
        .setDepth(map.heightInPixels + map.layers.length);
      this.npcs.set(tileKey(tile), { tile, sprite, bubble, dialogue, nextLine: 0 });
    }
  }

  private makeSpeechBubble(x: number, y: number) {
    return this.add.text(x, y, '', {
      fontSize: '14px', color: '#20190f', backgroundColor: '#fff5d9', align: 'center',
      wordWrap: { width: 200 }, padding: { x: 6, y: 4 },
    }).setOrigin(0.5, 1).setVisible(false);
  }

  private showSpeech(speaker: Speaker, text: string) {
    speaker.speechTimer?.remove();
    speaker.bubble.setText(text).setVisible(Boolean(text));
    if (text) this.playSound('chat');
    speaker.speechTimer = text ? this.time.delayedCall(5000, () => speaker.bubble.setVisible(false)) : undefined;
  }

  private speak(npc: NpcView) {
    const line = npc.dialogue[npc.nextLine] ?? '';
    npc.nextLine = (npc.nextLine + 1) % (npc.dialogue.length + 1);
    this.showSpeech(npc, line);
    if (line && !this.firstDialogueShown) {
      this.firstDialogueShown = true;
      this.onFirstDialogue();
    }
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
    const bubble = this.makeSpeechBubble(16, -43);
    container.add([armor, weapon, name, bubble]);
    const avatar: Avatar = {
      container, armor, weapon, name, bubble, armorKey: 'clotharmor', weaponKey: 'sword1',
      direction: 4, alive: player.alive ?? true,
    };
    this.avatars.set(player.id, avatar);
    if (player.id === this.heroId) {
      this.position(avatar, player);
      this.onHeroAlive(avatar.alive);
    }
    this.updateAvatar(avatar, player, player.id === this.heroId);
    return avatar;
  }

  private updateAvatar(avatar: Avatar, changes: Partial<PlayerSnapshot>, isHero: boolean) {
    if (changes.name !== undefined) avatar.name.setText(changes.name);
    const armor = changes.armor === undefined ? undefined : this.itemInfo(changes.armor);
    const weapon = changes.weapon === undefined ? undefined : this.itemInfo(changes.weapon);
    if (armor?.type === 2) {
      avatar.armorKey = armor.key;
      if (isHero) this.onHeroEquipment('armor', armor.key);
    }
    if (weapon?.type === 1) {
      avatar.weaponKey = weapon.key;
      if (weapon.offsets) avatar.weapon.setPosition(weapon.offsets.x, weapon.offsets.y);
      if (isHero) this.onHeroEquipment('weapon', weapon.key);
    }
    if (changes.targetID !== undefined) avatar.targetID = changes.targetID < 0 ? undefined : changes.targetID;
    if (changes.inFight !== undefined) avatar.inFight = changes.inFight;
    if (changes.alive !== undefined) {
      if (avatar.alive && !changes.alive && (isHero || this.cameras.main.worldView.contains(avatar.container.x, avatar.container.y))) {
        this.playSound('death');
      }
      if (isHero && avatar.alive !== changes.alive) this.onHeroAlive(changes.alive);
      avatar.alive = changes.alive;
    }
    avatar.container.setVisible(avatar.alive);
    const changedRoute = changes.routeVersion === undefined || changes.routeVersion !== avatar.routeVersion;
    if (changes.routeVersion !== undefined) avatar.routeVersion = changes.routeVersion;
    if (!isHero && (changedRoute || !changes.route) && changes.x !== undefined && changes.y !== undefined) {
      this.place(avatar, { x: changes.x, y: changes.y });
    }
    if (!avatar.alive) {
      avatar.motion?.stop();
      avatar.motion = undefined;
      if (isHero) this.destination?.setVisible(false);
    }
    if (!avatar.motion) this.showFrame(avatar, idleFrame[avatar.direction]);
    if (avatar.alive && changes.route && !isHero && changedRoute) {
      const path = this.findPath(this.tileAt(avatar), changes.route.end);
      if (path && path.length > 1) {
        const progress = Math.min(path.length - 1, Math.floor(changes.route.elapsed / playerStepMs));
        this.place(avatar, path[progress]);
        if (progress < path.length - 1) {
          this.move(avatar, path.slice(progress), changes.route.orientation, changes.route.elapsed % playerStepMs);
        }
      }
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

  private walk(pointer: Phaser.Input.Pointer, hits: Phaser.GameObjects.GameObject[] = []) {
    if (this.heroId === undefined || (!pointer.wasTouch && !pointer.leftButtonReleased())) return;
    const hero = this.avatars.get(this.heroId);
    if (!hero?.alive) return;
    const at = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const clicked = { x: Math.floor(at.x / this.tileWidth), y: Math.floor(at.y / this.tileHeight) };
    const target: { tile: Tile; action: PathAction; rank: number; npc?: NpcView } = {
      tile: clicked, action: { action: 0 }, rank: hits.length + 1,
    };
    const consider = (sprite: Phaser.GameObjects.GameObject, tile: Tile, action: PathAction, npc?: NpcView) => {
      // Phaser provides render-sorted hits. Tile matches are a fallback.
      const hit = hits.indexOf(sprite);
      const rank = hit >= 0 ? hit : hits.length;
      if (rank >= target.rank || (hit < 0 && tileDistance(tile, clicked) !== 0)) return;
      Object.assign(target, { tile, action, rank, npc });
    };
    for (const [id, monster] of this.monsters) {
      if (monster.alive) consider(monster.sprite, monster.tile, { action: 3, id });
    }
    for (const { data, sprite } of this.items.values()) {
      if (sprite.visible) consider(sprite, data, data.inChest ? { action: 4, x: data.x, y: data.y } : { action: 0 });
    }
    for (const npc of this.npcs.values()) consider(npc.sprite, npc.tile, { action: 0 }, npc);
    const { tile, action, npc } = target;
    const end = npc ? { x: tile.x, y: tile.y + 1 } : tile;
    const start = this.tileAt(hero);
    if (npc && tileDistance(start, end) === 0) {
      if (hero.motion) return;
      hero.direction = 2;
      this.showFrame(hero, idleFrame[hero.direction]);
      this.speak(npc);
      return;
    }
    if (tileDistance(start, end) > 28) return;
    const path = this.findPath(start, end);
    if (!path || path.length < 2) return;
    const orientation = npc ? 2 : directionBetween(path[path.length - 2], end);
    if (action.action !== 0) path.pop();
    if (path.length > 60 || !this.onPath(path, orientation, action)) return;
    this.move(hero, path, orientation, 0, npc ? () => this.speak(npc) : undefined);
  }

  private findPath(start: Tile, end: Tile): Tile[] | null {
    if (this.collision[start.y]?.[start.x] === undefined || this.collision[end.y]?.[end.x] !== 0) return null;
    let path: Tile[] | null = null;
    this.pathfinder.findPath(start.x, start.y, end.x, end.y, (result: Tile[] | null) => { path = result; });
    this.pathfinder.calculate();
    return path;
  }

  private move(avatar: Avatar, path: Tile[], orientation?: number, latency = 0, onComplete?: () => void) {
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
      from: 0, to: path.length - 1, duration: Math.max(1, (path.length - 1) * playerStepMs - latency),
      onUpdate: (tween) => {
        if (path.length === 1) return;
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
          if (!this.cameraDoor) this.onOutdoorArrival(end);
          this.destination?.setVisible(false);
          if (crossing) {
            this.lastCrossing = crossing;
            this.setHeroCamera(avatar, crossing.door);
          }
        }
        onComplete?.();
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
