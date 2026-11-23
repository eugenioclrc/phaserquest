import core = require('@colyseus/core');
import colyseus = require('@colyseus/schema');
import spatialAreas = require('../../shared/AOIutils.ts');
import protocol = require('../../shared/WorldProtocol.ts');
import world = require('./WorldState.ts');
import type { ReplicatedWorld, VisibleEntity } from './WorldTypes.ts';
import type { Client } from '@colyseus/core';
import type { PathCommand } from '../../shared/WorldProtocol.ts';
import GameServer = require('./GameServer.ts');
import type GameObject = require('./GameObject.ts');
import type Player = require('./Player.ts');

const { AOIutils } = spatialAreas;
const { CharacterJoinError, chatCooldownMs } = protocol;
const { SelfState, WorldState, entityCollection, syncEntity } = world;

type Session = {
  id: unknown;
  player?: Promise<Player | null>;
  view: colyseus.StateView;
  seen: Set<VisibleEntity>;
  area?: number;
  ready: boolean;
  nextChatAt: number;
};

class WorldRoom extends core.Room<{ state: ReplicatedWorld }> {
  state = new WorldState();
  autoDispose = false;
  patchRate = 200;

  private sessions = new Map<string, Session>();
  private departures = new Set<Promise<void>>();

  onCreate() {
    this.setTimestep(() => GameServer.update(), GameServer.updateRate);
    this.clock.setInterval(() => GameServer.regenerate(), GameServer.regenRate);
    GameServer.schedule = (callback, delay) => this.clock.setTimeout(callback, delay);
    this.clock.setInterval(() => {
      for (const client of this.clients) {
        const session = this.sessions.get(client.sessionId);
        if (session?.ready) client.send('ping', Date.now());
      }
    }, 5000);
  }

  onJoin(client: Client, options: { id?: unknown }) {
    const view = client.view = new colyseus.StateView();
    this.sessions.set(client.sessionId, {
      id: options?.id, view, seen: new Set(), ready: false, nextChatAt: 0,
    });
  }

  async onDrop(client: Client) {
    const session = this.sessions.get(client.sessionId);
    if (!session) return;
    session.ready = false;
    await this.allowReconnection(client, 10).catch(() => {});
  }

  onLeave(client: Client) {
    return this.leaveSession(client.sessionId);
  }

  private leaveSession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    this.state.self.delete(sessionId);
    const departure = Promise.resolve(session.player)
      .catch(() => {})
      .then(() => GameServer.removePlayer(sessionId))
      .finally(() => this.departures.delete(departure));
    this.departures.add(departure);
    return departure;
  }

  async onDispose() {
    this.clock.clear();
    // The room can start closing before dropped clients finish leaving.
    for (const sessionId of this.sessions.keys()) this.leaveSession(sessionId);
    const results = await Promise.allSettled(this.departures);
    for (const result of results) if (result.status === 'rejected') throw result.reason;
  }

  onBeforePatch() {
    this.syncWorld();
    for (const [sessionId, session] of this.sessions) {
      if (!session.ready) continue;
      const client = this.clients.getById(sessionId);
      if (!client) continue;
      const update = GameServer.getPlayer(sessionId)?.getIndividualUpdatePackage()?.clean();
      if (!update) continue;
      const { x, y, teleport, ...events } = update;
      if (teleport) client.send('reset', { ...teleport, teleport: true }, { afterNextPatch: true });
      if (x !== undefined && y !== undefined) client.send('revived', { x, y }, { afterNextPatch: true });
      if (Object.keys(events).length) client.send('playerEvents', events, { afterNextPatch: true });
    }
  }

  private syncWorld() {
    const dirty = GameServer.changedEntities;
    const changedAreas = GameServer.changedAreas;
    const removed: GameObject[] = [];
    for (const entity of dirty) {
      if (entity.inWorld) syncEntity(this.state, entity);
      else removed.push(entity);
    }

    let online = 0;
    for (const [sessionId, session] of this.sessions) {
      const player = GameServer.getPlayer(sessionId);
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
        for (const entity of GameServer.AOIs[id].entities) {
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
        client.send('ready', { x, y, stamp: Date.now() });
      } catch (error) {
        const code = (error as { code?: keyof typeof CharacterJoinError }).code;
        client.send('entryError', (code && CharacterJoinError[code]) || CharacterJoinError.unavailable);
      }
    },
    path: (client: Client, command: PathCommand) => {
      const session = this.sessions.get(client.sessionId);
      if (!session?.ready) return;
      if (!GameServer.handlePath(client.sessionId, command)) {
        client.send('reset', GameServer.getMovementCorrection(client.sessionId));
      }
    },
    revive: (client: Client) => {
      if (this.sessions.get(client.sessionId)?.ready) GameServer.getPlayer(client.sessionId)?.revive();
    },
    ponq: () => {}, // Older tabs still reply to clock updates.
    chat: (client: Client, txt: string) => {
      const session = this.sessions.get(client.sessionId);
      const now = Date.now();
      if (!session?.ready || now < session.nextChatAt || typeof txt !== 'string' || !txt.trim() || txt.length > 300) return false;
      const sender = GameServer.getPlayer(client.sessionId);
      if (!sender) return false;
      session.nextChatAt = now + chatCooldownMs - 100; // Allow for variation in message transit time.
      const nearby = AOIutils.listAdjacentAOIs(sender.aoi);
      for (const peer of this.clients) {
        if (peer === client || !this.sessions.get(peer.sessionId)?.ready) continue;
        const player = GameServer.getPlayer(peer.sessionId);
        if (player && nearby.includes(player.aoi)) peer.send('chat', { id: sender.id, txt });
      }
      return true;
    },
  };
}

export = WorldRoom;
