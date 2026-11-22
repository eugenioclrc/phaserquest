const AOIutils = {
  tileWidth: 34,
  tileHeight: 20,
  nbAOIhorizontal: 0,
  lastAOIid: 0,
  idFromCoords(x: number, y: number): number {
    return Math.floor(x / AOIutils.tileWidth) + AOIutils.nbAOIhorizontal * Math.floor(y / AOIutils.tileHeight);
  },
  listAdjacentAOIs(current: number): number[] {
    const AOIs = [];
    const isAtTop = (current < AOIutils.nbAOIhorizontal);
    const isAtBottom = (current > AOIutils.lastAOIid - AOIutils.nbAOIhorizontal);
    const isAtLeft = (current % AOIutils.nbAOIhorizontal === 0);
    const isAtRight = (current % AOIutils.nbAOIhorizontal === AOIutils.nbAOIhorizontal - 1);
    AOIs.push(current);
    if (!isAtTop) AOIs.push(current - AOIutils.nbAOIhorizontal);
    if (!isAtBottom) AOIs.push(current + AOIutils.nbAOIhorizontal);
    if (!isAtLeft) AOIs.push(current - 1);
    if (!isAtRight) AOIs.push(current + 1);
    if (!isAtTop && !isAtLeft) AOIs.push(current - 1 - AOIutils.nbAOIhorizontal);
    if (!isAtTop && !isAtRight) AOIs.push((current + 1) - AOIutils.nbAOIhorizontal);
    if (!isAtBottom && !isAtLeft) AOIs.push((current - 1) + AOIutils.nbAOIhorizontal);
    if (!isAtBottom && !isAtRight) AOIs.push(current + 1 + AOIutils.nbAOIhorizontal);
    return AOIs;
  },
};

export { AOIutils };
