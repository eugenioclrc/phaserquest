/**
 * Created by Jerome on 13-01-17.
 */
const CoDec = require('../CoDec.js').CoDec;

// This class is used for the binary encoding of an update package

// Encode an object according to a specific schema
function encode(obj, schema) {
  // Compute the number of bytes needed to encode the object according to the
  // provided schema, so that a buffer of the appropate size can be created
  const size = computeSize(obj, schema);
  // Encode the object ; the last two parameters are used for recursive calls only
  const encodeResult = encodeObject(obj, size, schema, null, 0);
  // Return the buffer of the encoded object
  return encodeResult.buffer;
}

function computeSize(obj, schema) {
  // Allocate bytes for the header indicating the presence/absence of fields in the object
  let size = schema.propertiesBytes;

  if (schema.numerical) {
    // Count the bytes needed for numerical values
    Object.keys(schema.numerical).forEach((key) => {
      // If the object to encode has that field, allocate the corresponding amount of bytes
      if (obj[key] !== undefined) size += schema.numerical[key];
    });
  }

  if (schema.strings) {
        // Count the bytes need for each string
    schema.strings.forEach((key) => {
      // bytesPerChar bytes per character + 1 byte to indicate the length of the string
      if (obj[key] !== undefined && obj[key] !== null) {
        size += (obj[key].length * CoDec.bytesPerChar) + 1;
      }
    });
  }

  if (schema.arrays) {
        // Iterate over all lists of objetcs
    Object.keys(schema.arrays).forEach((arrayOfObjects) => {
      // For each list, iterate over the its content
      // If the object to encode has the property
      if (obj[arrayOfObjects] !== undefined) {
        size += 1;
        const sc = schema.arrays[arrayOfObjects];
        obj[arrayOfObjects].forEach((subObject) => {
          if (sc.primitive) {
            if (sc.type === 'int') {
              size += sc.bytes;
            }
          } else {
            // Recursively compute the size for sub-objects to encode
            size += computeSize(subObject, sc);
          }
        });
      }
    });
  }

  if (schema.maps) {
    Object.keys(schema.maps).forEach((map) => {
      if (obj[map] !== undefined) {
        size += 1; // One byte for number of objects
        Object.keys(obj[map]).forEach((subObjectKey) => {
          size += CoDec.bytesPerID;
          // Recursively compute the size for sub-objects to encode
          size += computeSize(obj[map][subObjectKey], schema.maps[map]);
        });
      }
    });
  }

  if (schema.standAlone) {
    Object.keys(schema.standAlone).forEach((objName) => {
      if (obj[objName] !== undefined) size += computeSize(obj[objName], schema.standAlone[objName]);
    });
  }

  size += CoDec.booleanBytes;

  return size;
}

function encodeObject(obj, size, schema, buf, offset) {
  // If first call, create a new buffer ; if recursive call, use provided buffer
  const buffer = (buf || new ArrayBuffer(size));
  const dv = new DataView(buffer);
  // Position where the header byte(s) will be written
  const headerOffset = offset;
  // Temporary 0 value for header byte(s)
  offset = encodeBytes(dv, offset, schema.propertiesBytes, 0);
  // Sequence of bits to indicate which fields of the schema are present in the object or not
  let propertiesMask = 0;

  if (schema.numerical) {
    Object.keys(schema.numerical).forEach((key) => {
      if (obj[key] !== undefined) {
        // console.log("Encoding "+key+" at offset "+offset);
        offset = encodeBytes(dv, offset, schema.numerical[key], obj[key]);
        // Indicate in the mask that the field is present
        propertiesMask |= 1;
      }
      propertiesMask <<= 1;
    });
  }

  if (schema.strings) {
    schema.strings.forEach((key) => {
      if (obj[key] !== undefined) {
        const length = obj[key].length;
        // console.log("Encoding length at offset "+offset);
        offset = encodeBytes(dv, offset, 1, length);
        // console.log("Encoding "+key+" at offset "+offset);
        encodeString(dv, offset, obj[key]);
        offset += (length * CoDec.bytesPerChar);
        propertiesMask |= 1;
      }
      propertiesMask <<= 1;
    });
  }

  if (schema.arrays) {
    // Iterate over all lists of objetcs
    Object.keys(schema.arrays).forEach((arrayOfObjects) => {
      // For each list, iterate over the its content
      if (obj[arrayOfObjects] !== undefined) {
        // Number of objects in the array (length of the array)
        offset = encodeBytes(dv, offset, 1, obj[arrayOfObjects].length);
        propertiesMask |= 1;
        const sc = schema.arrays[arrayOfObjects];
        obj[arrayOfObjects].forEach((subObject) => {
          // console.log("***Encoding "+arrayOfObjects+" element at offset "+offset);
          if (sc.primitive) {
            if (sc.type === 'int') {
              offset = encodeBytes(dv, offset, sc.bytes, subObject);
            }
          } else {
            const res = encodeObject(subObject, null, sc, buffer, offset);
            offset = res.offset;
          }
        });
      }
      propertiesMask <<= 1;
    });
  }

  if (schema.maps) {
    Object.keys(schema.maps).forEach((map) => {
      if (obj[map] !== undefined) {
        // Number of entries in the map
        offset = encodeBytes(dv, offset, 1, Object.keys(obj[map]).length);
        propertiesMask |= 1;
        Object.keys(obj[map]).forEach((subObjectKey) => {
          offset = encodeBytes(dv, offset, CoDec.bytesPerID, subObjectKey);
          // console.log("***Encoding "+map+" element at offset "+offset);
          const res = encodeObject(obj[map][subObjectKey], null, schema.maps[map], buffer, offset);
          offset = res.offset;
        });
      }
      propertiesMask <<= 1;
    });
  }

  if (schema.standAlone) {
    Object.keys(schema.standAlone).forEach((objName) => {
      if (obj[objName] !== undefined) {
        const res = encodeObject(obj[objName], null, schema.standAlone[objName], buffer, offset);
        offset = res.offset;
        propertiesMask |= 1;
      }
      propertiesMask <<= 1;
    });
  }

  if (schema.booleans) {
    let bools = 0;
    schema.booleans.forEach((key) => {
      if (obj[key] !== undefined) {
        // Indicate in the mast that the boolean is present
        propertiesMask |= 1;
        // Indicate its actual value
        bools |= +obj[key];
      }
      propertiesMask <<= 1;
      bools <<= 1;
    });
    // console.log("Encoding bool stuff at offset "+offset+" for size "+dv.byteLength);
    bools >>= 1;
    offset = encodeBytes(dv, offset, CoDec.booleanBytes, bools);
  }
  propertiesMask >>= 1;
  // console.log(propertiesMask.toString(2));
  // Write the header byte
  dv[`setUint${schema.propertiesBytes * 8}`](headerOffset, propertiesMask);
  return { buffer, offset };
}

function encodeBytes(dv, offset, nbBytes, value) {
  dv[`setUint${nbBytes * 8}`](offset, value);
  offset += nbBytes;
  return offset;
}

function encodeString(dv, offset, str) {
  for (let i = 0, strLen = str.length; i < strLen; i += 1) {
    // console.log(str.charAt(i)+', '+str.charCodeAt(i));
    dv[`setUint${CoDec.bytesPerChar * 8}`](offset, str.charCodeAt(i));
    offset += CoDec.bytesPerChar;
  }
}

module.exports = {
  encode,
  computeSize,
  encodeObject,
  encodeBytes,
  encodeString };
