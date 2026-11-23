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
const entryScreen = element('entry-screen');
const characterName = element<HTMLInputElement>('character-name');
const playButton = element<HTMLButtonElement>('play-button');
const resetButton = element<HTMLButtonElement>('reset-button');
const resetDialog = element<HTMLDialogElement>('reset-dialog');
const resetStatus = element('reset-status');
const cancelReset = element<HTMLButtonElement>('cancel-reset');
const confirmReset = element<HTMLButtonElement>('confirm-reset');
const gamePage = element('game-page');
const gameSurface = element('phaser4-game');
const gameHud = element<HTMLElement>('game-hud');
const online = element<HTMLElement>('players-online');
const health = element<HTMLElement>('hero-health');
const healthMeter = element<HTMLMeterElement>('health-meter');
const equipment = {
  armor: { name: element('hero-armor'), icon: element<HTMLImageElement>('hero-armor-icon') },
  weapon: { name: element('hero-weapon'), icon: element<HTMLImageElement>('hero-weapon-icon') },
};
const movementNotice = element('movement-notice');
const lootNotice = element<HTMLOutputElement>('loot-notice');
const reviveButton = element<HTMLButtonElement>('revive-button');
const chatButton = element<HTMLButtonElement>('chat-button');
const chatForm = element<HTMLFormElement>('chat-form');
const chatMessage = element<HTMLInputElement>('chat-message');
const status = element<HTMLElement>('status');
const sessionMenu = element<HTMLDetailsElement>('session-menu');
const menuButton = element('menu-button');
const soundButton = element<HTMLButtonElement>('sound-button');
const achievementNotice = element('achievement-notice');

const viewport = window.visualViewport;
if (viewport) {
  const resizePage = () => {
    if (viewport.scale === 1) gamePage.style.setProperty('--viewport-height', `${viewport.height}px`);
  };
  viewport.addEventListener('resize', resizePage);
  resizePage();
}

let playerId: number | undefined;
let resetId: string | undefined;
let showMoveOnEntry = false;
let movementTimer: number | undefined;
let lootTimer: number | undefined;
let chatOpener: HTMLElement = chatButton;
let achievements: Achievements;

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
    const instructions = [
      catalog.texts.help_move,
      'Open Chat or press Enter to talk to nearby players.',
      catalog.texts.help_save,
    ];
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
    movementNotice.textContent = window.matchMedia('(pointer: coarse)').matches
      ? 'Tap a tile to walk.'
      : 'Click a tile to walk.';
    playButton.disabled = false;
    resetButton.disabled = false;
  },
  (path, orientation, action) => {
    const sent = connection.move(path, orientation, action);
    if (sent) movementNotice.hidden = true;
    return sent;
  },
  (alive) => {
    reviveButton.disabled = false;
    if (reviveButton.hidden === alive) return;
    reviveButton.hidden = alive;
    showHealth(alive ? 100 : 0);
  },
  (slot, key) => {
    localStorage.setItem(slot, key);
    const { name, icon } = equipment[slot];
    if (name.dataset.item === key) return;
    name.dataset.item = key;
    name.textContent = key.replace(/(.)(armor|sword|\d+)$/, '$1 $2')
      .replace(/\b\w/g, letter => letter.toUpperCase());
    icon.title = name.textContent;
    const iconKey = world.cache.json.get('db').items[key]?.icon;
    const frame = `${iconKey}_0`;
    const source = iconKey && world.textures.get('players').has(frame)
      ? world.textures.getBase64('players', frame)
      : '';
    icon.hidden = !source;
    if (source) icon.src = source;
    else icon.removeAttribute('src');
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
}

function setChatOpen(open: boolean, opener: HTMLElement = chatButton) {
  if (chatForm.hidden === !open) return;
  chatForm.hidden = !open;
  chatButton.setAttribute('aria-expanded', String(open));
  if (open) {
    chatOpener = opener;
    sessionMenu.open = false;
    chatMessage.focus();
  }
}

const connection = createConnection({
  enter(player, door) {
    const firstEntry = gameHud.hidden;
    playerId = player.id;
    world.enter(player, door);
    entryScreen.hidden = true;
    gameSurface.inert = false;
    gameHud.hidden = false;
    if (firstEntry) gameSurface.focus();
    achievements.render();
    achievementNotice.replaceChildren();
    window.clearTimeout(movementTimer);
    movementNotice.hidden = !showMoveOnEntry;
    if (showMoveOnEntry) {
      movementTimer = window.setTimeout(() => { movementNotice.hidden = true; }, 6500);
      showMoveOnEntry = false;
    }
    showHealth(player.alive === false ? 0 : 100);
    window.clearTimeout(lootTimer);
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
      lootNotice.value = notices.join(' ');
      lootNotice.hidden = false;
      window.clearTimeout(lootTimer);
      lootTimer = window.setTimeout(() => { lootNotice.hidden = true; }, 5000);
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
    sessionMenu.open = false;
    setChatOpen(false);
    gameHud.hidden = true;
    gameSurface.inert = true;
    entryScreen.hidden = false;
    showCharacterForm();
    playButton.disabled = false;
    resetButton.disabled = false;
    setStatus(message);
    playButton.focus();
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
  showMoveOnEntry = !saved;
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

chatButton.addEventListener('click', () => {
  setChatOpen(chatForm.hidden === true);
  if (chatForm.hidden) chatButton.focus();
});

sessionMenu.addEventListener('toggle', () => {
  if (sessionMenu.open) setChatOpen(false);
});

document.addEventListener('keydown', (event) => {
  if (gameHud.hidden || event.defaultPrevented || event.isComposing) return;
  if (event.key === 'Enter' &&
      (event.target === gameSurface || event.target === document.body || event.target instanceof HTMLCanvasElement)) {
    event.preventDefault();
    setChatOpen(true, gameSurface);
  } else if (event.key === 'Escape' && !chatForm.hidden) {
    event.preventDefault();
    setChatOpen(false);
    chatOpener.focus();
  } else if (event.key === 'Escape' && sessionMenu.open) {
    event.preventDefault();
    sessionMenu.open = false;
    menuButton.focus();
  }
});

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'phaser4-game',
  width: 980,
  height: 500,
  pixelArt: true,
  backgroundColor: '#1f1a13',
  input: { windowEvents: false },
  scale: { mode: Phaser.Scale.RESIZE },
  scene: world,
});
