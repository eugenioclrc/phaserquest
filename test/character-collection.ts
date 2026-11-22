import store = require('../js/server/CharacterStore.ts');

type Collection = ConstructorParameters<typeof store.CharacterStore>[0];

export function characterCollection(overrides: Partial<Collection>): Collection {
  const unexpected = (): never => { throw new Error('Unexpected database operation'); };
  return { findOne: unexpected, findOneAndUpdate: unexpected, updateOne: unexpected, deleteOne: unexpected, ...overrides };
}
