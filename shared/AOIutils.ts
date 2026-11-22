const AOIutils = {
  tileWidth: 34,
  tileHeight: 20,
  nbAOIhorizontal: 0,
  lastAOIid: 0,
  idFromCoords(x: number, y: number): number {
    return Math.floor(x / AOIutils.tileWidth) + AOIutils.nbAOIhorizontal * Math.floor(y / AOIutils.tileHeight);
  },
  listAdjacentAOIs(current: number): number[] {
    const columns = AOIutils.nbAOIhorizontal;
    const col = current % columns;
    const row = Math.floor(current / columns);
    const nearby = [];
    for (let y = Math.max(0, row - 1); y <= row + 1; y++) {
      for (let x = Math.max(0, col - 1); x <= Math.min(columns - 1, col + 1); x++) {
        const id = y * columns + x;
        if (id < AOIutils.lastAOIid) nearby.push(id);
      }
    }
    return nearby;
  },
};

export { AOIutils };
