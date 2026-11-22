import * as Phaser from 'phaser4';
import { createConnection, savedCharacter } from './connection.ts';
import { WorldScene } from './WorldScene.ts';

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing preview element #${id}`);
  return node as T;
}

const characterForm = element<HTMLFormElement>('character-form');
const characterName = element<HTMLInputElement>('character-name');
const playButton = element<HTMLButtonElement>('play-button');
const gameHud = element<HTMLElement>('game-hud');
const online = element<HTMLElement>('players-online');
const health = element<HTMLElement>('hero-health');
const chatForm = element<HTMLFormElement>('chat-form');
const chatMessage = element<HTMLInputElement>('chat-message');
const status = element<HTMLElement>('status');

let playerId: number | undefined;
playButton.disabled = true;

function showCharacterForm() {
  const saved = savedCharacter();
  characterName.readOnly = saved !== null;
  if (saved) characterName.value = saved.name;
  playButton.textContent = saved ? 'Continue' : 'Play';
  return saved;
}

const world = new WorldScene(
  () => { playButton.disabled = false; },
  (path, orientation) => connection.move(path, orientation),
);

function setStatus(message: string) {
  status.textContent = message;
  // The forms and status can move the canvas without resizing it.
  world.scale.updateBounds();
}

const connection = createConnection({
  enter(player, nbAOIhorizontal, lastAOIid) {
    playerId = player.id;
    world.enter(player, nbAOIhorizontal, lastAOIid);
    characterForm.hidden = true;
    gameHud.hidden = false;
    health.textContent = '100';
    setStatus('');
  },
  updateWorld: update => world.applyWorld(update),
  updateSelf(update) {
    world.applySelf(update);
    if (update.life !== undefined) health.textContent = String(update.life);
  },
  reset: tile => world.reset(tile),
  say: (id, text) => world.say(id, text),
  online(count) {
    online.textContent = String(count);
  },
  pending: setStatus,
  error(message) {
    playerId = undefined;
    world.leave();
    gameHud.hidden = true;
    characterForm.hidden = false;
    showCharacterForm();
    playButton.disabled = false;
    setStatus(message);
  },
});

showCharacterForm();
characterForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (playButton.disabled) return;
  const saved = savedCharacter();
  const name = characterName.value.trim();
  if (!saved && !name) {
    characterName.focus();
    return;
  }
  playButton.disabled = true;
  setStatus('Connecting…');
  connection.play(saved ? undefined : name);
});

chatForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = chatMessage.value.trim();
  if (playerId === undefined || !connection.chat(text)) return;
  world.say(playerId, text);
  chatMessage.value = '';
});

document.addEventListener('keydown', (event) => {
  if (!gameHud.hidden && event.key === 'Enter' &&
      (event.target === document.body || event.target instanceof HTMLCanvasElement)) {
    event.preventDefault();
    chatMessage.focus();
  }
});

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'phaser4-game',
  width: 980,
  height: 500,
  pixelArt: true,
  backgroundColor: '#1f1a13',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: world,
});
