import { writeFile } from 'node:fs/promises';
import { Agent } from 'undici';

const api = process.env.VERIFIER_API_URL ?? 'http://127.0.0.1:3001';
const brief = process.env.VERIFIER_REHEARSAL_BRIEF ?? 'Verify that Brian Niccol is CEO of Starbucks.';
const requestTimeoutMs = Number.parseInt(process.env.VERIFIER_REHEARSAL_TIMEOUT_MS ?? '900000', 10);
const dispatcher = new Agent({ headersTimeout: requestTimeoutMs, bodyTimeout: requestTimeoutMs });

async function request(path, options = {}) {
  const response = await fetch(`${api}${path}`, {
    ...options,
    dispatcher,
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  return { response, body };
}

const created = await request('/api/sessions', { method: 'POST', body: JSON.stringify({ brief }) });
if (!created.response.ok) throw new Error(`Create failed: ${JSON.stringify(created.body)}`);

const sessionId = created.body.session.id;
const workflow = await request(`/api/sessions/${sessionId}/workflow`, { method: 'POST' });
if (!workflow.response.ok) throw new Error(`Workflow failed: ${JSON.stringify(workflow.body)}`);

const beforeApproval = await request(`/api/sessions/${sessionId}/dossier`);
if (beforeApproval.response.ok) throw new Error('Dossier export was available before approval');

const approval = await request(`/api/sessions/${sessionId}/approval`, {
  method: 'POST',
  body: JSON.stringify({ approvalToken: workflow.body.approval.token, approved: true }),
});
if (!approval.response.ok || approval.body.session?.status !== 'saved') {
  throw new Error(`Approval failed: ${JSON.stringify(approval.body)}`);
}

const exported = await request(`/api/sessions/${sessionId}/dossier`);
if (!exported.response.ok) throw new Error(`Export failed: ${JSON.stringify(exported.body)}`);

const result = workflow.body.result;
const report = {
  runAt: new Date().toISOString(),
  brief,
  sessionId,
  mode: result.mode,
  status: result.status,
  sources: result.findings.flatMap((finding) => finding.sources.map((source) => ({
    angle: finding.angle,
    title: source.title,
    url: source.url,
    stance: source.stance,
    publishedAt: source.publishedAt,
  }))),
  resolution: result.resolution,
  sandboxExecution: result.sandboxExecution,
  preApprovalExportStatus: beforeApproval.response.status,
  approvalStatus: approval.body.session.status,
  exportedDossierId: exported.body.dossier.id,
  exportedSavedAt: exported.body.dossier.savedAt,
};

await writeFile('/private/tmp/trueforge-live-rehearsal.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
