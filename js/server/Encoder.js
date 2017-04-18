/**
 * Created by Jerome on 13-01-17.
 */
const CoDec = require('../CoDec.js').CoDec;

// This class is used for the binary encoding of an update package
const Encoder = {};

Encoder.encode = function (obj, schema) { // Encode an object according to a specific schema
  const size = Encoder.computeSize(obj, schema); // Compute the number of bytes needed to encode the object according to the provided schema, so that a buffer of the appropate size can be created
    // console.log('allocating '+size+' bytes for object');
  const encodeResult = Encoder.encodeObject(obj, size, schema, null, 0); // Encode the object ; the last two parameters are used for recursive calls only
  return encodeResult.buffer; // Return the buffer of the encoded object
};

Encoder.computeSize = function (obj, schema) {
  let size = schema.propertiesBytes; // Allocate bytes for the header indicating the presence/absence of fields in the object

  if (schema.numerical) {
        // Count the bytes needed for numerical values
    Object.keys(schema.numerical).forEach((key) => {
      if (obj[key] !== undefined) size += schema.numerical[key]; // If the object to encode has that field, allocate the corresponding amount of bytes
    });
  }

  if (schema.strings) {
        // Count the bytes need for each string
    schema.strings.forEach((key) => {
      if (obj[key] !== undefined && obj[key] !== null) size += (obj[key].length * CoDec.bytesPerChar) + 1; // bytesPerChar bytes per character + 1 byte to indicate the length of the string
    });
  }

  if (schema.arrays) {
        // Iterate over all lists of objetcs
    Object.keys(schema.arrays).forEach((arrayOfObjects) => {
            // For each list, iterate over the its content
      if (obj[arrayOfObjects] !== undefined) { // If the object to encode has the property
        size++;
        const sc = schema.arrays[arrayOfObjects];
        obj[arrayOfObjects].forEach((subObject) => {
          if (sc.primitive) {
            if (sc.type == 'int') size += sc.bytes;
          } else {
            size += Encoder.computeSize(subObject, sc); // Recursively compute the size for sub-objects to encode
          }
        });
      }
    });
  }

  if (schema.maps) {
    Object.keys(schema.maps).forEach((map) => {
      if (obj[map] !== undefined) {
        size++; // One byte for number of objects
        Object.keys(obj[map]).forEach((subObjectKey) => {
          size += CoDec.bytesPerID;
          size += Encoder.computeSize(obj[map][subObjectKey], schema.maps[map]); // Recursively compute the size for sub-objects to encode
        });
      }
    });
  }

  if (schema.standAlone) {
    Object.keys(schema.standAlone).forEach((objName) => {
      if (obj[objName] !== undefined) size += Encoder.computeSize(obj[objName], schema.standAlone[objName]);
    });
  }

  size += CoDec.booleanBytes;

  return size;
};

Encoder.encodeObject = function (obj, size, schema, buf, offset) {
  const buffer = (buf || new ArrayBuffer(size)); // If first call, create a new buffer ; if recursive call, use provided buffer
  const dv = new DataView(buffer);
  const headerOffset = offset; // Position where the header byte(s) will be written
  offset = Encoder.encodeBytes(dv, offset, schema.propertiesBytes, 0); // Temporary 0 value for header byte(s)
  let propertiesMask = 0; // Sequence of bits to indicate which fields of the schema are present in the object or not

  if (schema.numerical) {
    Object.keys(schema.numerical).forEach((key) => {
      if (obj[key] !== undefined) {
                // console.log("Encoding "+key+" at offset "+offset);
        offset = Encoder.encodeBytes(dv, offset, schema.numerical[key], obj[key]);
        propertiesMask |= 1; // Indicate in the mask that the field is present
      }
      propertiesMask <<= 1;
    });
  }

  if (schema.strings) {
    schema.strings.forEach((key) => {
      if (obj[key] !== undefined) {
        const length = obj[key].length;
                // console.log("Encoding length at offset "+offset);
        offset = Encoder.encodeBytes(dv, offset, 1, length);
                // console.log("Encoding "+key+" at offset "+offset);
        Encoder.encodeString(dv, offset, obj[key]);
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
        offset = Encoder.encodeBytes(dv, offset, 1, obj[arrayOfObjects].length); // Number of objects in the array (length of the array)
        propertiesMask |= 1;
        const sc = schema.arrays[arrayOfObjects];
        obj[arrayOfObjects].forEach((subObject) => {
                    // console.log("***Encoding "+arrayOfObjects+" element at offset "+offset);
          if (sc.primitive) {
            if (sc.type == 'int') offset = Encoder.encodeBytes(dv, offset, sc.bytes, subObject);
          } else {
            const res = Encoder.encodeObject(subObject, null, sc, buffer, offset);
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
        offset = Encoder.encodeBytes(dv, offset, 1, Object.keys(obj[map]).length); // Number of entries in the map
        propertiesMask |= 1;
        Object.keys(obj[map]).forEach((subObjectKey) => {
          offset = Encoder.encodeBytes(dv, offset, CoDec.bytesPerID, subObjectKey);
                    // console.log("***Encoding "+map+" element at offset "+offset);
          const res = Encoder.encodeObject(obj[map][subObjectKey], null, schema.maps[map], buffer, offset);
          offset = res.offset;
        });
      }
      propertiesMask <<= 1;
    });
  }

  if (schema.standAlone) {
    Object.keys(schema.standAlone).forEach((objName) => {
      if (obj[objName] !== undefined) {
        const res = Encoder.encodeObject(obj[objName], null, schema.standAlone[objName], buffer, offset);
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
        propertiesMask |= 1; // Indicate in the mast that the boolean is present
        bools |= +obj[key]; // Indicate its actual value
      }
      propertiesMask <<= 1;
      bools <<= 1;
    });
        // console.log("Encoding bool stuff at offset "+offset+" for size "+dv.byteLength);
    bools >>= 1;
    offset = Encoder.encodeBytes(dv, offset, CoDec.booleanBytes, bools);
  }
  propertiesMask >>= 1;
    // console.log(propertiesMask.toString(2));
  dv[`setUint${schema.propertiesBytes * 8}`](headerOffset, propertiesMask); // Write the header byte
  return { buffer, offset };
};

Encoder.encodeBytes = function (dv, offset, nbBytes, value) {
  dv[`setUint${nbBytes * 8}`](offset, value);
  offset += nbBytes;
  return offset;
};

Encoder.encodeString = function (dv, offset, str) {
  for (let i = 0, strLen = str.length; i < strLen; i++) {
        // console.log(str.charAt(i)+', '+str.charCodeAt(i));
    dv[`setUint${CoDec.bytesPerChar * 8}`](offset, str.charCodeAt(i));
    offset += CoDec.bytesPerChar;
  }
};

module.exports.Encoder = Encoder;
