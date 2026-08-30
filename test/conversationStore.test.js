import assert from 'node:assert/strict';
import test from 'node:test';

import { createConversationStore } from '../server/conversationStore.js';

function sequentialIds() {
  let value = 0;
  return () => `id-${++value}`;
}

test('conversation store creates an initial user turn and redacts the approval token', () => {
  const store = createConversationStore({
    idFactory: sequentialIds(),
    now: () => '2026-08-30T12:00:00.000Z',
  });

  const conversation = store.create({ brief: '  Verify the Starbucks CEO.  ' });
  store.setActiveInvestigation(conversation.id, {
    sessionId: 'session-1',
    status: 'awaiting_approval',
    result: { status: 'resolved' },
    approvalToken: 'server-secret',
  });

  const publicConversation = store.publicView(conversation.id);
  assert.equal(publicConversation.messages[0].role, 'user');
  assert.equal(publicConversation.messages[0].kind, 'brief');
  assert.equal(publicConversation.messages[0].text, 'Verify the Starbucks CEO.');
  assert.equal(publicConversation.activeInvestigation.sessionId, 'session-1');
  assert.equal('approvalToken' in publicConversation.activeInvestigation, false);
  assert.equal(store.get(conversation.id).activeInvestigation.approvalToken, 'server-secret');
});

test('conversation store bounds history, rejects missing records, and invalidates pending approval', () => {
  const store = createConversationStore({ idFactory: sequentialIds(), maxMessages: 3 });
  const conversation = store.create({ brief: 'Original claim' });

  store.append(conversation.id, { role: 'assistant', text: 'Result', kind: 'result' });
  store.append(conversation.id, { role: 'user', text: 'Why?', kind: 'follow_up' });
  store.append(conversation.id, { role: 'assistant', text: 'Because of the dates.', kind: 'answer' });
  assert.deepEqual(store.get(conversation.id).messages.map((message) => message.text), [
    'Result',
    'Why?',
    'Because of the dates.',
  ]);

  store.setActiveInvestigation(conversation.id, {
    sessionId: 'session-1', status: 'awaiting_approval', approvalToken: 'pending-token',
  });
  store.invalidatePendingApproval(conversation.id);
  assert.equal(store.get(conversation.id).activeInvestigation.approvalToken, undefined);
  assert.equal(store.get(conversation.id).activeInvestigation.status, 'replaced');

  assert.throws(
    () => store.append('missing', { role: 'user', text: 'hello', kind: 'follow_up' }),
    /Conversation not found/,
  );
});

test('conversation store validates non-empty messages and supported roles', () => {
  const store = createConversationStore({ idFactory: sequentialIds() });
  const conversation = store.create({ brief: 'Verify a claim' });

  assert.throws(
    () => store.append(conversation.id, { role: 'user', text: '   ', kind: 'follow_up' }),
    /non-empty text/,
  );
  assert.throws(
    () => store.append(conversation.id, { role: 'system', text: 'hidden', kind: 'answer' }),
    /role must be user or assistant/,
  );
});
