import * as Phaser from 'phaser';
import { createConnection, savedCharacter } from './connection.ts';
import { WorldScene } from './WorldScene.ts';
import { Achievements } from './Achievements.ts';

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing game element #${id}`);
  return node as T;
}

const characterForm = element<HTMLFormElement>('character-form');
const characterName = element<HTMLInputElement>('character-name');
const playButton = element<HTMLButtonElement>('play-button');
const resetButton = element<HTMLButtonElement>('reset-button');
const resetDialog = element<HTMLDialogElement>('reset-dialog');
const resetStatus = element('reset-status');
const cancelReset = element<HTMLButtonElement>('cancel-reset');
const confirmReset = element<HTMLButtonElement>('confirm-reset');
const gameHud = element<HTMLElement>('game-hud');
const online = element<HTMLElement>('players-online');
const health = element<HTMLElement>('hero-health');
const healthMeter = element<HTMLMeterElement>('health-meter');
const equipment = { armor: element('hero-armor'), weapon: element('hero-weapon') };
const lootNotice = element<HTMLOutputElement>('loot-notice');
const reviveButton = element<HTMLButtonElement>('revive-button');
const chatForm = element<HTMLFormElement>('chat-form');
const chatMessage = element<HTMLInputElement>('chat-message');
const status = element<HTMLElement>('status');
const helpPanel = element<HTMLDetailsElement>('help-panel');
const soundButton = element<HTMLButtonElement>('sound-button');
const achievementNotice = element('achievement-notice');

let playerId: number | undefined;
let resetId: string | undefined;
let showHelpOnEntry = false;
let achievements: Achievements;
playButton.disabled = true;

function showCharacterForm() {
  const saved = savedCharacter();
  characterName.readOnly = saved !== null;
  if (saved) characterName.value = saved.name;
  playButton.textContent = saved ? 'Continue' : 'Play';
  resetButton.hidden = !saved;
  return saved;
}

const world = new WorldScene(
  () => {
    const catalog = world.cache.json.get('db');
    const instructions = [catalog.texts.help_move, catalog.texts.help_chat, catalog.texts.help_save];
    for (const text of instructions) {
      const line = document.createElement('li');
      line.textContent = text;
      element('help-text').append(line);
    }
    achievements = new Achievements(catalog.achievements, element('achievements-list'), element('achievements-count'), name => {
      const line = document.createElement('p');
      line.textContent = `Achievement unlocked: ${name}`;
      achievementNotice.append(line);
      window.setTimeout(() => line.remove(), 5000);
      world.playSound('achievement');
    });
    playButton.disabled = false;
    resetButton.disabled = false;
  },
  (path, orientation, action) => connection.move(path, orientation, action),
  (alive) => {
    reviveButton.disabled = false;
    if (reviveButton.hidden === alive) return;
    reviveButton.hidden = alive;
    showHealth(alive ? 100 : 0);
  },
  (slot, key) => {
    localStorage.setItem(slot, key);
    equipment[slot].textContent = key.replace(/(.)(armor|sword|\d+)$/, '$1 $2')
      .replace(/\b\w/g, letter => letter.toUpperCase());
  },
  () => achievements.unlock(3),
  tile => achievements.visit(tile),
);

function showHealth(life: number) {
  health.textContent = String(life);
  healthMeter.value = life;
}

function setStatus(message: string) {
  status.textContent = message;
  // The forms and status can move the canvas without resizing it.
  world.scale.updateBounds();
}

const connection = createConnection({
  enter(player, door) {
    playerId = player.id;
    world.enter(player, door);
    characterForm.hidden = true;
    gameHud.hidden = false;
    achievements.render();
    achievementNotice.replaceChildren();
    helpPanel.open = showHelpOnEntry;
    showHelpOnEntry = false;
    showHealth(player.alive === false ? 0 : 100);
    lootNotice.value = '';
    lootNotice.hidden = true;
    setStatus('');
  },
  updateWorld: update => world.applyWorld(update),
  updateSelf(update) {
    world.applySelf(update);
    if (update.life !== undefined) showHealth(update.life);
    const notices: string[] = [];
    for (const id of update.killed ?? []) {
      const monster = world.monsterInfo(id);
      if (!monster) continue;
      notices.push(`You killed a ${monster.name}!`);
      achievements.recordKill(id, monster.achievement);
    }
    for (const id of update.used ?? []) {
      const item = world.itemInfo(id);
      if (item?.msg) notices.push(item.msg);
      if (item?.type === 1) achievements.unlock(0);
      if (item?.type === 2) achievements.unlock(4);
    }
    if (update.noPick) {
      notices.push('You already have better equipment!');
      world.playSound('noloot');
    }
    if (notices.length) {
      lootNotice.hidden = false;
      lootNotice.value = notices.join(' ');
    }
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
    resetButton.disabled = false;
    setStatus(message);
  },
});

showCharacterForm();
resetButton.addEventListener('click', () => {
  const saved = showCharacterForm();
  if (!saved) return;
  resetId = saved.id;
  element('reset-warning').textContent = `Delete ${saved.name} and all their progress? This cannot be undone.`;
  resetStatus.textContent = '';
  resetButton.disabled = true;
  resetDialog.showModal();
});
cancelReset.addEventListener('click', () => resetDialog.close());
resetDialog.addEventListener('cancel', event => {
  if (confirmReset.disabled) event.preventDefault();
});
resetDialog.addEventListener('close', () => {
  resetButton.disabled = false;
  if (resetButton.hidden) characterName.focus();
  else resetButton.focus();
});
confirmReset.addEventListener('click', async () => {
  if (!resetId || confirmReset.disabled) return;
  confirmReset.disabled = true;
  cancelReset.disabled = true;
  resetStatus.textContent = 'Deleting character…';
  const deleted = await connection.deleteCharacter(resetId);
  confirmReset.disabled = false;
  cancelReset.disabled = false;
  if (!deleted) {
    resetStatus.textContent = 'Deletion could not be confirmed. Your local save is intact. Try again.';
    confirmReset.focus();
    return;
  }
  characterName.value = '';
  showCharacterForm();
  resetDialog.close();
  setStatus('Character deleted.');
});
soundButton.addEventListener('click', () => {
  const mute = soundButton.getAttribute('aria-pressed') === 'true';
  world.sound.mute = mute;
  soundButton.textContent = mute ? 'Sound off' : 'Sound on';
  soundButton.setAttribute('aria-pressed', String(!mute));
});
reviveButton.addEventListener('click', () => {
  if (!reviveButton.hidden && connection.revive()) reviveButton.disabled = true;
});
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
  resetButton.disabled = true;
  showHelpOnEntry = !saved;
  setStatus('Connecting…');
  connection.play(saved ? undefined : name);
});

chatForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = chatMessage.value.trim();
  const sender = playerId;
  if (sender === undefined) return;
  if (!await connection.chat(text)) {
    chatMessage.setCustomValidity('Message not sent. Try again.');
    chatMessage.reportValidity();
    chatMessage.setCustomValidity('');
    return;
  }
  if (playerId === sender) world.say(sender, text);
  if (chatMessage.value.trim() === text) chatMessage.value = '';
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
