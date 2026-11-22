import { io, type Socket } from 'socket.io-client';
import { CoDec, type ObjectSchema } from '../../shared/CoDec.ts';
import Decoder from '../Decoder.ts';
import type { PathAction, PersonalUpdate, PlayerSnapshot, Tile, WorldUpdate } from './protocol.ts';

type EntryRequest = { id: string };

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
  dbError(error: { code: string }): void;
  wait(): void;
};

type ClientEvents = {
  'init-world'(request: EntryRequest & { clientTime: number }): void;
  ponq(stamp: number): void;
  path(movement: { path: Tile[]; action: PathAction; or: number }): void;
  revive(): void;
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

function clearCharacter(id: string) {
  if (localStorage.getItem('playerID') !== id) return;
  for (const key of Object.keys(localStorage)) {
    if (['playerID', 'name', 'armor', 'weapon'].includes(key) || /^(ach|killed_)\d+$/.test(key)) {
      localStorage.removeItem(key);
    }
  }
}

function postCharacter(url: string, body: { id: string; name?: string }) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
}

async function createCharacter(name: string): Promise<string> {
  const key = 'pendingCharacter';
  const pending = JSON.parse(sessionStorage.getItem(key) || 'null') as { id: string; name: string } | null;
  const id = pending?.name === name ? pending.id : Array.from(crypto.getRandomValues(new Uint8Array(12)),
    byte => byte.toString(16).padStart(2, '0')).join('');
  sessionStorage.setItem(key, JSON.stringify({ id, name }));
  const response = await postCharacter('/api/characters', { id, name });
  if (response.status === 409) sessionStorage.removeItem(key);
  if (!response.ok || (await response.json()).id !== id) throw new Error('Creation was not confirmed');
  localStorage.setItem('name', name);
  localStorage.setItem('armor', 'clotharmor');
  localStorage.setItem('weapon', 'sword1');
  localStorage.setItem('playerID', id);
  sessionStorage.removeItem(key);
  return id;
}

function characterMessage(code: string): string {
  if (code === 'missing') return 'This saved character could not be found.';
  if (code === 'busy') return 'This character is already in the game. Try again after leaving.';
  return 'Could not reach the character database. Try again.';
}

function unpack<T>(data: ArrayBuffer | T, schema: ObjectSchema): T {
  return data instanceof ArrayBuffer ? Decoder.decode(data, schema) as T : data;
}

export function createConnection(events: ConnectionEvents) {
  const socket: Socket<ServerEvents, ClientEvents> = io({ autoConnect: false });
  let request: EntryRequest | null = null;
  let entered = false;
  let retry: number | undefined;
  let deleting = false;
  let creating = false;

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
  socket.on('dbError', ({ code }) => {
    if (!request || entered) return;
    cancelRetry();
    if (code === 'missing') clearCharacter(request.id);
    request = null;
    events.error(characterMessage(code));
  });

  return {
    async deleteCharacter(id: string): Promise<boolean> {
      if (deleting || creating || request || savedCharacter()?.id !== id) return false;
      deleting = true;
      try {
        const response = await postCharacter('/api/characters/delete', { id });
        if (!response.ok || (await response.json()).ok !== true) return false;
        clearCharacter(id);
        return true;
      } catch {
        return false;
      } finally {
        deleting = false;
      }
    },
    async play(name?: string) {
      if (request || creating || deleting) return;
      if (name === undefined) {
        const saved = savedCharacter();
        if (!saved) {
          events.error('There is no saved character to load.');
          return;
        }
        request = { id: saved.id };
      } else {
        const playerName = name.trim();
        if (!playerName || playerName.length > 20) {
          events.error('Enter a character name of 1 to 20 characters.');
          return;
        }
        creating = true;
        try {
          request = { id: await createCharacter(playerName) };
        } catch {
          events.error('Could not create the character. Try again.');
          return;
        } finally {
          creating = false;
        }
      }
      if (socket.connected) requestEntry();
      else socket.connect();
    },
    move(path: Tile[], orientation: number, action: PathAction = { action: 0 }): boolean {
      if (path.length < (action.action === 0 ? 2 : 1) || path.length > 60) return false;
      return sendAction(() => socket.emit('path', { path, action, or: orientation }));
    },
    revive(): boolean {
      return sendAction(() => socket.emit('revive'));
    },
    chat(text: string): boolean {
      if (!text.trim() || text.length > 300) return false;
      return sendAction(() => socket.emit('chat', text));
    },
  };
}
