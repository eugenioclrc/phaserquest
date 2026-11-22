import { Room, type Client } from 'colyseus';
import { StateView } from '@colyseus/schema';
import { AOIutils } from '../../shared/AOIutils.ts';
import { CharacterJoinError, type PathCommand, type Tile } from '../../shared/WorldProtocol.ts';
import type { PersonalUpdate, WorldUpdate } from '../../src/phaser4/protocol.ts';
import { SelfState, WorldState, syncPlayer, type PlayerEntity, type PlayerState } from './WorldState.ts';

const { GameServer } = require('./GameServer.js');

type Session = {
  id: unknown;
  player?: Promise<(PlayerEntity & { newAOIs: number[] }) | null>;
  view: StateView;
  seen: Set<PlayerState>;
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
    this.state.aoiColumns = AOIutils.nbAOIhorizontal;
    this.state.aoiCount = AOIutils.lastAOIid;
    this.setTimestep(GameServer.update, GameServer.updateRate);
    this.clock.setInterval(GameServer.regenerate, GameServer.regenRate);
    GameServer.schedule = (callback: (...args: any[]) => void, delay: number, ...args: any[]) =>
      this.clock.setTimeout(callback, delay, ...args);
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
    this.syncPlayers();
    GameServer.updatePlayers((sessionId: string, update: {
      global?: WorldUpdate;
      local?: PersonalUpdate & { teleport?: Tile };
    }) => {
      const session = this.sessions.get(sessionId);
      const client = this.clients.getById(sessionId);
      if (!session?.ready || !client) return;
      if (update.global) {
        const { players, newplayers, disconnected, ...entities } = update.global;
        if (Object.keys(entities).length) client.send('update', entities, { afterNextPatch: true });
      }
      if (update.local) {
        const { x, y, life, teleport, ...playerEvents } = update.local;
        if (teleport) client.send('reset', teleport, { afterNextPatch: true });
        if (x !== undefined && y !== undefined) client.send('revived', { x, y }, { afterNextPatch: true });
        if (Object.keys(playerEvents).length) client.send('playerEvents', playerEvents, { afterNextPatch: true });
      }
    });
  }

  private syncPlayers() {
    const dirty = GameServer.changedEntities as Set<{ category: string; inWorld: boolean; id: number }>;
    const changedAreas = GameServer.changedAreas as Set<number>;
    const removed = [];
    for (const entity of dirty) {
      if (entity.category !== 'player') continue;
      if (entity.inWorld) syncPlayer(this.state, entity as PlayerEntity);
      else removed.push(String(entity.id));
    }

    let online = 0;
    for (const [sessionId, session] of this.sessions) {
      const player: PlayerEntity | undefined = GameServer.getPlayer(sessionId);
      if (!player) continue;
      if (session.ready) online++;
      let self = this.state.self.get(sessionId);
      if (!self) {
        self = new SelfState().assign({ playerId: player.id, life: player.life });
        this.state.self.set(sessionId, self);
        session.view.add(self);
      } else {
        self.life = player.life;
      }

      const nearby = AOIutils.listAdjacentAOIs(player.aoi);
      if (session.area === player.aoi && !nearby.some(id => changedAreas.has(id))) continue;
      session.area = player.aoi;
      const seen = new Set<PlayerState>();
      for (const id of nearby) {
        for (const entity of GameServer.AOIs[id].entities) {
          if (entity.category !== 'player') continue;
          const row = this.state.players.get(String(entity.id));
          if (row) seen.add(row);
        }
      }
      for (const row of session.seen) if (!seen.has(row)) session.view.remove(row);
      for (const row of seen) if (!session.seen.has(row)) session.view.add(row);
      session.seen = seen;
    }
    this.state.online = online;
    for (const key of removed) this.state.players.delete(key);
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
        player.newAOIs = AOIutils.listAdjacentAOIs(player.aoi);
        session.ready = true;
        client.send('ping', session.stamp = Date.now());
      } catch (error) {
        const code = (error as { code?: keyof typeof CharacterJoinError }).code;
        client.send('entryError', (code && CharacterJoinError[code]) || CharacterJoinError.unavailable);
      }
    },
    path: (client: Client, command: PathCommand) => {
      const session = this.sessions.get(client.sessionId);
      if (!session?.ready) return;
      if (!GameServer.handlePath(client.sessionId, command, session.latency)) {
        client.send('reset', GameServer.getCurrentPosition(client.sessionId));
      }
    },
    revive: (client: Client) => {
      if (this.sessions.get(client.sessionId)?.ready) GameServer.revivePlayer(GameServer.getPlayerID(client.sessionId));
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
