import assert from 'node:assert/strict';
import test from 'node:test';

import { createConversationStorage } from '../src/lib/conversationStorage.js';

test('conversation storage reads, writes, and clears only the opaque conversation id', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const conversationStorage = createConversationStorage(storage);

  assert.equal(conversationStorage.read(), null);
  conversationStorage.write('conversation-1');
  assert.equal(conversationStorage.read(), 'conversation-1');
  assert.deepEqual([...values.entries()], [['the-verifier-conversation-id', 'conversation-1']]);
  conversationStorage.clear();
  assert.equal(conversationStorage.read(), null);
});

test('conversation storage fails safely when sessionStorage is unavailable', () => {
  const storage = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
    removeItem() { throw new Error('blocked'); },
  };
  const conversationStorage = createConversationStorage(storage);

  assert.equal(conversationStorage.read(), null);
  assert.doesNotThrow(() => conversationStorage.write('conversation-1'));
  assert.doesNotThrow(() => conversationStorage.clear());
});
