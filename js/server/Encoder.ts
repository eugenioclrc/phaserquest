/**
 * Created by Jerome on 13-01-17.
 */
import { CoDec, type ByteWidth, type ObjectSchema, type Packet } from '../../shared/CoDec.ts';

const unsignedSetters = { 1: 'setUint8', 2: 'setUint16', 4: 'setUint32' } as const;

// This class is used for the binary encoding of an update package

// Encode an object according to a specific schema
function encode(obj: Packet, schema: ObjectSchema): ArrayBuffer {
  // Compute the number of bytes needed to encode the object according to the
  // provided schema, so that a buffer of the appropate size can be created
  const size = computeSize(obj, schema);
  // Encode the object ; the last two parameters are used for recursive calls only
  const encodeResult = encodeObject(obj, size, schema, null, 0);
  // Return the buffer of the encoded object
  return encodeResult.buffer;
}

function computeSize(obj: Packet, schema: ObjectSchema): number {
  // Allocate bytes for the header indicating the presence/absence of fields in the object
  let size = schema.propertiesBytes;

  if (schema.numerical) {
    // Count the bytes needed for numerical values
    for (const [key, width] of Object.entries(schema.numerical)) {
      // If the object to encode has that field, allocate the corresponding amount of bytes
      if (obj[key] !== undefined) size += width;
    }
  }

  if (schema.strings) {
        // Count the bytes need for each string
    for (const key of schema.strings) {
      // bytesPerChar bytes per character + 1 byte to indicate the length of the string
      const value = obj[key] as string | null | undefined;
      if (value !== undefined && value !== null) {
        size += (value.length * CoDec.bytesPerChar) + 1;
      }
    }
  }

  if (schema.arrays) {
        // Iterate over all lists of objetcs
    for (const [key, sc] of Object.entries(schema.arrays)) {
      // For each list, iterate over the its content
      // If the object to encode has the property
      const values = obj[key] as (Packet | number)[] | undefined;
      if (values !== undefined) {
        size += 1;
        values.forEach((subObject) => {
          if (sc.primitive) {
            if (sc.type === 'int') {
              size += sc.bytes;
            }
          } else {
            // Recursively compute the size for sub-objects to encode
            size += computeSize(subObject as Packet, sc);
          }
        });
      }
    }
  }

  if (schema.maps) {
    for (const [key, sc] of Object.entries(schema.maps)) {
      const values = obj[key] as Record<string, Packet> | undefined;
      if (values !== undefined) {
        size += 1; // One byte for number of objects
        for (const value of Object.values(values)) {
          size += CoDec.bytesPerID;
          // Recursively compute the size for sub-objects to encode
          size += computeSize(value, sc);
        }
      }
    }
  }

  if (schema.standAlone) {
    for (const [key, sc] of Object.entries(schema.standAlone)) {
      const value = obj[key] as Packet | undefined;
      if (value !== undefined) size += computeSize(value, sc);
    }
  }

  size += CoDec.booleanBytes;

  return size;
}

function encodeObject(
  obj: Packet,
  size: number | null,
  schema: ObjectSchema,
  buf: ArrayBuffer | null,
  offset: number,
): { buffer: ArrayBuffer; offset: number } {
  // If first call, create a new buffer ; if recursive call, use provided buffer
  const buffer = buf ?? new ArrayBuffer(size ?? 0);
  const dv = new DataView(buffer);
  // Position where the header byte(s) will be written
  const headerOffset = offset;
  // Temporary 0 value for header byte(s)
  offset = encodeBytes(dv, offset, schema.propertiesBytes, 0);
  // Sequence of bits to indicate which fields of the schema are present in the object or not
  let propertiesMask = 0;

  if (schema.numerical) {
    for (const [key, width] of Object.entries(schema.numerical)) {
      const value = obj[key] as number | undefined;
      if (value !== undefined) {
        // console.log("Encoding "+key+" at offset "+offset);
        offset = encodeBytes(dv, offset, width, value);
        // Indicate in the mask that the field is present
        propertiesMask |= 1;
      }
      propertiesMask <<= 1;
    }
  }

  if (schema.strings) {
    for (const key of schema.strings) {
      const value = obj[key] as string | undefined;
      if (value !== undefined) {
        const length = value.length;
        // console.log("Encoding length at offset "+offset);
        offset = encodeBytes(dv, offset, 1, length);
        // console.log("Encoding "+key+" at offset "+offset);
        encodeString(dv, offset, value);
        offset += (length * CoDec.bytesPerChar);
        propertiesMask |= 1;
      }
      propertiesMask <<= 1;
    }
  }

  if (schema.arrays) {
    // Iterate over all lists of objetcs
    for (const [key, sc] of Object.entries(schema.arrays)) {
      // For each list, iterate over the its content
      const values = obj[key] as (Packet | number)[] | undefined;
      if (values !== undefined) {
        // Number of objects in the array (length of the array)
        offset = encodeBytes(dv, offset, 1, values.length);
        propertiesMask |= 1;
        values.forEach((subObject) => {
          if (sc.primitive) {
            if (sc.type === 'int') {
              offset = encodeBytes(dv, offset, sc.bytes, subObject as number);
            }
          } else {
            const res = encodeObject(subObject as Packet, null, sc, buffer, offset);
            offset = res.offset;
          }
        });
      }
      propertiesMask <<= 1;
    }
  }

  if (schema.maps) {
    for (const [key, sc] of Object.entries(schema.maps)) {
      const values = obj[key] as Record<string, Packet> | undefined;
      if (values !== undefined) {
        // Number of entries in the map
        const entries = Object.entries(values);
        offset = encodeBytes(dv, offset, 1, entries.length);
        propertiesMask |= 1;
        for (const [id, value] of entries) {
          offset = encodeBytes(dv, offset, CoDec.bytesPerID, Number(id));
          const res = encodeObject(value, null, sc, buffer, offset);
          offset = res.offset;
        }
      }
      propertiesMask <<= 1;
    }
  }

  if (schema.standAlone) {
    for (const [key, sc] of Object.entries(schema.standAlone)) {
      const value = obj[key] as Packet | undefined;
      if (value !== undefined) {
        const res = encodeObject(value, null, sc, buffer, offset);
        offset = res.offset;
        propertiesMask |= 1;
      }
      propertiesMask <<= 1;
    }
  }

  if (schema.booleans) {
    let bools = 0;
    for (const key of schema.booleans) {
      const value = obj[key] as boolean | undefined;
      if (value !== undefined) {
        // Indicate in the mast that the boolean is present
        propertiesMask |= 1;
        // Indicate its actual value
        bools |= +value;
      }
      propertiesMask <<= 1;
      bools <<= 1;
    }
    // console.log("Encoding bool stuff at offset "+offset+" for size "+dv.byteLength);
    bools >>= 1;
    offset = encodeBytes(dv, offset, CoDec.booleanBytes, bools);
  }
  propertiesMask >>= 1;
  // console.log(propertiesMask.toString(2));
  // Write the header byte
  encodeBytes(dv, headerOffset, schema.propertiesBytes, propertiesMask);
  return { buffer, offset };
}

function encodeBytes(dv: DataView, offset: number, nbBytes: ByteWidth, value: number): number {
  dv[unsignedSetters[nbBytes]](offset, value);
  offset += nbBytes;
  return offset;
}

function encodeString(dv: DataView, offset: number, str: string): void {
  for (let i = 0, strLen = str.length; i < strLen; i += 1) {
    // console.log(str.charAt(i)+', '+str.charCodeAt(i));
    offset = encodeBytes(dv, offset, CoDec.bytesPerChar, str.charCodeAt(i));
  }
}

export { encode, computeSize, encodeObject, encodeBytes, encodeString };
