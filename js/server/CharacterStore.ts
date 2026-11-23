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
  private readonly reservations = new Map<string, Promise<void> | null>();
  private readonly saves = new Map<string, Promise<boolean>>();

  constructor(private readonly collection: CharacterCollection) {}

  private reserve(id: string) {
    if (this.reservations.has(id)) throw new CharacterError('busy');
    this.reservations.set(id, null);
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
    const closing = this.reservations.get(id);
    if (closing) await closing;
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
        if (result.matchedCount !== 1) throw new Error('Character document was not found');
        return true;
      } catch (error) {
        console.error(`Could not save character ending in ${id.slice(-8)}.`, error);
        return false;
      }
    })();
    this.saves.set(id, pending);
    void pending.then(() => {
      if (this.saves.get(id) === pending) this.saves.delete(id);
    });
    return pending;
  }

  hasPendingSave(id: string) {
    return this.saves.has(id);
  }

  close(id: string, finalSave?: CharacterSave) {
    const pending = finalSave ? this.save(id, finalSave) : this.saves.get(id);
    const closing = Promise.resolve(pending).then(() => { this.reservations.delete(id); });
    this.reservations.set(id, closing);
    return closing;
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
