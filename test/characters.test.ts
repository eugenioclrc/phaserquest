import { expect, spyOn, test } from 'bun:test';
import { ObjectId } from 'mongodb';
import { CharacterStore } from '../js/server/CharacterStore.ts';
import { characterCollection } from './character-collection.ts';

const id = 'abc123000000000000000001';
const scout = { _id: new ObjectId(id), name: 'Scout', x: 40, y: 80, weapon: 'sword1', armor: 'clotharmor' };
const { _id, ...save } = scout;

test('reserves a legacy character during load and until pending saves complete', async () => {
  const load = Promise.withResolvers<typeof scout>();
  const write = Promise.withResolvers<{ matchedCount: number }>();
  const store = new CharacterStore(characterCollection({
    findOne: () => load.promise,
    updateOne: () => write.promise,
    deleteOne: async () => ({ acknowledged: true }),
  }));

  const opening = store.open(id);
  await expect(store.open(id.toUpperCase())).rejects.toMatchObject({ code: 'busy' });
  await expect(store.delete(id)).rejects.toMatchObject({ code: 'busy' });
  load.resolve(scout);
  expect(await opening).toEqual(scout);

  const saving = store.save(id, { ...save, x: 50 });
  const closing = store.close(id);
  const reopening = store.open(id);
  const duplicate = store.open(id).catch(error => error);
  await expect(store.delete(id)).rejects.toMatchObject({ code: 'busy' });
  write.resolve({ matchedCount: 1 });
  expect(await saving).toBe(true);
  await closing;
  expect(await reopening).toEqual(scout);
  expect(await duplicate).toMatchObject({ code: 'busy' });
  await store.close(id);
  expect(await store.delete(id)).toBe(true);
});

test('retries creation with the same ID and distinguishes unavailable from missing', async () => {
  let document: typeof scout | null = null;
  let unavailable = false;
  const store = new CharacterStore(characterCollection({
    findOneAndUpdate: async (_filter: unknown, update: { $setOnInsert: typeof scout }) => document ??= update.$setOnInsert,
    findOne: async () => {
      if (unavailable) throw Error('database offline');
      return document;
    },
    deleteOne: async () => {
      document = null;
      return { acknowledged: true };
    },
  }));
  expect(await store.create(id, save)).toBe(id);
  expect(await store.create(id, { ...save, x: 30 })).toBe(id);
  expect(document as typeof scout | null).toEqual(scout);
  await expect(store.create(id, { ...save, name: 'Other' })).rejects.toMatchObject({ code: 'busy' });
  expect(await store.delete(id)).toBe(true);
  expect(await store.delete(id)).toBe(true);
  await expect(store.open(id)).rejects.toMatchObject({ code: 'missing' });
  unavailable = true;
  await expect(store.open(id)).rejects.toMatchObject({ code: 'unavailable' });
  await expect(store.open('invalid')).rejects.toMatchObject({ code: 'missing' });
});

test('a failed final write releases the character and logs the cause', async () => {
  const failure = new Error('MongoDB socket timed out');
  const store = new CharacterStore(characterCollection({
    findOne: async () => scout,
    updateOne: async () => { throw failure; },
  }));
  const log = spyOn(console, 'error').mockImplementation(() => {});
  try {
    await store.open(id);
    const closing = store.close(id, save);
    expect(await store.open(id)).toEqual(scout);
    await closing;
    expect(log).toHaveBeenCalledWith(`Could not save character ending in ${id.slice(-8)}.`, failure);
  } finally {
    log.mockRestore();
    await store.close(id);
  }
});
