import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createConversationResponderFromEnvironment,
  createFixtureConversationResponder,
  createTrueForgeConversationResponder,
} from '../server/conversationResponder.js';

const resolvedFixture = {
  status: 'resolved',
  summary: 'Conflicting public sources were found.',
  findings: [
    {
      angle: 'current',
      sources: [{
        title: 'Starbucks names Brian Niccol as CEO',
        url: 'https://example.test/current',
        stance: 'supports',
      }],
    },
    {
      angle: 'contradiction',
      sources: [{
        title: 'Starbucks Q3 results',
        url: 'https://example.test/older',
        stance: 'contradicts',
      }],
    },
  ],
  resolution: {
    message: 'The August source is the newest strong signal.',
    evidence: [
      { title: 'Starbucks names Brian Niccol as CEO', field: 'datePublished', normalized: '2024-08-13T00:00:00.000Z' },
      { title: 'Starbucks Q3 results', field: 'datePublished', normalized: '2024-07-30T00:00:00.000Z' },
    ],
  },
};

test('fixture responder answers from active date evidence without rerunning research', async () => {
  const responder = createFixtureConversationResponder();

  const answer = await responder({
    message: 'Which source is newer and why?',
    messages: [],
    brief: 'Verify the Starbucks CEO.',
    result: resolvedFixture,
  });

  assert.match(answer.text, /Starbucks names Brian Niccol as CEO/);
  assert.match(answer.text, /2024-08-13T00:00:00.000Z/);
  assert.match(answer.text, /2024-07-30T00:00:00.000Z/);
  assert.equal(answer.requiresResearch, false);
});

test('fixture responder requests explicit research for fresh evidence', async () => {
  const responder = createFixtureConversationResponder();

  const answer = await responder({
    message: 'Search for the latest available evidence now.',
    messages: [],
    brief: 'Verify the Starbucks CEO.',
    result: resolvedFixture,
  });

  assert.equal(answer.requiresResearch, true);
  assert.match(answer.text, /Research again/);
});

test('live responder sends only the latest twelve messages and validates grounded JSON', async () => {
  let prompt;
  const responder = createTrueForgeConversationResponder({
    runner: {
      async run(input) {
        prompt = input.prompt;
        return { content: '{"text":"The August source is newer.","requiresResearch":false}' };
      },
    },
  });
  const messages = Array.from({ length: 14 }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'user',
    text: `message-${index}`,
  }));

  const answer = await responder({
    message: 'Explain the result.',
    messages,
    brief: 'Verify the Starbucks CEO.',
    result: resolvedFixture,
  });

  assert.deepEqual(answer, { text: 'The August source is newer.', requiresResearch: false });
  assert.doesNotMatch(prompt, /"message-0"/);
  assert.doesNotMatch(prompt, /"message-1"/);
  assert.match(prompt, /"message-2"/);
  assert.match(prompt, /Starbucks names Brian Niccol as CEO/);
});

test('live responder rejects invented source URLs', async () => {
  const responder = createTrueForgeConversationResponder({
    runner: {
      async run() {
        return { content: '{"text":"See https://invented.example/story","requiresResearch":false}' };
      },
    },
  });

  await assert.rejects(
    responder({ message: 'Sources?', messages: [], brief: 'Verify x', result: resolvedFixture }),
    /source URL outside the active evidence/,
  );
});

test('environment responder uses fixture mode without complete TrueForge configuration', async () => {
  const responder = createConversationResponderFromEnvironment({});
  const answer = await responder({ message: 'What is the conclusion?', messages: [], brief: 'x', result: resolvedFixture });
  assert.equal(answer.requiresResearch, false);
  assert.match(answer.text, /Conflicting public sources were found/);
});
