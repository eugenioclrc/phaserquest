import type { Tile } from './protocol.ts';

type Achievement = {
  name: string;
  desc: string;
  nb?: number;
  criterion?: 'in' | 'out';
  rect?: Tile & { w: number; h: number };
};

export class Achievements {
  constructor(
    private readonly entries: Record<number, Achievement>,
    private readonly list: HTMLElement,
    private readonly completed: HTMLElement,
    private readonly onUnlock: (name: string) => void,
  ) {}

  render() {
    let earned = 0;
    const rows = Object.entries(this.entries).map(([id, achievement]) => {
      const unlocked = Boolean(localStorage.getItem(`ach${id}`));
      if (unlocked) earned++;
      const row = document.createElement('li');
      const title = document.createElement('strong');
      title.textContent = achievement.name;
      row.append(title, ` — ${achievement.desc}${unlocked ? ' (completed)' : ''}`);
      return row;
    });
    this.list.replaceChildren(...rows);
    this.completed.textContent = `Completed ${earned}/${rows.length}`;
  }

  unlock(id: number) {
    if (localStorage.getItem(`ach${id}`)) return;
    localStorage.setItem(`ach${id}`, 'true');
    this.render();
    this.onUnlock(this.entries[id].name);
  }

  recordKill(id: number, achievement?: number) {
    const key = `killed_${id}`;
    const previous = Number(localStorage.getItem(key));
    const count = Number.isSafeInteger(previous) && previous >= 0 ? previous + 1 : 1;
    localStorage.setItem(key, String(count));
    const required = achievement === undefined ? undefined : this.entries[achievement]?.nb;
    if (achievement !== undefined && required !== undefined && count >= required) this.unlock(achievement);
  }

  visit({ x, y }: Tile) {
    for (const [id, { rect, criterion }] of Object.entries(this.entries)) {
      if (!rect) continue;
      const inside = x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
      if (inside === (criterion === 'in')) this.unlock(Number(id));
    }
  }
}
