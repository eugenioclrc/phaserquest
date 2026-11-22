const { ObjectId } = require('mongodb');

class CharacterError extends Error {
  constructor(code, cause) {
    super(code, { cause });
    this.code = code;
  }
}

function characterId(value) {
  if (typeof value !== 'string' || !/^[\da-f]{24}$/i.test(value)) throw new CharacterError('missing');
  return value.toLowerCase();
}

class CharacterStore {
  constructor(collection) {
    this.collection = collection;
    this.reservations = new Set();
    this.saves = new Map();
  }

  reserve(id) {
    if (this.reservations.has(id)) throw new CharacterError('busy');
    this.reservations.add(id);
  }

  async create(value, save) {
    const id = characterId(value);
    const _id = new ObjectId(id);
    let document;
    try {
      document = await this.collection.findOneAndUpdate(
        { _id }, { $setOnInsert: { ...save, _id } }, { upsert: true, returnDocument: 'after' },
      );
    } catch (error) {
      throw new CharacterError('unavailable', error);
    }
    if (document?.name !== save.name) throw new CharacterError('busy');
    return id;
  }

  async open(value) {
    const id = characterId(value);
    this.reserve(id);
    let document;
    try {
      document = await this.collection.findOne({ _id: new ObjectId(id) });
    } catch (error) {
      this.reservations.delete(id);
      throw new CharacterError('unavailable', error);
    }
    if (document) return document;
    this.reservations.delete(id);
    throw new CharacterError('missing');
  }

  save(id, save) {
    const previous = this.saves.get(id);
    const pending = (async () => {
      await previous;
      try {
        const result = await this.collection.updateOne({ _id: new ObjectId(id) }, { $set: save });
        return result.matchedCount === 1;
      } catch {
        console.error('Could not save character.');
        return false;
      }
    })();
    this.saves.set(id, pending);
    void pending.then(() => {
      if (this.saves.get(id) === pending) this.saves.delete(id);
    });
    return pending;
  }

  async close(id) {
    await this.saves.get(id);
    this.reservations.delete(id);
  }

  async delete(value) {
    const id = characterId(value);
    this.reserve(id);
    try {
      const result = await this.collection.deleteOne({ _id: new ObjectId(id) });
      if (result.acknowledged) return true;
      throw new Error('Deletion was not acknowledged');
    } catch (error) {
      throw new CharacterError('unavailable', error);
    } finally {
      this.reservations.delete(id);
    }
  }
}

module.exports = { CharacterStore, CharacterError, characterId };
