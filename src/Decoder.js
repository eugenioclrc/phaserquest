/**
 * Created by Jerome on 13-01-17.
 */

import CoDec from './CoDec';

// This class is used to decode a binary encoded update package
const Decoder = {
  decode(data, schema) {
    // data is the binary object to decode
    // schema is the template of what to decode ; it indicates the names and
    // types of the fields of the object, allowing to guide the decoding
    const res = Decoder.decodeObject(data, 0, schema);
    return res.object;
  },
  countFields(schema) {
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

  decodeObject(pkg, _offset, schema) {
      // pkg is the binary package to decode
      // offset is the offset, in bytes, at which the decoding has to start
      // (recursive calls of decodeObject() work on the same bit sequence, but
      // at different offsets)
      // on the first call the offset starts at 0, and is incremented each type
      // bytes are read schema is the template to use for the decoding
    const dv = new DataView(pkg);
    const object = {};
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
    const propertiesMask = dv[`getUint${schema.propertiesBytes * 8}`](offset);
    offset += schema.propertiesBytes;
    // index of the next field that will be checked, use to shift the properties
    // mask correctly in isMaskTrue()
    let idx = 1;

    if (schema.numerical) {
      Object.keys(schema.numerical).forEach((key) => {
        // check the properties mask to see if the field is present in the
        // object or not, and therefore has to be decoded or skipped
        if (Decoder.isMaskTrue(propertiesMask, nbProperties, idx)) {
          const nbBytes = schema.numerical[key];
          // calls e.g. dv.getUint8, dv.getUint16 ... depending on how many bytes
          // are indicated as necessary for the given field in the schema
          object[key] = dv[`getUint${nbBytes * 8}`](offset);
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
      Object.keys(schema.arrays).forEach((arrayOfObjects) => {
        // For each list, iterate over the its content
        if (Decoder.isMaskTrue(propertiesMask, nbProperties, idx)) {
          // Number of objects in the array (length of the array)
          const length = dv.getUint8(offset);
          offset += 1;
          if (length) {
            object[arrayOfObjects] = [];
            const sc = schema.arrays[arrayOfObjects]; // schema of the objects in the list
            for (let i = 0; i < length; i += 1) {
              // console.log("Decoding "+arrayOfObjects+" element at offset "+offset);
              let result;
              // is the object a "primitive" one (primitive flag set to true),
              // decode it as the corresponding type, only ints covered here
              if (sc.primitive) {
                if (sc.type === 'int') {
                  result = dv[`getUint${sc.bytes * 8}`](offset);
                  offset += sc.bytes;
                }
              } else {
                // otherwise, recursive call to decodeObject() to decode the
                // object in the list
                const res = Decoder.decodeObject(pkg, offset, sc);
                result = res.object;
                offset = res.offset;
              }
              object[arrayOfObjects].push(result);
            }
          }
        }
        idx += 1;
      });
    }

    if (schema.maps) {
      Object.keys(schema.maps).forEach((map) => {
        if (Decoder.isMaskTrue(propertiesMask, nbProperties, idx)) {
          const length = dv.getUint8(offset); // Number of entries in the map
          offset += 1;
          if (length) {
            object[map] = {};
            for (let i = 0; i < length; i += 1) {
              // ID of the entry (= key)
              const id = dv[`getUint${CoDec.bytesPerID * 8}`](offset);
              offset += CoDec.bytesPerID;
              // console.log("Decoding "+map+" element at offset "+offset);
              const res = Decoder.decodeObject(pkg, offset, schema.maps[map]);
              object[map][id] = res.object;
              offset = res.offset;
            }
          }
        }
        idx += 1;
      });
    }

    if (schema.standAlone) {
      Object.keys(schema.standAlone).forEach((objName) => {
        if (Decoder.isMaskTrue(propertiesMask, nbProperties, idx)) {
          // console.log('Decoding '+objName+' at offset '+offset);
          const res = Decoder.decodeObject(pkg, offset, schema.standAlone[objName]);
          object[objName] = res.object;
          offset = res.offset;
        }
        idx += 1;
      });
    }

    if (schema.booleans) {
      // console.log('Decoding bools at offset '+offset);
      // just like propertiesMask, bools is a mask indicating the presence/absence of each boolean
      const bools = dv[`getUint${CoDec.booleanBytes * 8}`](offset);
      let boolidx = 1; // index of the next boolean to decode
      offset += CoDec.booleanBytes;
      schema.booleans.forEach((key) => {
        if (Decoder.isMaskTrue(propertiesMask, nbProperties, idx)) {
          // !! converts to boolean
          object[key] = !!Decoder.isMaskTrue(bools, schema.booleans.length, boolidx);
        }
        idx += 1;
        boolidx += 1;
      });
    }
    return { object, offset };
  },

  // Process a bitmask to know if a specific field, at index idx, is present or not
  isMaskTrue(mask, nbProperties, idx) {
    // Shift right to put the target at position 0, and AND it with 1
    /* eslint-disable */
    return (mask >> (nbProperties - idx)) & 1;
    /* eslint-enable */
  },

  // Read length bytes starting at a specific offset to decode a string
  decodeString(view, length, _offset) {
    let offset = _offset;
    const chars = [];
    for (let i = 0; i < length; i += 1) {
      chars.push(String.fromCharCode(view[`getUint${CoDec.bytesPerChar * 8}`](offset)));
      offset += CoDec.bytesPerChar;
    }
    return chars.join('');
  },
};

export default Decoder;
