import { Room, type Client } from 'colyseus';
import { AOIutils } from '../../shared/AOIutils.ts';
import { CharacterJoinError, type PathCommand } from '../../shared/WorldProtocol.ts';

const { GameServer } = require('./GameServer.js');

type Session = {
  id: unknown;
  player?: Promise<{ id: number; newAOIs: number[]; listAdjacentAOIs(onlyIds: true): number[] } | null>;
  ready: boolean;
  stamp: number;
  samples: number[];
  latency: number;
};

export class WorldRoom extends Room {
  autoDispose = false;
  patchRate = 200;

  private sessions = new Map<string, Session>();

  onCreate() {
    this.setTimestep(GameServer.update, GameServer.updateRate);
    this.clock.setInterval(GameServer.regenerate, GameServer.regenRate);
    GameServer.schedule = (callback: (...args: any[]) => void, delay: number, ...args: any[]) =>
      this.clock.setTimeout(callback, delay, ...args);
  }

  onJoin(client: Client, options: { id?: unknown }) {
    this.sessions.set(client.sessionId, { id: options?.id, ready: false, stamp: 0, samples: [], latency: 0 });
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
    await session?.player?.catch(() => {});
    await GameServer.removePlayer(client.sessionId);
  }

  onDispose() {
    this.clock.clear();
  }

  onBeforePatch() {
    GameServer.updatePlayers((sessionId: string, update: object) => {
      const session = this.sessions.get(sessionId);
      const client = this.clients.getById(sessionId);
      if (session?.ready && client) client.send('update', { ...update, stamp: session.stamp = Date.now() });
    });
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
        player.newAOIs = player.listAdjacentAOIs(true);
        session.ready = true;
        client.send('init', { ...GameServer.createInitializationPacket(player.id), stamp: session.stamp = Date.now() });
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
