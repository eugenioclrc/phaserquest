/**
 * Created by Jerome on 21-01-17.
 */

const AOIutils = {
  nbAOIhorizontal: 0,
  lastAOIid: 0,
};


AOIutils.listAdjacentAOIs = function (current) {
  const AOIs = [];
  const isAtTop = (current < AOIutils.nbAOIhorizontal);
  const isAtBottom = (current > AOIutils.lastAOIid - AOIutils.nbAOIhorizontal);
  const isAtLeft = (current % AOIutils.nbAOIhorizontal == 0);
  const isAtRight = (current % AOIutils.nbAOIhorizontal == AOIutils.nbAOIhorizontal - 1);
  AOIs.push(current);
  if (!isAtTop) AOIs.push(current - AOIutils.nbAOIhorizontal);
  if (!isAtBottom) AOIs.push(current + AOIutils.nbAOIhorizontal);
  if (!isAtLeft) AOIs.push(current - 1);
  if (!isAtRight) AOIs.push(current + 1);
  if (!isAtTop && !isAtLeft) AOIs.push(current - 1 - AOIutils.nbAOIhorizontal);
  if (!isAtTop && !isAtRight) AOIs.push(current + 1 - AOIutils.nbAOIhorizontal);
  if (!isAtBottom && !isAtLeft) AOIs.push(current - 1 + AOIutils.nbAOIhorizontal);
  if (!isAtBottom && !isAtRight) AOIs.push(current + 1 + AOIutils.nbAOIhorizontal);
  return AOIs;
};

if (typeof window === 'undefined') module.exports.AOIutils = AOIutils;
