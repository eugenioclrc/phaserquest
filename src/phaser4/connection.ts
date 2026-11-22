import { io, type Socket } from 'socket.io-client';
import { CoDec, type ObjectSchema } from '../../shared/CoDec.ts';
import Decoder from '../Decoder.ts';
import type { PersonalUpdate, PlayerSnapshot, Tile, WorldUpdate } from './protocol.ts';

type EntryRequest = { new: true; name: string } | { new: false; id: string };

type Initialization = {
  stamp: number;
  player: PlayerSnapshot;
  nbconnected: number;
  nbAOIhorizontal: number;
  lastAOIid: number;
};

type Update = {
  stamp: number;
  global?: WorldUpdate;
  local?: PersonalUpdate;
  nbconnected?: number;
};

type ServerEvents = {
  init(data: ArrayBuffer | Initialization): void;
  update(data: ArrayBuffer | Update): void;
  reset(tile: Tile | null): void;
  chat(message: { id: number; txt: string }): void;
  dbError(error?: { retryable?: boolean } | null): void;
  pid(id: string): void;
  wait(): void;
};

type ClientEvents = {
  'init-world'(request: EntryRequest & { clientTime: number }): void;
  ponq(stamp: number): void;
  path(movement: { path: Tile[]; action: { action: 0 }; or: number }): void;
  chat(text: string): void;
};

type ConnectionEvents = {
  enter(player: PlayerSnapshot, nbAOIhorizontal: number, lastAOIid: number): void;
  updateWorld(update: WorldUpdate): void;
  updateSelf(update: PersonalUpdate): void;
  reset(tile: Tile): void;
  say(id: number, text: string): void;
  online(count: number): void;
  pending(message: string): void;
  error(message: string): void;
};

export function savedCharacter(): { id: string; name: string } | null {
  const id = localStorage.getItem('playerID');
  const name = localStorage.getItem('name');
  return id && name ? { id, name } : null;
}

function unpack<T>(data: ArrayBuffer | T, schema: ObjectSchema): T {
  return data instanceof ArrayBuffer ? Decoder.decode(data, schema) as T : data;
}

export function createConnection(events: ConnectionEvents) {
  const socket: Socket<ServerEvents, ClientEvents> = io({ autoConnect: false });
  let request: EntryRequest | null = null;
  let entered = false;
  let retry: number | undefined;

  function cancelRetry() {
    window.clearTimeout(retry);
    retry = undefined;
  }

  function requestEntry() {
    if (request && !entered && socket.connected) {
      socket.emit('init-world', { ...request, clientTime: Date.now() });
    }
  }

  function sendAction(emit: () => void): boolean {
    if (!entered || !socket.connected) return false;
    const buffered = socket.sendBuffer.length;
    let sent = false;
    const markSent = () => { sent = true; };
    socket.onAnyOutgoing(markSent);
    try {
      emit();
      return sent;
    } finally {
      socket.offAnyOutgoing(markSent);
      // Drop actions Socket.IO buffered for a future connection after heartbeat expiry.
      if (!sent) socket.sendBuffer.splice(buffered);
    }
  }

  socket.on('connect', requestEntry);
  socket.on('disconnect', () => {
    entered = false;
    cancelRetry();
    if (request) events.pending('Connection lost. Reconnecting…');
  });
  socket.on('connect_error', () => {
    if (request) events.pending('Could not connect to the game server. Retrying…');
  });

  socket.on('wait', () => {
    if (!request || entered || retry !== undefined) return;
    events.pending('Waiting for the game world…');
    retry = window.setTimeout(() => {
      retry = undefined;
      requestEntry();
    }, 500);
  });

  socket.on('pid', (id) => {
    if (!request?.new) return;
    localStorage.setItem('name', request.name);
    localStorage.setItem('armor', 'clotharmor');
    localStorage.setItem('weapon', 'sword1');
    localStorage.setItem('playerID', id);
    request = { new: false, id };
  });

  socket.on('init', (payload) => {
    if (!request || entered) return;
    cancelRetry();
    const data = unpack(payload, CoDec.initializationSchema);
    entered = true;
    socket.emit('ponq', data.stamp);
    events.enter(data.player, data.nbAOIhorizontal, data.lastAOIid);
    events.online(data.nbconnected);
  });

  socket.on('update', (payload) => {
    if (!entered) return;
    const data = unpack(payload, CoDec.finalUpdateSchema);
    socket.emit('ponq', data.stamp);
    if (data.nbconnected !== undefined) events.online(data.nbconnected);
    if (data.global) events.updateWorld(data.global);
    if (data.local) events.updateSelf(data.local);
  });

  socket.on('reset', (tile) => { if (entered && tile) events.reset(tile); });
  socket.on('chat', ({ id, txt }) => { if (entered) events.say(id, txt); });
  socket.on('dbError', (error) => {
    if (!request || entered) return;
    cancelRetry();
    if (!error?.retryable && !request.new && localStorage.getItem('playerID') === request.id) {
      for (const key of ['playerID', 'name', 'armor', 'weapon']) localStorage.removeItem(key);
    }
    request = null;
    events.error(error?.retryable ? 'Could not reach the character database. Try again.' : 'This saved character could not be found.');
  });

  return {
    play(name?: string) {
      if (request) return;
      if (name === undefined) {
        const saved = savedCharacter();
        if (!saved) {
          events.error('There is no saved character to load.');
          return;
        }
        request = { new: false, id: saved.id };
      } else {
        const playerName = name.trim();
        if (!playerName || playerName.length > 20) {
          events.error('Enter a character name of 1 to 20 characters.');
          return;
        }
        request = { new: true, name: playerName };
      }
      if (socket.connected) requestEntry();
      else socket.connect();
    },
    move(path: Tile[], orientation: number): boolean {
      if (path.length < 2 || path.length > 60) return false;
      return sendAction(() => socket.emit('path', { path, action: { action: 0 }, or: orientation }));
    },
    chat(text: string): boolean {
      if (!text.trim() || text.length > 300) return false;
      return sendAction(() => socket.emit('chat', text));
    },
  };
}
