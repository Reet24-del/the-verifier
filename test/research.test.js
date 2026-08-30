import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import test from 'node:test';

import {
  createFixtureResearchAdapter,
  createResearchWorkflow,
  createTrueForgeResearchAdapter,
  createTrueForgeTurnRunner,
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

test('research workflow can serialize live angles for rate-limited providers', async () => {
  const calls = [];
  let active = 0;
  let maxActive = 0;
  const adapter = {
    serialResearch: true,
    betweenAnglesMs: 0,
    async research({ angle }) {
      calls.push(angle);
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setImmediate(resolve));
      active -= 1;
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

  const result = await createResearchWorkflow({ adapter })({ brief: 'Verify a claim.' });

  assert.deepEqual(calls, ['current', 'contradiction']);
  assert.equal(maxActive, 1);
  assert.equal(result.status, 'resolved');
});

test('research workflow uses an adapter sandbox resolver when one is available', async () => {
  const sources = {
    current: {
      title: 'Current source',
      url: 'https://example.test/current',
      claim: 'Current claim',
      stance: 'supports',
      publishedAt: '2026-08-25T00:00:00Z',
    },
    contradiction: {
      title: 'Older source',
      url: 'https://example.test/older',
      claim: 'Older claim',
      stance: 'contradicts',
      publishedAt: '2026-08-24T00:00:00Z',
    },
  };
  let resolverInput;
  const adapter = {
    mode: 'trueforge',
    async research({ angle }) {
      return { angle, sources: [sources[angle]] };
    },
    async resolveMetadata(input) {
      resolverInput = input;
      return {
        resolution: {
          status: 'resolved',
          evidence: [],
          newest: { title: 'Current source', url: sources.current.url },
          message: 'Resolved inside the sandbox.',
        },
        sandboxExecution: { verified: true, sandboxId: 'sandbox-1', toolCallId: 'call-1' },
      };
    },
  };

  const result = await createResearchWorkflow({ adapter })({ brief: 'Verify a claim.' });

  assert.deepEqual(resolverInput.sources, [sources.current, sources.contradiction]);
  assert.equal(result.resolution.message, 'Resolved inside the sandbox.');
  assert.deepEqual(result.sandboxExecution, {
    verified: true,
    sandboxId: 'sandbox-1',
    toolCallId: 'call-1',
  });
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

test('reusable TrueForge turn runner returns completed content through the official envelopes', async (t) => {
  const fake = await startFakeTrueForge(t, (request) => {
    if (request.method === 'POST' && request.path === '/api/v1/sessions') {
      return { body: { data: { id: 'conversation-session' } } };
    }
    if (request.method === 'POST' && request.path.endsWith('/turns')) {
      return { body: { data: { id: 'conversation-turn', state: { status: 'running' } } } };
    }
    return {
      body: {
        data: {
          id: 'conversation-turn',
          state: {
            status: 'done',
            output: { content: '{"text":"Grounded answer","requiresResearch":false}' },
          },
        },
      },
    };
  });
  const runner = createTrueForgeTurnRunner({
    baseUrl: fake.baseUrl,
    agentName: 'verifier-researcher',
    pollIntervalMs: 0,
    timeoutMs: 1_000,
  });

  const answer = await runner.run({ prompt: 'Answer only from supplied evidence.' });

  assert.equal(answer.content, '{"text":"Grounded answer","requiresResearch":false}');
  assert.equal(answer.sessionId, 'conversation-session');
  assert.equal(answer.turnId, 'conversation-turn');
  assert.equal(fake.requests[1].body.input[0].content, 'Answer only from supplied evidence.');
});

test('TrueForge metadata resolver accepts only a completed, traced sandbox exec result', async (t) => {
  const sandboxResult = {
    evidence: [
      {
        title: 'Current source',
        url: 'https://example.test/current',
        field: 'publishedAt',
        raw: '2026-08-25T00:00:00Z',
        normalized: '2026-08-25T00:00:00.000Z',
        strength: 'strong',
        provenance: 'search-provider',
      },
      {
        title: 'Older source',
        url: 'https://example.test/older',
        field: 'publishedAt',
        raw: '2026-08-24T00:00:00Z',
        normalized: '2026-08-24T00:00:00.000Z',
        strength: 'strong',
        provenance: 'search-provider',
      },
    ],
    status: 'resolved',
    newest: {
      title: 'Current source',
      url: 'https://example.test/current',
      field: 'publishedAt',
      raw: '2026-08-25T00:00:00Z',
      normalized: '2026-08-25T00:00:00.000Z',
      strength: 'strong',
      provenance: 'search-provider',
    },
    message: 'Current source has the newest strong machine-readable publishedAt signal (search-provider).',
  };
  const sandboxProof = {
    status: 'resolved',
    newestIndex: 0,
    normalizedDates: ['2026-08-25T00:00:00.000Z', '2026-08-24T00:00:00.000Z'],
  };
  let sandboxCommand;
  const fake = await startFakeTrueForge(t, (request) => {
    if (request.method === 'POST' && request.path === '/api/v1/sessions') {
      return { body: { data: { id: 'sandbox-session' } } };
    }
    if (request.method === 'POST' && request.path === '/api/v1/sessions/sandbox-session/turns') {
      sandboxCommand = request.body.input[0].content.split('\n\n').at(-1);
      return { body: { data: { id: 'sandbox-turn', state: { status: 'running' } } } };
    }
    if (request.path === '/api/v1/sessions/sandbox-session/turns/sandbox-turn/events?limit=100&order=asc') {
      return {
        body: {
          data: [
            { type: 'sandbox.created', id: 'event-sandbox', sandbox_id: 'sandbox-123', created_at: '2026-08-30T10:00:00Z', thread_id: null },
            {
              type: 'model.message', id: 'event-call', thread_id: 'main', created_at: '2026-08-30T10:00:01Z',
              tool_calls: [{
                id: 'call-sandbox-exec',
                type: 'function',
                function: { name: 'sandbox__exec', arguments: JSON.stringify({ command: sandboxCommand }) },
                tool_info: { type: 'truefoundry-system', name: 'exec' },
              }],
            },
            {
              type: 'tool.response', id: 'event-response', thread_id: 'main', created_at: '2026-08-30T10:00:02Z',
              tool_call_id: 'call-sandbox-exec',
              content: JSON.stringify({ success: true, response: { exitCode: 0, result: JSON.stringify(sandboxProof) } }),
            },
          ],
          pagination: { next_page_token: null },
        },
      };
    }
    return {
      body: {
        data: {
          id: 'sandbox-turn',
          state: { status: 'done', output: { content: JSON.stringify(sandboxProof) } },
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

  const result = await adapter.resolveMetadata({
    sources: [
      { title: 'Current source', url: 'https://example.test/current', publishedAt: '2026-08-25T00:00:00Z' },
      { title: 'Older source', url: 'https://example.test/older', publishedAt: '2026-08-24T00:00:00Z' },
    ],
  });

  assert.deepEqual(result.resolution, sandboxResult);
  assert.deepEqual(result.sandboxExecution, {
    verified: true,
    sessionId: 'sandbox-session',
    turnId: 'sandbox-turn',
    sandboxId: 'sandbox-123',
    toolCallId: 'call-sandbox-exec',
    eventIds: ['event-sandbox', 'event-call', 'event-response'],
  });
  assert.match(fake.requests[1].body.input[0].content, /sandbox\/exec/);
  assert.match(fake.requests[1].body.input[0].content, /python/);
});

test('TrueForge metadata resolver fails closed without persisted sandbox execution evidence', async (t) => {
  const fake = await startFakeTrueForge(t, (request) => {
    if (request.method === 'POST' && request.path === '/api/v1/sessions') {
      return { body: { data: { id: 'unverified-session' } } };
    }
    if (request.method === 'POST' && request.path.endsWith('/turns')) {
      return { body: { data: { id: 'unverified-turn', state: { status: 'running' } } } };
    }
    if (request.path.endsWith('/events?limit=100&order=asc')) {
      return { body: { data: [], pagination: { next_page_token: null } } };
    }
    return {
      body: {
        data: {
          id: 'unverified-turn',
          state: {
            status: 'done',
            output: { content: '{"status":"resolved","evidence":[],"message":"Trust me"}' },
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
    adapter.resolveMetadata({
      sources: [
        { title: 'A', url: 'https://example.test/a', publishedAt: '2026-08-25T00:00:00Z' },
        { title: 'B', url: 'https://example.test/b', publishedAt: '2026-08-24T00:00:00Z' },
      ],
    }),
    /verified sandbox execution/i,
  );
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
