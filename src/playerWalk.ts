import { playerStepMs, type Tile } from '../shared/WorldProtocol.ts';

export type PlayerWalk = { path: Tile[]; startedAt: number };

export function walkProgress(walk: PlayerWalk, now: number) {
  return Math.min(walk.path.length - 1, Math.max(0, (now - walk.startedAt) / playerStepMs));
}

export function turnFrom(walk: PlayerWalk, now: number) {
  const progress = walkProgress(walk, now);
  const step = Math.floor(progress);
  const start = Math.round(progress);
  return {
    tile: walk.path[start],
    previous: start > step ? walk.path[step] : undefined,
    elapsed: (progress - step) * playerStepMs,
  };
}
