import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createServer } from '../server/app.js';

async function startServer(options) {
  const server = createServer(options);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();

  return {
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
    request: (path, options) => fetch(`http://127.0.0.1:${port}${path}`, options),
  };
}

function jsonRequest(body) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

async function createSession(app, brief = 'Verify Ada Lovelace is a mathematician.') {
  const response = await app.request('/api/sessions', jsonRequest({ brief }));
  return (await response.json()).session;
}

async function makeDossierDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), 'verifier-dossiers-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('GET /health reports the service is ready', async (t) => {
  const app = await startServer();
  t.after(app.close);

  const response = await app.request('/health');

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
});

test('POST /api/sessions creates a session for a valid brief', async (t) => {
  const app = await startServer();
  t.after(app.close);

  const response = await app.request('/api/sessions', jsonRequest({ brief: 'Verify Ada Lovelace is a mathematician.' }));
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.session.status, 'created');
  assert.match(body.session.id, /^[0-9a-f-]{36}$/i);
});

test('POST /api/sessions rejects a missing brief', async (t) => {
  const app = await startServer();
  t.after(app.close);

  const response = await app.request('/api/sessions', jsonRequest({}));

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: { code: 'invalid_request', message: 'brief must be a non-empty string' },
  });
});

test('POST workflow runs the injected workflow and issues an approval token', async (t) => {
  const workflowResult = {
    status: 'unresolved',
    findings: [{ claim: 'Ada Lovelace was a mathematician.', sources: [] }],
  };
  const app = await startServer({
    workflow: async (session) => {
      assert.equal(session.brief, 'Verify Ada Lovelace is a mathematician.');
      return workflowResult;
    },
  });
  t.after(app.close);
  const session = await createSession(app);

  const response = await app.request(`/api/sessions/${session.id}/workflow`, { method: 'POST' });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.result, workflowResult);
  assert.deepEqual(body.session, { id: session.id, status: 'awaiting_approval' });
  assert.match(body.approval.token, /^[0-9a-f-]{36}$/i);
});

test('completed research remains blocked and creates no dossier before explicit approval', async (t) => {
  const dossierDirectory = await makeDossierDirectory(t);
  const app = await startServer({ dossierDirectory });
  t.after(app.close);
  const session = await createSession(app);

  const workflowResponse = await app.request(`/api/sessions/${session.id}/workflow`, { method: 'POST' });
  const dossierResponse = await app.request(`/api/sessions/${session.id}/dossier`);

  assert.equal(workflowResponse.status, 200);
  assert.equal((await workflowResponse.json()).session.status, 'awaiting_approval');
  assert.equal(dossierResponse.status, 404);
  assert.deepEqual(await readdir(dossierDirectory), []);
});

test('POST approval rejects a session whose workflow has not completed', async (t) => {
  const app = await startServer();
  t.after(app.close);
  const session = await createSession(app);

  const response = await app.request(`/api/sessions/${session.id}/approval`, jsonRequest({
    approvalToken: crypto.randomUUID(),
    approved: true,
  }));

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: { code: 'invalid_transition', message: 'Approval requires a completed workflow result' },
  });
});

test('POST approval rejects an invalid token without changing the session', async (t) => {
  const dossierDirectory = await makeDossierDirectory(t);
  const app = await startServer({ dossierDirectory });
  t.after(app.close);
  const session = await createSession(app);
  await app.request(`/api/sessions/${session.id}/workflow`, { method: 'POST' });

  const response = await app.request(`/api/sessions/${session.id}/approval`, jsonRequest({
    approvalToken: crypto.randomUUID(),
    approved: true,
  }));

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: { code: 'invalid_approval_token', message: 'Approval token is invalid' },
  });
  assert.deepEqual(await readdir(dossierDirectory), []);
});

test('rejected approval does not persist or expose a dossier', async (t) => {
  const dossierDirectory = await makeDossierDirectory(t);
  const app = await startServer({ dossierDirectory });
  t.after(app.close);
  const session = await createSession(app);
  const workflow = await app.request(`/api/sessions/${session.id}/workflow`, { method: 'POST' });
  const { approval } = await workflow.json();

  const approvalResponse = await app.request(`/api/sessions/${session.id}/approval`, jsonRequest({
    approvalToken: approval.token,
    approved: false,
  }));
  const dossierResponse = await app.request(`/api/sessions/${session.id}/dossier`);

  assert.equal(approvalResponse.status, 200);
  assert.deepEqual(await approvalResponse.json(), { session: { id: session.id, status: 'rejected' } });
  assert.equal(dossierResponse.status, 404);
  assert.deepEqual(await readdir(dossierDirectory), []);
});

test('valid explicit approval persists the completed dossier', async (t) => {
  const dossierDirectory = await makeDossierDirectory(t);
  const app = await startServer({ dossierDirectory });
  t.after(app.close);
  const session = await createSession(app);
  const workflow = await app.request(`/api/sessions/${session.id}/workflow`, { method: 'POST' });
  const { approval } = await workflow.json();

  const response = await app.request(`/api/sessions/${session.id}/approval`, jsonRequest({
    approvalToken: approval.token,
    approved: true,
  }));
  const saved = JSON.parse(await readFile(join(dossierDirectory, `${session.id}.json`), 'utf8'));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    session: { id: session.id, status: 'saved' },
    dossier: { id: session.id },
  });
  assert.equal(saved.id, session.id);
  assert.equal(saved.brief, 'Verify Ada Lovelace is a mathematician.');
  assert.equal(saved.result.status, 'resolved');
  assert.match(saved.savedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('GET dossier serves a saved dossier after a server restart', async (t) => {
  const dossierDirectory = await makeDossierDirectory(t);
  const writer = await startServer({ dossierDirectory });
  const session = await createSession(writer);
  const workflow = await writer.request(`/api/sessions/${session.id}/workflow`, { method: 'POST' });
  const { approval } = await workflow.json();
  await writer.request(`/api/sessions/${session.id}/approval`, jsonRequest({
    approvalToken: approval.token,
    approved: true,
  }));
  await writer.close();

  const reader = await startServer({ dossierDirectory });
  t.after(reader.close);
  const response = await reader.request(`/api/sessions/${session.id}/dossier`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.dossier.id, session.id);
  assert.equal(body.dossier.brief, 'Verify Ada Lovelace is a mathematician.');
  assert.equal(body.dossier.result.status, 'resolved');
});
