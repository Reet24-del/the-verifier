import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createFixtureResearchAdapter,
  createResearchWorkflow,
  createTrueForgeResearchAdapter,
} from '../server/research.js';

test('fixture research returns two dated, opposing Starbucks source sets', async () => {
  const adapter = createFixtureResearchAdapter();

  const [current, contradiction] = await Promise.all([
    adapter.research({ angle: 'current', brief: 'Verify Brian Niccol is CEO of Starbucks.' }),
    adapter.research({ angle: 'contradiction', brief: 'Verify Brian Niccol is CEO of Starbucks.' }),
  ]);

  assert.equal(current.angle, 'current');
  assert.equal(current.sources[0].stance, 'supports');
  assert.match(current.sources[0].url, /^https:\/\/about\.starbucks\.com\//);
  assert.match(current.sources[0].html, /datePublished/);
  assert.equal(contradiction.angle, 'contradiction');
  assert.equal(contradiction.sources[0].stance, 'contradicts');
  assert.match(contradiction.sources[0].html, /datePublished/);
});

test('research workflow starts opposing research angles concurrently and resolves their date inputs', async () => {
  const calls = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const adapter = {
    async research({ angle }) {
      calls.push(angle);
      await gate;
      return {
        angle,
        sources: [{
          title: `${angle} source`,
          url: `https://example.test/${angle}`,
          claim: `${angle} claim`,
          stance: angle === 'current' ? 'supports' : 'contradicts',
          html: `<script type="application/ld+json">{"datePublished":"2026-08-2${angle === 'current' ? '5' : '4'}T00:00:00Z"}</script>`,
        }],
      };
    },
  };
  const workflow = createResearchWorkflow({ adapter });

  const pending = workflow({ brief: 'Verify a claim.' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls.sort(), ['contradiction', 'current']);
  release();
  const result = await pending;

  assert.equal(result.status, 'resolved');
  assert.equal(result.findings.length, 2);
  assert.equal(result.findings[0].sources[0].stance, 'supports');
  assert.equal(result.findings[1].sources[0].stance, 'contradicts');
  assert.equal(result.resolution.newest.url, 'https://example.test/current');
});

test('TrueForge adapter uses the documented session, turn, and polling API with server-only bearer auth', async () => {
  const requests = [];
  const responses = [
    { data: { id: 'session-123' } },
    { data: { id: 'turn-456', state: { status: 'running' } } },
    { data: { id: 'turn-456', state: { status: 'running' } } },
    {
      data: {
        id: 'turn-456',
        state: {
          status: 'completed',
          output: {
            content: JSON.stringify({
              sources: [{
                title: 'Example current source',
                url: 'https://example.test/current',
                claim: 'The claim is current.',
                stance: 'supports',
                html: '<script type="application/ld+json">{"datePublished":"2026-08-25T00:00:00Z"}</script>',
              }],
            }),
          },
        },
      },
    },
  ];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options });
    return new Response(JSON.stringify(responses.shift()), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const adapter = createTrueForgeResearchAdapter({
    baseUrl: 'http://trueforge.test/api/v1',
    agentName: 'verifier-researcher',
    token: 'server-secret',
    fetchImpl,
    pollIntervalMs: 0,
    timeoutMs: 1_000,
  });

  const result = await adapter.research({ angle: 'current', brief: 'Verify an example claim.' });

  assert.equal(result.angle, 'current');
  assert.equal(result.sources[0].url, 'https://example.test/current');
  assert.equal(requests.length, 4);
  assert.equal(requests[0].url, 'http://trueforge.test/api/v1/sessions');
  assert.deepEqual(JSON.parse(requests[0].options.body), { agent: { name: 'verifier-researcher' } });
  assert.equal(requests[0].options.headers.authorization, 'Bearer server-secret');
  assert.equal(requests[1].url, 'http://trueforge.test/api/v1/sessions/session-123/turns');
  const turnRequest = JSON.parse(requests[1].options.body);
  assert.equal(turnRequest.input.length, 1);
  assert.equal(turnRequest.input[0].type, 'user.message');
  assert.match(turnRequest.input[0].content, /Current Claim Finder/);
  assert.equal(turnRequest.stream, false);
  assert.equal(requests[2].url, 'http://trueforge.test/api/v1/sessions/session-123/turns/turn-456');
});

test('TrueForge adapter rejects a non-terminal error and never fabricates sources', async () => {
  const adapter = createTrueForgeResearchAdapter({
    baseUrl: 'http://trueforge.test/api/v1',
    agentName: 'verifier-researcher',
    pollIntervalMs: 0,
    timeoutMs: 1_000,
    fetchImpl: async (url) => new Response(JSON.stringify(
      url.endsWith('/sessions')
        ? { data: { id: 'session-123' } }
        : url.endsWith('/turns')
          ? { data: { id: 'turn-456', state: { status: 'running' } } }
          : { data: { id: 'turn-456', state: { status: 'failed', error: { message: 'research tool unavailable' } } } },
    ), { status: 200, headers: { 'content-type': 'application/json' } }),
  });

  await assert.rejects(
    adapter.research({ angle: 'contradiction', brief: 'Verify an example claim.' }),
    /TrueForge turn failed: research tool unavailable/,
  );
});

test('TrueForge adapter requires a structured source result rather than inventing live findings', async () => {
  const adapter = createTrueForgeResearchAdapter({
    baseUrl: 'http://trueforge.test/api/v1',
    agentName: 'verifier-researcher',
    pollIntervalMs: 0,
    timeoutMs: 1_000,
    fetchImpl: async (url) => new Response(JSON.stringify(
      url.endsWith('/sessions')
        ? { data: { id: 'session-123' } }
        : url.endsWith('/turns')
          ? { data: { id: 'turn-456', state: { status: 'running' } } }
          : { data: { id: 'turn-456', state: { status: 'completed', output: { content: 'No JSON here.' } } } },
    ), { status: 200, headers: { 'content-type': 'application/json' } }),
  });

  await assert.rejects(
    adapter.research({ angle: 'current', brief: 'Verify an example claim.' }),
    /structured JSON source result/,
  );
});
