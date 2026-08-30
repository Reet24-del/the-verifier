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

test('conversation creation runs one investigation and public reads redact approval tokens', async (t) => {
  const workflowCalls = [];
  const result = {
    status: 'resolved',
    summary: 'Conflicting sources were found.',
    findings: [],
    resolution: { message: 'The current source is newer.', evidence: [] },
  };
  const app = await startServer({
    workflow: async (session) => { workflowCalls.push(session); return result; },
  });
  t.after(app.close);

  const response = await app.request('/api/conversations', jsonRequest({ brief: 'Verify the Starbucks CEO.' }));
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(workflowCalls.length, 1);
  assert.equal(body.conversation.messages[0].role, 'user');
  assert.equal(body.conversation.messages[1].role, 'assistant');
  assert.equal(body.conversation.activeInvestigation.status, 'awaiting_approval');
  assert.equal(body.conversation.activeInvestigation.sessionId, body.session.id);
  assert.match(body.approval.token, /^[0-9a-f-]{36}$/i);

  const restoredResponse = await app.request(`/api/conversations/${body.conversation.id}`);
  const restored = await restoredResponse.json();
  assert.equal(restoredResponse.status, 200);
  assert.equal(restored.conversation.messages.length, 2);
  assert.equal(JSON.stringify(restored).includes(body.approval.token), false);
});

test('conversation follow-ups retain evidence and do not rerun research', async (t) => {
  const workflowCalls = [];
  const responderCalls = [];
  const result = {
    status: 'resolved', summary: 'Resolved summary.', findings: [], resolution: { message: 'Newest source wins.', evidence: [] },
  };
  const app = await startServer({
    workflow: async (session) => { workflowCalls.push(session); return result; },
    conversationResponder: async (context) => {
      responderCalls.push(context);
      return { text: 'The newest source wins because its date is later.', requiresResearch: false };
    },
  });
  t.after(app.close);
  const created = await (await app.request('/api/conversations', jsonRequest({ brief: 'Verify the Starbucks CEO.' }))).json();

  const response = await app.request(`/api/conversations/${created.conversation.id}/messages`, jsonRequest({
    message: 'Why is that source newer?',
  }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(workflowCalls.length, 1);
  assert.equal(responderCalls.length, 1);
  assert.equal(responderCalls[0].brief, 'Verify the Starbucks CEO.');
  assert.deepEqual(responderCalls[0].result, result);
  assert.equal(body.requiresResearch, false);
  assert.equal(body.messages[0].text, 'Why is that source newer?');
  assert.equal(body.messages[1].text, 'The newest source wins because its date is later.');
  assert.equal(body.conversation.messages.length, 4);
});

test('research again replaces the active session and invalidates its previous approval token', async (t) => {
  const workflowCalls = [];
  const app = await startServer({
    workflow: async (session) => {
      workflowCalls.push(session);
      return {
        status: 'resolved',
        summary: `Result ${workflowCalls.length}`,
        findings: [],
        resolution: { message: `Resolution ${workflowCalls.length}`, evidence: [] },
      };
    },
  });
  t.after(app.close);
  const created = await (await app.request('/api/conversations', jsonRequest({ brief: 'Verify the Starbucks CEO.' }))).json();
  const firstSessionId = created.session.id;
  const firstToken = created.approval.token;

  const rerunResponse = await app.request(`/api/conversations/${created.conversation.id}/research`, jsonRequest({
    brief: 'Check the same claim for newer evidence.',
  }));
  const rerun = await rerunResponse.json();

  assert.equal(rerunResponse.status, 200);
  assert.equal(workflowCalls.length, 2);
  assert.notEqual(rerun.session.id, firstSessionId);
  assert.equal(rerun.conversation.messages[0].text, 'Verify the Starbucks CEO.');
  assert.equal(rerun.conversation.messages.at(-2).text, 'Check the same claim for newer evidence.');
  assert.match(rerun.approval.token, /^[0-9a-f-]{36}$/i);
  assert.notEqual(rerun.approval.token, firstToken);

  const staleApproval = await app.request(`/api/sessions/${firstSessionId}/approval`, jsonRequest({
    approvalToken: firstToken,
    approved: true,
  }));
  assert.equal(staleApproval.status, 409);
});

test('conversation approval persists only the active investigation and approved transcript', async (t) => {
  const dossierDirectory = await makeDossierDirectory(t);
  const app = await startServer({ dossierDirectory });
  t.after(app.close);
  const created = await (await app.request('/api/conversations', jsonRequest({ brief: 'Verify the Starbucks CEO.' }))).json();
  await app.request(`/api/conversations/${created.conversation.id}/messages`, jsonRequest({ message: 'Which source is newer?' }));

  const response = await app.request(`/api/sessions/${created.session.id}/approval`, jsonRequest({
    approvalToken: created.approval.token,
    approved: true,
  }));
  const saved = JSON.parse(await readFile(join(dossierDirectory, `${created.session.id}.json`), 'utf8'));
  const restored = await (await app.request(`/api/conversations/${created.conversation.id}`)).json();

  assert.equal(response.status, 200);
  assert.equal(saved.conversation.id, created.conversation.id);
  assert.equal(saved.conversation.messages.length, 5);
  assert.equal(saved.conversation.messages.at(-1).kind, 'approval');
  assert.equal(restored.conversation.activeInvestigation.status, 'saved');
  assert.equal(JSON.stringify(saved).includes(created.approval.token), false);
});

test('conversation messages reject empty and oversized input without adding a turn', async (t) => {
  const app = await startServer();
  t.after(app.close);
  const created = await (await app.request('/api/conversations', jsonRequest({ brief: 'Verify the Starbucks CEO.' }))).json();

  const empty = await app.request(`/api/conversations/${created.conversation.id}/messages`, jsonRequest({ message: '   ' }));
  const oversized = await app.request(`/api/conversations/${created.conversation.id}/messages`, jsonRequest({ message: 'x'.repeat(2001) }));
  const restored = await (await app.request(`/api/conversations/${created.conversation.id}`)).json();

  assert.equal(empty.status, 400);
  assert.equal(oversized.status, 400);
  assert.equal(restored.conversation.messages.length, 2);
});

test('conversation responder failure appends no unsupported assistant claim', async (t) => {
  const app = await startServer({
    conversationResponder: async () => { throw new Error('provider unavailable'); },
  });
  t.after(app.close);
  const created = await (await app.request('/api/conversations', jsonRequest({ brief: 'Verify the Starbucks CEO.' }))).json();

  const response = await app.request(`/api/conversations/${created.conversation.id}/messages`, jsonRequest({
    message: 'Explain the source dates.',
  }));
  const restored = await (await app.request(`/api/conversations/${created.conversation.id}`)).json();

  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), {
    error: { code: 'conversation_failed', message: 'Unable to answer from the active evidence' },
  });
  assert.equal(restored.conversation.messages.length, 3);
  assert.equal(restored.conversation.messages.at(-1).role, 'user');
});

test('failed research rerun preserves the previous investigation and approval token', async (t) => {
  let callCount = 0;
  const app = await startServer({
    workflow: async () => {
      callCount += 1;
      if (callCount === 2) throw new Error('research failed');
      return { status: 'resolved', summary: 'Original result.', findings: [], resolution: { message: 'Resolved.', evidence: [] } };
    },
  });
  t.after(app.close);
  const created = await (await app.request('/api/conversations', jsonRequest({ brief: 'Verify the Starbucks CEO.' }))).json();

  const rerun = await app.request(`/api/conversations/${created.conversation.id}/research`, jsonRequest({
    brief: 'Check for newer evidence.',
  }));
  const restored = await (await app.request(`/api/conversations/${created.conversation.id}`)).json();
  const approval = await app.request(`/api/sessions/${created.session.id}/approval`, jsonRequest({
    approvalToken: created.approval.token,
    approved: false,
  }));

  assert.equal(rerun.status, 502);
  assert.equal(restored.conversation.activeInvestigation.sessionId, created.session.id);
  assert.equal(restored.conversation.activeInvestigation.status, 'awaiting_approval');
  assert.equal(approval.status, 200);
});
