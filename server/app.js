import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultDossierDirectory = fileURLToPath(new URL('../data/dossiers', import.meta.url));

export function createServer({ workflow = fixtureWorkflow, dossierDirectory = defaultDossierDirectory } = {}) {
  const sessions = new Map();

  return http.createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/health') {
      sendJson(response, 200, { status: 'ok' });
      return;
    }

    if (request.method === 'POST' && request.url === '/api/sessions') {
      const body = await readJson(request);
      if (!isNonEmptyString(body?.brief)) {
        sendJson(response, 400, error('invalid_request', 'brief must be a non-empty string'));
        return;
      }

      const session = { id: randomUUID(), brief: body.brief.trim(), status: 'created' };
      sessions.set(session.id, session);
      sendJson(response, 201, { session: publicSession(session) });
      return;
    }

    const workflowMatch = request.url?.match(/^\/api\/sessions\/([^/]+)\/workflow$/);
    if (request.method === 'POST' && workflowMatch) {
      const session = sessions.get(workflowMatch[1]);
      if (!session) {
        sendJson(response, 404, error('session_not_found', 'Session not found'));
        return;
      }
      if (session.status !== 'created') {
        sendJson(response, 409, error('invalid_transition', 'Workflow can only run for a created session'));
        return;
      }

      session.status = 'running';
      try {
        session.result = await workflow({ id: session.id, brief: session.brief });
      } catch {
        session.status = 'created';
        sendJson(response, 502, error('workflow_failed', 'Workflow execution failed'));
        return;
      }
      session.approvalToken = randomUUID();
      session.status = 'awaiting_approval';
      sendJson(response, 200, {
        session: publicSession(session),
        result: session.result,
        approval: { token: session.approvalToken },
      });
      return;
    }

    const approvalMatch = request.url?.match(/^\/api\/sessions\/([^/]+)\/approval$/);
    if (request.method === 'POST' && approvalMatch) {
      const session = sessions.get(approvalMatch[1]);
      if (!session) {
        sendJson(response, 404, error('session_not_found', 'Session not found'));
        return;
      }
      if (session.status !== 'awaiting_approval') {
        sendJson(response, 409, error('invalid_transition', 'Approval requires a completed workflow result'));
        return;
      }

      const body = await readJson(request);
      if (body?.approvalToken !== session.approvalToken) {
        sendJson(response, 403, error('invalid_approval_token', 'Approval token is invalid'));
        return;
      }
      if (body.approved === false) {
        session.status = 'rejected';
        session.approvalToken = undefined;
        sendJson(response, 200, { session: publicSession(session) });
        return;
      }
      if (body.approved !== true) {
        sendJson(response, 400, error('invalid_request', 'approved must be a boolean'));
        return;
      }

      const dossier = {
        id: session.id,
        brief: session.brief,
        result: session.result,
        savedAt: new Date().toISOString(),
      };
      session.status = 'saving';
      try {
        await mkdir(dossierDirectory, { recursive: true });
        await writeFile(join(dossierDirectory, `${session.id}.json`), JSON.stringify(dossier, null, 2), 'utf8');
      } catch {
        session.status = 'awaiting_approval';
        sendJson(response, 500, error('persistence_failed', 'Unable to persist dossier'));
        return;
      }

      session.dossier = dossier;
      session.status = 'saved';
      session.approvalToken = undefined;
      sendJson(response, 200, { session: publicSession(session), dossier: { id: dossier.id } });
      return;
    }

    const dossierMatch = request.url?.match(/^\/api\/sessions\/([^/]+)\/dossier$/);
    if (request.method === 'GET' && dossierMatch) {
      const dossierId = dossierMatch[1];
      if (!isUuid(dossierId)) {
        sendJson(response, 404, error('dossier_not_found', 'Dossier not found'));
        return;
      }

      try {
        const dossier = JSON.parse(await readFile(join(dossierDirectory, `${dossierId}.json`), 'utf8'));
        sendJson(response, 200, { dossier });
      } catch {
        sendJson(response, 404, error('dossier_not_found', 'Dossier not found'));
      }
      return;
    }

    sendJson(response, 404, error('not_found', 'Route not found'));
  });
}

async function fixtureWorkflow({ brief }) {
  return {
    status: 'unresolved',
    findings: [],
    summary: `Fixture workflow placeholder for: ${brief}`,
  };
}

function error(code, message) {
  return { error: { code, message } };
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function publicSession(session) {
  return { id: session.id, status: session.status };
}

function readJson(request) {
  return new Promise((resolve) => {
    let raw = '';
    request.on('data', (chunk) => { raw += chunk; });
    request.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve(null);
      }
    });
  });
}

function sendJson(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}
