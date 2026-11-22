import { Callbacks, Client, type Room } from '@colyseus/sdk';
import { CharacterJoinError, type MovementCorrection } from '../../shared/WorldProtocol.ts';
import type { ItemSnapshot, MonsterSnapshot, PathAction, PersonalUpdate, PlayerSnapshot, Tile, WorldUpdate } from './protocol.ts';

import type { WorldRoom } from '../../js/server/WorldRoom.ts';
import type { ItemState, MonsterState, PlayerState } from '../../js/server/WorldState.ts';

function playerSnapshot(row: PlayerState, serverNow: number): PlayerSnapshot {
  const { id, name, x, y, aoi, armor, weapon, alive, inFight, targetID, routeVersion } = row;
  return {
    id, name, x, y, aoi, armor, weapon, alive, inFight, targetID, routeVersion,
    route: row.routeOrientation ? {
      end: { x: row.routeEndX, y: row.routeEndY },
      orientation: row.routeOrientation,
      elapsed: Math.max(0, (serverNow - row.routeStartedAt) | 0),
    } : undefined,
  };
}

function monsterSnapshot(row: MonsterState): MonsterSnapshot {
  const { id, x, y, monster, alive, inFight, targetID, lastHitter, routeVersion, route } = row;
  return {
    id, x, y, monster, alive, inFight, targetID, lastHitter, routeVersion,
    route: route && { path: Array.from(route.path, tile => ({ x: tile.x, y: tile.y })), delta: route.delta },
  };
}

function itemSnapshot(row: ItemState): ItemSnapshot {
  const { id, x, y, itemID, visible, respawn, chest, inChest, loot } = row;
  return { id, x, y, itemID, visible, respawn, chest, inChest, loot };
}

type ConnectionEvents = {
  enter(player: PlayerSnapshot, door?: Tile): void;
  updateWorld(update: WorldUpdate): void;
  updateSelf(update: PersonalUpdate): void;
  reset(correction: MovementCorrection): void;
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
  let room: Room<WorldRoom> | undefined;
  let characterId: string | undefined;
  let entered = false;
  let deleting = false;
  let creating = false;

  function sendAction(send: (active: Room<WorldRoom>) => void): boolean {
    if (!entered || !room?.connection.isOpen) return false;
    send(room);
    return true;
  }

  async function join(id: string, resume = true) {
    const key = 'worldReconnection:' + id;
    try {
      let resumed: Room<WorldRoom> | undefined;
      if (resume) {
        const token = sessionStorage.getItem(key);
        if (token) {
          try {
            resumed = await sdk.reconnect<WorldRoom>(token);
          } catch {
            sessionStorage.removeItem(key);
          }
        }
      }
      const next = resumed ?? await sdk.join<WorldRoom>('world', { id });
      room = next;
      next.reconnection.minUptime = 0;
      next.reconnection.maxEnqueuedMessages = 0;
      let dropped = false;
      let lastServerOffset = 0;
      let heroPosition: Tile | undefined;
      const snapshot = (player: PlayerState) => playerSnapshot(player, Date.now() + lastServerOffset);

      let worldUpdate: WorldUpdate = {};
      const callbacks = Callbacks.get(next);
      const unbind = new Map<string, () => void>();
      callbacks.onAdd('players', (player, key) => {
        (worldUpdate.newPlayers ??= []).push(snapshot(player));
        unbind.set('p' + key, callbacks.onChange(player, () => {
          (worldUpdate.players ??= {})[player.id] = snapshot(player);
        }));
      });
      callbacks.onRemove('players', (player, key) => {
        unbind.get('p' + key)?.();
        unbind.delete('p' + key);
        (worldUpdate.removedPlayers ??= []).push(player.id);
      });

      callbacks.onAdd('monsters', (monster, key) => {
        (worldUpdate.newMonsters ??= []).push(monsterSnapshot(monster));
        unbind.set('m' + key, callbacks.onChange(monster, () => {
          (worldUpdate.monsters ??= {})[monster.id] = monsterSnapshot(monster);
        }));
      });
      callbacks.onRemove('monsters', (monster, key) => {
        unbind.get('m' + key)?.();
        unbind.delete('m' + key);
        (worldUpdate.removedMonsters ??= []).push(monster.id);
      });
      callbacks.onAdd('items', (item, key) => {
        (worldUpdate.newItems ??= []).push(itemSnapshot(item));
        unbind.set('i' + key, callbacks.onChange(item, () => {
          (worldUpdate.items ??= {})[item.id] = itemSnapshot(item);
        }));
      });
      callbacks.onRemove('items', (item, key) => {
        unbind.get('i' + key)?.();
        unbind.delete('i' + key);
        (worldUpdate.removedItems ??= []).push(item.id);
      });

      function flush() {
        if (room !== next || dropped || !next.state) return;
        const state = next.state;
        const self = state.self?.get(next.sessionId);
        if (!self) return;
        if (!entered) {
          const player = state.players?.get(String(self.playerId));
          if (!player || !heroPosition) return;
          const door = self.doorX >= 0 && self.doorY >= 0 ? { x: self.doorX, y: self.doorY } : undefined;
          events.enter({ ...snapshot(player), ...heroPosition }, door);
          worldUpdate = {
            newPlayers: Array.from(state.players.values(), snapshot),
            newMonsters: Array.from(state.monsters.values(), monsterSnapshot),
            newItems: Array.from(state.items.values(), itemSnapshot),
          };
          entered = true;
        }
        events.updateWorld(worldUpdate);
        worldUpdate = {};
        events.updateSelf({ life: self.life });
        events.online(state.online);
      }

      function ready() {
        if (room !== next) return;
        heroPosition = undefined;
        sessionStorage.setItem(key, next.reconnectionToken);
        next.send('ready');
        flush();
      }

      next.onStateChange(flush);
      next.onDrop(() => {
        dropped = true;
        entered = false;
        events.pending('Connection lost. Reconnecting…');
      });
      next.onReconnect(() => {
        dropped = false;
        // The SDK rotates the token after notifying reconnect listeners.
        queueMicrotask(ready);
      });
      next.onLeave(() => {
        for (const dispose of unbind.values()) dispose();
        unbind.clear();
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
        void next.leave();
      });
      function pong(stamp: number) {
        lastServerOffset = stamp - Date.now();
        next.send('ponq', stamp);
      }
      next.onMessage('ready', ({ x, y, stamp }: Tile & { stamp: number }) => {
        heroPosition = { x, y };
        pong(stamp);
        flush();
      });
      next.onMessage('ping', pong);
      next.onMessage('revived', (tile: Tile) => { if (room === next && entered) events.updateSelf(tile); });
      next.onMessage('playerEvents', (update: PersonalUpdate) => { if (room === next && entered) events.updateSelf(update); });
      next.onMessage('reset', (correction: MovementCorrection | null) => {
        if (room === next && entered && correction) events.reset(correction);
      });
      next.onMessage('chat', ({ id: sender, txt }: { id: number; txt: string }) => { if (room === next && entered) events.say(sender, txt); });
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
      return sendAction(active => active.send('path', { path, action, or: orientation }));
    },
    revive(): boolean {
      return sendAction(active => active.send('revive'));
    },
    chat(text: string): boolean {
      if (!text.trim() || text.length > 300) return false;
      return sendAction(active => active.send('chat', text));
    },
  };
}
