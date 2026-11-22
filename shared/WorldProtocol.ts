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
