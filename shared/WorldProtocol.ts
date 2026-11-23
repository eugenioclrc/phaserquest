export const maxClickDistance = 28;
export const maxPathLength = 60;
export const playerStepMs = 120;
export const chatCooldownMs = 1000;

export interface Tile {
  x: number;
  y: number;
}

export type PathAction = { action: 0 } | { action: 3; id: number } | { action: 4; x: number; y: number };

export interface PathCommand {
  path: Tile[];
  action: PathAction;
  or: number;
}

export interface MovementCorrection extends Tile {
  teleport?: true;
  route?: { path: Tile[]; orientation: number; elapsed?: number };
}

export const CharacterJoinError = {
  missing: 4404,
  busy: 4409,
  unavailable: 4503,
} as const;

export interface PlayerEvents {
  hp?: { hp: number; target: boolean; monsterId?: number }[];
  killed?: number[];
  used?: number[];
  noPick?: boolean;
}
