import { Client, type Room } from '@colyseus/sdk';
import { CharacterJoinError } from '../../shared/WorldProtocol.ts';
import type { PathAction, PersonalUpdate, PlayerSnapshot, Tile, WorldUpdate } from './protocol.ts';

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

function characterMessage(code?: number): string {
  if (code === CharacterJoinError.missing) return 'This saved character could not be found.';
  if (code === CharacterJoinError.busy) return 'This character is already in the game. Try again after leaving.';
  return 'Could not reach the character database. Try again.';
}

export function createConnection(events: ConnectionEvents) {
  const sdk = new Client(window.location.origin);
  let room: Room | undefined;
  let characterId: string | undefined;
  let entered = false;
  let deleting = false;
  let creating = false;

  function sendAction(type: string, payload?: unknown): boolean {
    if (!entered || !room?.connection.isOpen) return false;
    room.send(type, payload);
    return true;
  }

  async function join(id: string, resume = true) {
    const key = 'worldReconnection:' + id;
    try {
      let next: Room | undefined;
      if (resume) {
        const token = sessionStorage.getItem(key);
        if (token) {
          try {
            next = await sdk.reconnect(token);
          } catch {
            sessionStorage.removeItem(key);
          }
        }
      }
      next ??= await sdk.join('world', { id });
      room = next;
      next.reconnection.minUptime = 0;
      next.reconnection.maxEnqueuedMessages = 0;
      let dropped = false;

      function ready() {
        sessionStorage.setItem(key, next!.reconnectionToken);
        next!.send('ready');
      }

      next.onDrop(() => {
        dropped = true;
        entered = false;
        events.pending('Connection lost. Reconnecting…');
      });
      next.onReconnect(() => {
        dropped = false;
        ready();
      });
      next.onLeave(() => {
        if (room !== next) return;
        room = undefined;
        entered = false;
        sessionStorage.removeItem(key);
        if (dropped) void join(id, false);
        else {
          characterId = undefined;
          events.error('Lost the connection to the game. Try again.');
        }
      });
      next.onMessage('entryError', (code: number) => {
        if (room !== next) return;
        room = undefined;
        characterId = undefined;
        entered = false;
        sessionStorage.removeItem(key);
        if (code === CharacterJoinError.missing) clearCharacter(id);
        events.error(characterMessage(code));
        void next!.leave();
      });
      next.onMessage('init', (data: Initialization) => {
        entered = true;
        next!.send('ponq', data.stamp);
        events.enter(data.player, data.nbAOIhorizontal, data.lastAOIid);
        events.online(data.nbconnected);
      });
      next.onMessage('update', (data: Update) => {
        if (!entered) return;
        next!.send('ponq', data.stamp);
        if (data.nbconnected !== undefined) events.online(data.nbconnected);
        if (data.global) events.updateWorld(data.global);
        if (data.local) events.updateSelf(data.local);
      });
      next.onMessage('reset', (tile: Tile | null) => { if (entered && tile) events.reset(tile); });
      next.onMessage('chat', ({ id: sender, txt }: { id: number; txt: string }) => { if (entered) events.say(sender, txt); });
      ready();
    } catch (error) {
      const code = (error as { code?: number }).code;
      characterId = undefined;
      if (code === CharacterJoinError.missing) clearCharacter(id);
      events.error(characterMessage(code));
    }
  }

  return {
    async deleteCharacter(id: string): Promise<boolean> {
      if (deleting || creating || characterId || savedCharacter()?.id !== id) return false;
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
      if (characterId || creating || deleting) return;
      if (name === undefined) {
        const saved = savedCharacter();
        if (!saved) {
          events.error('There is no saved character to load.');
          return;
        }
        characterId = saved.id;
      } else {
        const playerName = name.trim();
        if (!playerName || playerName.length > 20) {
          events.error('Enter a character name of 1 to 20 characters.');
          return;
        }
        creating = true;
        try {
          characterId = await createCharacter(playerName);
        } catch {
          events.error('Could not create the character. Try again.');
          return;
        } finally {
          creating = false;
        }
      }
      await join(characterId);
    },
    move(path: Tile[], orientation: number, action: PathAction = { action: 0 }): boolean {
      if (path.length < (action.action === 0 ? 2 : 1) || path.length > 60) return false;
      return sendAction('path', { path, action, or: orientation });
    },
    revive(): boolean {
      return sendAction('revive');
    },
    chat(text: string): boolean {
      if (!text.trim() || text.length > 300) return false;
      return sendAction('chat', text);
    },
  };
}
