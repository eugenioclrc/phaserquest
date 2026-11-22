/**
 * Created by Jerome on 13-01-17.
 */

import { CoDec, type ObjectSchema, type Packet } from '../shared/CoDec.ts';

const uintReaders = { 1: 'getUint8', 2: 'getUint16', 4: 'getUint32' } as const;

// This class is used to decode a binary encoded update package
const Decoder = {
  decode(data: ArrayBuffer, schema: ObjectSchema): Packet {
    // data is the binary object to decode
    // schema is the template of what to decode ; it indicates the names and
    // types of the fields of the object, allowing to guide the decoding
    const res = Decoder.decodeObject(data, 0, schema);
    return res.object;
  },
  countFields(schema: ObjectSchema) {
   // Returns the total number of fields in the schema (regardless of being
   // present in the object to decode or not)
   // This information is needed to properly read the properties mask, to know
   // by how much to shif it (see isMaskTrue() )
    let nbFields = 0;
    if (schema.numerical !== undefined) nbFields += Object.keys(schema.numerical).length;
   // fields that are arrays of objects
    if (schema.arrays !== undefined) nbFields += Object.keys(schema.arrays).length;
   // fields that are maps of id -> objects
    if (schema.maps !== undefined) nbFields += Object.keys(schema.maps).length;
   // fields that are standalone objects (not in array or map)
    if (schema.standAlone !== undefined) nbFields += Object.keys(schema.standAlone).length;
    if (schema.strings !== undefined) nbFields += schema.strings.length;
    if (schema.booleans !== undefined) nbFields += schema.booleans.length;
    return nbFields;
  },

  decodeObject(pkg: ArrayBuffer, _offset: number, schema: ObjectSchema): { object: Packet; offset: number } {
      // pkg is the binary package to decode
      // offset is the offset, in bytes, at which the decoding has to start
      // (recursive calls of decodeObject() work on the same bit sequence, but
      // at different offsets)
      // on the first call the offset starts at 0, and is incremented each type
      // bytes are read schema is the template to use for the decoding
    const dv = new DataView(pkg);
    const object: Packet = {};
    let offset = _offset;

      /*
       * Read order :
       * - The mask that indicates what fields from the schema are present in the object
       * - The numerical fields
       * - The length of the string fields and the fields themselves
       * - The length of arrays of sub-objects and the arrays themselves
       * - The standalones
       * - The booleans
       * */

      /* Recursive calls are used to decode nested objects ; they keep reading
      the same buffer at a different offset. No need to specify and end point,
      because the nested object
      will be parsed according to the provided schema, thus only considering the
      relevan part of the rest of the buffer and effectively returning one the schema
      is exhausted.
      */

    const nbProperties = Decoder.countFields(schema);
    // schema.propertiesBytes indicates how many bytes are required to make a
    // mask for all the possible properties of the schema
    // series of bits indicating the presence or absence of each field of the schema
    const propertiesMask = dv[uintReaders[schema.propertiesBytes]](offset);
    offset += schema.propertiesBytes;
    // index of the next field that will be checked, use to shift the properties
    // mask correctly in isMaskTrue()
    let idx = 1;

    if (schema.numerical) {
      Object.entries(schema.numerical).forEach(([key, nbBytes]) => {
        // check the properties mask to see if the field is present in the
        // object or not, and therefore has to be decoded or skipped
        if (Decoder.isMaskTrue(propertiesMask, nbProperties, idx)) {
          // calls e.g. dv.getUint8, dv.getUint16 ... depending on how many bytes
          // are indicated as necessary for the given field in the schema
          object[key] = dv[uintReaders[nbBytes]](offset);
          offset += nbBytes;
        }
        idx += 1;
      });
    }

    if (schema.strings) {
      schema.strings.forEach((key) => {
        if (Decoder.isMaskTrue(propertiesMask, nbProperties, idx)) {
          // Same process as for the numerical fields, but need to decode one
          // additional byte to know the length of each string
          const length = dv.getUint8(offset);
          offset += 1;
          // console.log("Decoding "+key+" at offset "+offset);
          object[key] = Decoder.decodeString(dv, length, offset);
          // CoDec.bytesPerChar indicates how many bytes should be allocated to
          // encode one character in a string
          offset += (length * CoDec.bytesPerChar);
        }
        idx += 1;
      });
    }

    if (schema.arrays) {
          // Iterate over all lists of objetcs
      Object.entries(schema.arrays).forEach(([arrayOfObjects, sc]) => {
        // For each list, iterate over the its content
        if (Decoder.isMaskTrue(propertiesMask, nbProperties, idx)) {
          // Number of objects in the array (length of the array)
          const length = dv.getUint8(offset);
          offset += 1;
          if (length) {
            const items: (Packet | number)[] = [];
            object[arrayOfObjects] = items;
            for (let i = 0; i < length; i += 1) {
              // console.log("Decoding "+arrayOfObjects+" element at offset "+offset);
              // is the object a "primitive" one (primitive flag set to true),
              // decode it as the corresponding type, only ints covered here
              if (sc.primitive) {
                items.push(dv[uintReaders[sc.bytes]](offset));
                offset += sc.bytes;
              } else {
                // otherwise, recursive call to decodeObject() to decode the
                // object in the list
                const res = Decoder.decodeObject(pkg, offset, sc);
                items.push(res.object);
                offset = res.offset;
              }
            }
          }
        }
        idx += 1;
      });
    }

    if (schema.maps) {
      Object.entries(schema.maps).forEach(([map, entrySchema]) => {
        if (Decoder.isMaskTrue(propertiesMask, nbProperties, idx)) {
          const length = dv.getUint8(offset); // Number of entries in the map
          offset += 1;
          if (length) {
            const entries: Record<number, Packet> = {};
            object[map] = entries;
            for (let i = 0; i < length; i += 1) {
              // ID of the entry (= key)
              const id = dv[uintReaders[CoDec.bytesPerID]](offset);
              offset += CoDec.bytesPerID;
              // console.log("Decoding "+map+" element at offset "+offset);
              const res = Decoder.decodeObject(pkg, offset, entrySchema);
              entries[id] = res.object;
              offset = res.offset;
            }
          }
        }
        idx += 1;
      });
    }

    if (schema.standAlone) {
      Object.entries(schema.standAlone).forEach(([objName, objectSchema]) => {
        if (Decoder.isMaskTrue(propertiesMask, nbProperties, idx)) {
          // console.log('Decoding '+objName+' at offset '+offset);
          const res = Decoder.decodeObject(pkg, offset, objectSchema);
          object[objName] = res.object;
          offset = res.offset;
        }
        idx += 1;
      });
    }

    const { booleans } = schema;
    if (booleans) {
      // console.log('Decoding bools at offset '+offset);
      // just like propertiesMask, bools is a mask indicating the presence/absence of each boolean
      const bools = dv[uintReaders[CoDec.booleanBytes]](offset);
      let boolidx = 1; // index of the next boolean to decode
      offset += CoDec.booleanBytes;
      booleans.forEach((key) => {
        if (Decoder.isMaskTrue(propertiesMask, nbProperties, idx)) {
          // !! converts to boolean
          object[key] = !!Decoder.isMaskTrue(bools, booleans.length, boolidx);
        }
        idx += 1;
        boolidx += 1;
      });
    }
    return { object, offset };
  },

  // Process a bitmask to know if a specific field, at index idx, is present or not
  isMaskTrue(mask: number, nbProperties: number, idx: number) {
    // Shift right to put the target at position 0, and AND it with 1
    /* eslint-disable */
    return (mask >> (nbProperties - idx)) & 1;
    /* eslint-enable */
  },

  // Read length bytes starting at a specific offset to decode a string
  decodeString(view: DataView, length: number, _offset: number) {
    let offset = _offset;
    const chars = [];
    for (let i = 0; i < length; i += 1) {
      chars.push(String.fromCharCode(view[uintReaders[CoDec.bytesPerChar]](offset)));
      offset += CoDec.bytesPerChar;
    }
    return chars.join('');
  },
};

export default Decoder;
