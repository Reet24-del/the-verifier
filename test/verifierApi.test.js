import assert from 'node:assert/strict';
import test from 'node:test';

import { getDossier, runVerification, submitApproval } from '../src/lib/verifierApi.js';

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
  };
}

test('runVerification creates a session before starting its workflow', async () => {
  const requests = [];
  const sessionId = '11111111-1111-4111-8111-111111111111';
  const result = {
    mode: 'fixture',
    status: 'resolved',
    findings: [
      { angle: 'current', sources: [{ title: 'Current', url: 'https://example.test/current', claim: 'Current claim', stance: 'supports' }] },
      { angle: 'contradiction', sources: [{ title: 'Older', url: 'https://example.test/older', claim: 'Older claim', stance: 'contradicts' }] },
    ],
    resolution: { status: 'resolved', evidence: [], message: 'Current is newer.' },
    summary: 'Conflicting sources were found.',
  };
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    if (requests.length === 1) {
      return jsonResponse(201, { session: { id: sessionId, status: 'created' } });
    }
    return jsonResponse(200, {
      session: { id: sessionId, status: 'awaiting_approval' },
      result,
      approval: { token: 'approval-token' },
    });
  };

  const workflow = await runVerification({
    brief: ' Verify the current CEO. ',
    fetchImpl,
    apiBaseUrl: 'https://verifier.test/',
  });

  assert.deepEqual(requests, [
    {
      url: 'https://verifier.test/api/sessions',
      options: {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ brief: 'Verify the current CEO.' }),
      },
    },
    {
      url: `https://verifier.test/api/sessions/${sessionId}/workflow`,
      options: { method: 'POST' },
    },
  ]);
  assert.deepEqual(workflow, {
    session: { id: sessionId, status: 'awaiting_approval' },
    result,
    approvalToken: 'approval-token',
  });
});

test('runVerification exposes a useful server error instead of returning partial data', async () => {
  const fetchImpl = async () => jsonResponse(502, {
    error: { code: 'workflow_failed', message: 'Workflow execution failed' },
  });

  await assert.rejects(
    runVerification({ brief: 'Verify a claim.', fetchImpl }),
    /Workflow execution failed/,
  );
});

test('submitApproval sends the server token and decision to the correct session', async () => {
  let request;
  const sessionId = '22222222-2222-4222-8222-222222222222';
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return jsonResponse(200, {
      session: { id: sessionId, status: 'saved' },
      dossier: { id: sessionId },
    });
  };

  const response = await submitApproval({
    sessionId,
    approvalToken: 'one-time-token',
    approved: true,
    fetchImpl,
  });

  assert.deepEqual(request, {
    url: `/api/sessions/${sessionId}/approval`,
    options: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ approvalToken: 'one-time-token', approved: true }),
    },
  });
  assert.equal(response.session.status, 'saved');
  assert.equal(response.dossier.id, sessionId);
});

test('getDossier retrieves only the server-persisted session dossier', async () => {
  let request;
  const sessionId = '33333333-3333-4333-8333-333333333333';
  const dossier = {
    id: sessionId,
    brief: 'Verify the current CEO.',
    result: { status: 'resolved', findings: [], resolution: { evidence: [] } },
    savedAt: '2026-08-29T12:00:00.000Z',
  };
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return jsonResponse(200, { dossier });
  };

  const response = await getDossier({ sessionId, fetchImpl });

  assert.deepEqual(request, {
    url: `/api/sessions/${sessionId}/dossier`,
    options: { method: 'GET' },
  });
  assert.deepEqual(response, dossier);
});
