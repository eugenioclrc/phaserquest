import { Room, type Client } from '@colyseus/core';
import { StateView } from '@colyseus/schema';
import { AOIutils } from '../../shared/AOIutils.ts';
import { CharacterJoinError, type PathCommand, type PlayerEvents, type Tile } from '../../shared/WorldProtocol.ts';
import {
  SelfState, WorldState, entityCollection, syncEntity,
  type PlayerEntity, type VisibleEntity, type WorldEntity,
} from './WorldState.ts';

const { GameServer } = require('./GameServer.js');

type Session = {
  id: unknown;
  player?: Promise<PlayerEntity | null>;
  view: StateView;
  seen: Set<VisibleEntity>;
  area?: number;
  ready: boolean;
  stamp: number;
  samples: number[];
  latency: number;
};

export class WorldRoom extends Room<{ state: WorldState }> {
  state = new WorldState();
  autoDispose = false;
  patchRate = 200;

  private sessions = new Map<string, Session>();

  onCreate() {
    this.setTimestep(GameServer.update, GameServer.updateRate);
    this.clock.setInterval(GameServer.regenerate, GameServer.regenRate);
    GameServer.schedule = (callback: (...args: any[]) => void, delay: number, ...args: any[]) =>
      this.clock.setTimeout(callback, delay, ...args);
    this.clock.setInterval(() => {
      for (const client of this.clients) {
        const session = this.sessions.get(client.sessionId);
        if (session?.ready) client.send('ping', session.stamp = Date.now());
      }
    }, 5000);
  }

  onJoin(client: Client, options: { id?: unknown }) {
    const view = client.view = new StateView();
    this.sessions.set(client.sessionId, {
      id: options?.id, view, seen: new Set(), ready: false, stamp: 0, samples: [], latency: 0,
    });
  }

  async onDrop(client: Client) {
    const session = this.sessions.get(client.sessionId);
    if (!session) return;
    session.ready = false;
    await this.allowReconnection(client, 10).catch(() => {});
  }

  async onLeave(client: Client) {
    const session = this.sessions.get(client.sessionId);
    if (!this.sessions.delete(client.sessionId)) return;
    this.state.self.delete(client.sessionId);
    await session?.player?.catch(() => {});
    await GameServer.removePlayer(client.sessionId);
  }

  onDispose() {
    this.clock.clear();
  }

  onBeforePatch() {
    this.syncWorld();
    for (const [sessionId, session] of this.sessions) {
      const player = GameServer.getPlayer(sessionId);
      const update: (PlayerEvents & Partial<Tile> & { teleport?: Tile }) | undefined = player?.getIndividualUpdatePackage()?.clean();
      if (!session.ready || !update) continue;
      const client = this.clients.getById(sessionId);
      if (!client) continue;
      const { x, y, teleport, ...events } = update;
      if (teleport) client.send('reset', teleport, { afterNextPatch: true });
      if (x !== undefined && y !== undefined) client.send('revived', { x, y }, { afterNextPatch: true });
      if (Object.keys(events).length) client.send('playerEvents', events, { afterNextPatch: true });
    }
  }

  private syncWorld() {
    const dirty = GameServer.changedEntities as Set<WorldEntity>;
    const changedAreas = GameServer.changedAreas as Set<number>;
    const removed: WorldEntity[] = [];
    for (const entity of dirty) {
      if (entity.inWorld) syncEntity(this.state, entity);
      else removed.push(entity);
    }

    let online = 0;
    for (const [sessionId, session] of this.sessions) {
      const player: PlayerEntity | undefined = GameServer.getPlayer(sessionId);
      if (!player) continue;
      if (session.ready) online++;
      let self = this.state.self.get(sessionId);
      const door = player.lastDoor;
      if (!self) {
        self = new SelfState().assign({ playerId: player.id, life: player.life });
        this.state.self.set(sessionId, self);
        session.view.add(self);
      }
      self.life = player.life;
      self.doorX = door?.x ?? -1;
      self.doorY = door?.y ?? -1;

      const nearby = AOIutils.listAdjacentAOIs(player.aoi);
      if (session.area === player.aoi && !nearby.some(id => changedAreas.has(id))) continue;
      session.area = player.aoi;
      const seen = new Set<VisibleEntity>();
      for (const id of nearby) {
        for (const entity of GameServer.AOIs[id].entities as WorldEntity[]) {
          const row = this.state[entityCollection[entity.category]].get(String(entity.id));
          if (row) seen.add(row);
        }
      }
      for (const row of session.seen) if (!seen.has(row)) session.view.remove(row);
      for (const row of seen) if (!session.seen.has(row)) session.view.add(row);
      session.seen = seen;
    }
    this.state.online = online;
    for (const entity of removed) this.state[entityCollection[entity.category]].delete(String(entity.id));
    dirty.clear();
    changedAreas.clear();
  }

  messages = {
    ready: async (client: Client) => {
      const { sessionId } = client;
      const session = this.sessions.get(sessionId);
      if (!session || session.ready) return;
      try {
        session.player ??= GameServer.loadPlayer(sessionId, session.id, () => this.sessions.has(sessionId));
        const player = await session.player;
        if (!player || session.ready || this.clients.getById(sessionId) !== client) return;
        session.ready = true;
        const { x, y } = player;
        client.send('ready', { x, y, stamp: session.stamp = Date.now() });
      } catch (error) {
        const code = (error as { code?: keyof typeof CharacterJoinError }).code;
        client.send('entryError', (code && CharacterJoinError[code]) || CharacterJoinError.unavailable);
      }
    },
    path: (client: Client, command: PathCommand) => {
      const session = this.sessions.get(client.sessionId);
      if (!session?.ready) return;
      if (!GameServer.handlePath(client.sessionId, command, session.latency)) {
        client.send('reset', GameServer.getMovementCorrection(client.sessionId));
      }
    },
    revive: (client: Client) => {
      if (this.sessions.get(client.sessionId)?.ready) GameServer.getPlayer(client.sessionId)?.revive();
    },
    chat: (client: Client, txt: string) => {
      if (!this.sessions.get(client.sessionId)?.ready || typeof txt !== 'string' || !txt.trim() || txt.length > 300) return;
      const sender = GameServer.getPlayer(client.sessionId);
      const nearby = AOIutils.listAdjacentAOIs(sender.aoi);
      for (const peer of this.clients) {
        if (peer === client || !this.sessions.get(peer.sessionId)?.ready) continue;
        const player = GameServer.getPlayer(peer.sessionId);
        if (nearby.includes(player.aoi)) peer.send('chat', { id: sender.id, txt });
      }
    },
    ponq: (client: Client, stamp: number) => {
      const session = this.sessions.get(client.sessionId);
      if (!session?.ready || !session.stamp || stamp !== session.stamp) return;
      const sample = Math.min(500, Math.max(0, (Date.now() - stamp) / 2));
      session.stamp = 0;
      session.samples.push(sample);
      if (session.samples.length > 20) session.samples.shift();
      const sorted = session.samples.toSorted((a, b) => a - b);
      session.latency = sorted[Math.floor((sorted.length - 1) / 2)];
    },
  };
}
