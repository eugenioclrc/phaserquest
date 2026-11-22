export type ByteWidth = 1 | 2 | 4;

type IntegerSchema = {
  primitive: true;
  type: 'int';
  bytes: ByteWidth;
};

export type ObjectSchema = {
  primitive?: never;
  propertiesBytes: ByteWidth;
  numerical?: Readonly<Record<string, ByteWidth>>;
  strings?: readonly string[];
  arrays?: Readonly<Record<string, ObjectSchema | IntegerSchema>>;
  maps?: Readonly<Record<string, ObjectSchema>>;
  standAlone?: Readonly<Record<string, ObjectSchema>>;
  booleans?: readonly string[];
};

export type PacketValue = number | string | boolean | null | Packet | (Packet | number)[];

export type Packet = { [field: string]: PacketValue | undefined };

// Widths in bytes for the protocol's shared field types.
const bytesPerChar = 1;
const bytesPerID = 2;
const booleanBytes = 1;
const stampBytes = 4;

const int16schema: IntegerSchema = {
  primitive: true,
  type: 'int',
  bytes: 2,
};

const tileSchema: ObjectSchema = {
  propertiesBytes: 1,
  numerical: {
    x: 2,
    y: 2,
  },
};

const playerRouteSchema: ObjectSchema = {
  propertiesBytes: 1,
  numerical: {
    orientation: 1,
    delta: 2,
  },
  standAlone: {
    end: tileSchema,
  },
};

const monsterRouteSchema: ObjectSchema = {
  propertiesBytes: 1,
  numerical: {
    delta: 2,
  },
  arrays: {
    path: tileSchema,
  },
};

const playerSchema: ObjectSchema = {
  propertiesBytes: 2,
  numerical: {
    id: bytesPerID,
    x: 2,
    y: 2,
    weapon: 1,
    armor: 1,
    aoi: 2,
    targetID: bytesPerID,
  },
  strings: ['name'],
  booleans: ['inFight', 'alive'],
  standAlone: {
    route: playerRouteSchema,
  },
};

const itemSchema: ObjectSchema = {
  propertiesBytes: 2,
  numerical: {
    id: bytesPerID,
    x: 2,
    y: 2,
    itemID: 1,
  },
  booleans: ['visible', 'respawn', 'chest', 'inChest', 'loot'],
};

const monsterSchema: ObjectSchema = {
  propertiesBytes: 2,
  numerical: {
    id: bytesPerID,
    x: 2,
    y: 2,
    targetID: bytesPerID,
    lastHitter: bytesPerID,
    monster: 1,
  },
  booleans: ['inFight', 'alive'],
  standAlone: {
    route: monsterRouteSchema,
  },
};
const globalUpdateSchema: ObjectSchema = {
  // How many bytes to use to indicate the presence/absence of fields in the
  // object; Limits the number of encodable fields to 8*propertiesBytes
  propertiesBytes: 1,
  arrays: {
    newplayers: playerSchema,
    newitems: itemSchema,
    newmonsters: monsterSchema,
    disconnected: int16schema,
  },
  maps: {
    players: playerSchema,
    monsters: monsterSchema,
    items: itemSchema,
  },
};

const hpSchema: ObjectSchema = {
  propertiesBytes: 1,
  numerical: {
    hp: 1,
    from: bytesPerID,
  },
  booleans: ['target'],
};

const localUpdateSchema: ObjectSchema = {
  propertiesBytes: 1,
  numerical: {
    life: 1,
    x: 2,
    y: 2,
  },
  booleans: ['noPick'],
  arrays: {
    hp: hpSchema,
    killed: int16schema,
    used: int16schema,
  },
};

const finalUpdateSchema: ObjectSchema = {
  propertiesBytes: 1,
  numerical: {
    latency: 2,
    stamp: stampBytes,
    nbconnected: 1,
  },
  standAlone: {
    global: globalUpdateSchema,
    local: localUpdateSchema,
  },
};

const initializationSchema: ObjectSchema = {
  propertiesBytes: 1,
  numerical: {
    stamp: stampBytes,
    nbconnected: 1,
    nbAOIhorizontal: 1,
    lastAOIid: 2,
  },
  standAlone: {
    player: playerSchema,
  },
};

export const CoDec = {
  bytesPerChar,
  bytesPerID,
  booleanBytes,
  stampBytes,
  int16schema,
  tileSchema,
  playerRouteSchema,
  monsterRouteSchema,
  playerSchema,
  itemSchema,
  monsterSchema,
  globalUpdateSchema,
  hpSchema,
  localUpdateSchema,
  finalUpdateSchema,
  initializationSchema,
} as const;
