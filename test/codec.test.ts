import { expect, test } from 'bun:test';
import { CoDec } from '../shared/CoDec.ts';
import { encode } from '../js/server/Encoder.ts';
import Decoder from '../src/Decoder.ts';

test('the server and client preserve the binary init and world update protocol', () => {
  const initPacket = {
    stamp: 123456789,
    nbconnected: 1,
    nbAOIhorizontal: 6,
    lastAOIid: 96,
    player: { id: 513, x: 0, y: 0, aoi: 0, name: 'Scout', inFight: false, alive: true },
  };
  const updatePacket = {
    stamp: 123456789,
    latency: 0,
    nbconnected: 2,
    global: {
      newplayers: [{ id: 513, x: 40, y: 270, name: 'Scout', inFight: false, alive: true }],
      players: {
        257: { route: { orientation: 2, delta: 80, end: { x: 41, y: 270 } } },
      },
    },
    local: {
      life: 87,
      hp: [{ hp: 13, from: 513, target: false }],
      killed: [258],
    },
  };

  const encodedInit = encode(initPacket, CoDec.initializationSchema);
  expect(Buffer.from(encodedInit).toString('hex')).toBe('1f075bcd1501060060072b02010000000000000553636f75740100');
  expect(Decoder.decode(encodedInit, CoDec.initializationSchema)).toEqual(initPacket);

  const encodedUpdate = encode(updatePacket, CoDec.finalUpdateSchema);
  expect(Buffer.from(encodedUpdate).toString('hex')).toBe('1f0000075bcd15024401070b02010028010e0553636f757401010101000407020050030029010e004c5701070d0201000101020000000000');
  expect(Decoder.decode(encodedUpdate, CoDec.finalUpdateSchema)).toEqual(updatePacket);
});
