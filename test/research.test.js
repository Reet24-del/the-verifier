import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import test from 'node:test';

import {
  createFixtureResearchAdapter,
  createResearchWorkflow,
  createTrueForgeResearchAdapter,
} from '../server/research.js';

async function startFakeTrueForge(t, respond) {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const body = raw ? JSON.parse(raw) : undefined;
    const record = { method: request.method, path: request.url, headers: request.headers, body };
    requests.push(record);
    const result = await respond(record, requests);
    response.writeHead(result.status ?? 200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(result.body));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const { port } = server.address();
  return { baseUrl: `http://127.0.0.1:${port}/api/v1`, requests };
}

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

test('TrueForge adapter follows the official HTTP envelopes through a done turn', async (t) => {
  const fake = await startFakeTrueForge(t, (request) => {
    if (request.method === 'POST' && request.path === '/api/v1/sessions') {
      return { body: { data: { id: 'session-123' } } };
    }
    if (request.method === 'POST' && request.path === '/api/v1/sessions/session-123/turns') {
      return { body: { data: { id: 'turn-456', state: { status: 'running', started_at: '2026-08-27T09:00:00Z' } } } };
    }
    return {
      body: {
        data: {
          id: 'turn-456',
          state: {
            status: 'done',
            completed_at: '2026-08-27T09:00:02Z',
            message: 'Research complete',
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
    };
  });
  const adapter = createTrueForgeResearchAdapter({
    baseUrl: fake.baseUrl,
    agentName: 'verifier-researcher',
    token: 'server-secret',
    pollIntervalMs: 0,
    timeoutMs: 1_000,
  });

  const result = await adapter.research({ angle: 'current', brief: 'Verify an example claim.' });

  assert.equal(result.angle, 'current');
  assert.equal(result.sources[0].url, 'https://example.test/current');
  assert.equal(fake.requests.length, 3);
  assert.equal(fake.requests[0].path, '/api/v1/sessions');
  assert.deepEqual(fake.requests[0].body, { agent: { name: 'verifier-researcher' } });
  assert.equal(fake.requests[0].headers.authorization, 'Bearer server-secret');
  assert.equal(fake.requests[1].path, '/api/v1/sessions/session-123/turns');
  const turnRequest = fake.requests[1].body;
  assert.equal(turnRequest.input.length, 1);
  assert.equal(turnRequest.input[0].type, 'user.message');
  assert.match(turnRequest.input[0].content, /Current Claim Finder/);
  assert.equal(turnRequest.stream, false);
  assert.equal(fake.requests[2].path, '/api/v1/sessions/session-123/turns/turn-456');
});

test('TrueForge adapter rejects error and cancelled terminal turn envelopes without fabricating sources', async (t) => {
  let terminalStatus = 'error';
  const fake = await startFakeTrueForge(t, (request) => {
    if (request.path === '/api/v1/sessions') return { body: { data: { id: 'session-123' } } };
    if (request.path.endsWith('/turns')) return { body: { data: { id: 'turn-456', state: { status: 'running' } } } };
    return {
      body: {
        data: {
          id: 'turn-456',
          state: {
            status: terminalStatus,
            completed_at: '2026-08-27T09:00:02Z',
            message: `${terminalStatus} by harness`,
          },
        },
      },
    };
  });
  const adapter = createTrueForgeResearchAdapter({
    baseUrl: fake.baseUrl,
    agentName: 'verifier-researcher',
    pollIntervalMs: 0,
    timeoutMs: 1_000,
  });

  await assert.rejects(
    adapter.research({ angle: 'contradiction', brief: 'Verify an example claim.' }),
    /TrueForge turn failed: error by harness/,
  );
  terminalStatus = 'cancelled';
  await assert.rejects(
    adapter.research({ angle: 'contradiction', brief: 'Verify an example claim.' }),
    /TrueForge turn failed: cancelled by harness/,
  );
});

test('TrueForge adapter requires a structured source result rather than inventing live findings', async (t) => {
  const fake = await startFakeTrueForge(t, (request) => {
    if (request.path === '/api/v1/sessions') return { body: { data: { id: 'session-123' } } };
    if (request.path.endsWith('/turns')) return { body: { data: { id: 'turn-456', state: { status: 'running' } } } };
    return {
      body: {
        data: {
          id: 'turn-456',
          state: { status: 'done', completed_at: '2026-08-27T09:00:02Z', message: 'No structured output', output: { content: 'No JSON here.' } },
        },
      },
    };
  });
  const adapter = createTrueForgeResearchAdapter({
    baseUrl: fake.baseUrl,
    agentName: 'verifier-researcher',
    pollIntervalMs: 0,
    timeoutMs: 1_000,
  });

  await assert.rejects(
    adapter.research({ angle: 'current', brief: 'Verify an example claim.' }),
    /structured JSON source result/,
  );
});
