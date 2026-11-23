import { AOIutils } from '../shared/AOIutils.ts';

export function cameraViewport(
  width: number,
  height: number,
  tileWidth: number,
  tileHeight: number,
  room?: { width: number; height: number },
) {
  // Leave room for sprite offsets and interpolation at an area boundary.
  const maxWidth = (AOIutils.tileWidth - 2) * tileWidth;
  const maxHeight = (AOIutils.tileHeight - 2) * tileHeight;
  const zoom = Math.max(1, width / maxWidth, height / maxHeight);
  const viewWidth = room ? Math.min(width, Math.floor(room.width * zoom)) : width;
  const viewHeight = room ? Math.min(height, Math.floor(room.height * zoom)) : height;
  return {
    x: Math.floor((width - viewWidth) / 2),
    y: Math.floor((height - viewHeight) / 2),
    width: viewWidth,
    height: viewHeight,
    zoom,
  };
}
