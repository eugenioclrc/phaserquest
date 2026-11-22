import mongo = require('mongodb');
import type { CharacterDocument, CharacterSave } from './WorldTypes.ts';

const { ObjectId } = mongo;

type CharacterErrorCode = 'missing' | 'busy' | 'unavailable';
type CharacterFilter = { _id: mongo.ObjectId };

interface CharacterCollection {
  findOne(filter: CharacterFilter): Promise<CharacterDocument | null>;
  findOneAndUpdate(
    filter: CharacterFilter,
    update: { $setOnInsert: CharacterSave & CharacterFilter },
    options: { upsert: true; returnDocument: 'after' },
  ): Promise<CharacterDocument | null>;
  updateOne(filter: CharacterFilter, update: { $set: CharacterSave }): Promise<{ matchedCount: number }>;
  deleteOne(filter: CharacterFilter): Promise<{ acknowledged: boolean }>;
}

class CharacterError extends Error {
  constructor(readonly code: CharacterErrorCode, cause?: unknown) {
    super(code, { cause });
  }
}

function characterId(value: unknown) {
  if (typeof value !== 'string' || !/^[\da-f]{24}$/i.test(value)) throw new CharacterError('missing');
  return value.toLowerCase();
}

class CharacterStore {
  private readonly reservations = new Set<string>();
  private readonly saves = new Map<string, Promise<boolean>>();

  constructor(private readonly collection: CharacterCollection) {}

  private reserve(id: string) {
    if (this.reservations.has(id)) throw new CharacterError('busy');
    this.reservations.add(id);
  }

  async create(value: unknown, save: CharacterSave) {
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

  async open(value: unknown) {
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

  save(id: string, save: CharacterSave) {
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

  async close(id: string) {
    await this.saves.get(id);
    this.reservations.delete(id);
  }

  async delete(value: unknown) {
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

export = { CharacterStore, CharacterError, characterId };
