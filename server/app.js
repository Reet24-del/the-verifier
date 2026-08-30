import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConversationResponderFromEnvironment } from './conversationResponder.js';
import { createConversationStore } from './conversationStore.js';
import { createResearchWorkflow } from './research.js';

const defaultDossierDirectory = fileURLToPath(new URL('../data/dossiers', import.meta.url));

export function createServer({
  workflow = createResearchWorkflow(),
  dossierDirectory = defaultDossierDirectory,
  conversationStore = createConversationStore(),
  conversationResponder = createConversationResponderFromEnvironment(),
} = {}) {
  const sessions = new Map();
  const sessionConversations = new Map();

  function createSession(brief) {
    const session = { id: randomUUID(), brief: brief.trim(), status: 'created' };
    sessions.set(session.id, session);
    return session;
  }

  async function executeWorkflow(session) {
    session.status = 'running';
    try {
      session.result = await workflow({ id: session.id, brief: session.brief });
    } catch (workflowError) {
      session.status = 'created';
      throw workflowError;
    }
    session.approvalToken = randomUUID();
    session.status = 'awaiting_approval';
    return session;
  }

  function attachConversationInvestigation(conversationId, session) {
    sessionConversations.set(session.id, conversationId);
    conversationStore.setActiveInvestigation(conversationId, {
      sessionId: session.id,
      brief: session.brief,
      status: session.status,
      result: session.result,
      approvalToken: session.approvalToken,
    });
  }

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

      const session = createSession(body.brief);
      sendJson(response, 201, { session: publicSession(session) });
      return;
    }

    if (request.method === 'POST' && request.url === '/api/conversations') {
      const body = await readJson(request);
      if (!isBoundedMessage(body?.brief)) {
        sendJson(response, 400, error('invalid_request', 'brief must be a non-empty string of at most 2000 characters'));
        return;
      }
      const conversation = conversationStore.create({ brief: body.brief });
      const session = createSession(body.brief);
      try {
        await executeWorkflow(session);
      } catch {
        sendJson(response, 502, error('workflow_failed', 'Workflow execution failed'));
        return;
      }
      attachConversationInvestigation(conversation.id, session);
      conversationStore.append(conversation.id, {
        role: 'assistant',
        text: resultMessage(session.result),
        kind: 'result',
      });
      sendJson(response, 201, {
        conversation: conversationStore.publicView(conversation.id),
        session: publicSession(session),
        result: session.result,
        approval: { token: session.approvalToken },
      });
      return;
    }

    const conversationReadMatch = request.url?.match(/^\/api\/conversations\/([^/]+)$/);
    if (request.method === 'GET' && conversationReadMatch) {
      const conversation = conversationStore.get(conversationReadMatch[1]);
      if (!conversation) {
        sendJson(response, 404, error('conversation_not_found', 'Conversation not found'));
        return;
      }
      sendJson(response, 200, { conversation: conversationStore.publicView(conversation.id) });
      return;
    }

    const conversationMessageMatch = request.url?.match(/^\/api\/conversations\/([^/]+)\/messages$/);
    if (request.method === 'POST' && conversationMessageMatch) {
      const conversation = conversationStore.get(conversationMessageMatch[1]);
      if (!conversation) {
        sendJson(response, 404, error('conversation_not_found', 'Conversation not found'));
        return;
      }
      const body = await readJson(request);
      if (!isBoundedMessage(body?.message)) {
        sendJson(response, 400, error('invalid_request', 'message must be a non-empty string of at most 2000 characters'));
        return;
      }
      const investigation = conversation.activeInvestigation;
      if (!investigation?.result) {
        sendJson(response, 409, error('invalid_transition', 'Follow-up requires a completed investigation'));
        return;
      }
      const userMessage = conversationStore.append(conversation.id, {
        role: 'user', text: body.message, kind: 'follow_up',
      });
      let answer;
      try {
        answer = await conversationResponder({
          message: body.message.trim(),
          messages: conversation.messages,
          brief: investigation.brief,
          result: investigation.result,
        });
      } catch {
        sendJson(response, 502, error('conversation_failed', 'Unable to answer from the active evidence'));
        return;
      }
      const assistantMessage = conversationStore.append(conversation.id, {
        role: 'assistant', text: answer.text, kind: 'answer',
      });
      sendJson(response, 200, {
        conversation: conversationStore.publicView(conversation.id),
        messages: [userMessage, assistantMessage],
        requiresResearch: answer.requiresResearch,
      });
      return;
    }

    const conversationResearchMatch = request.url?.match(/^\/api\/conversations\/([^/]+)\/research$/);
    if (request.method === 'POST' && conversationResearchMatch) {
      const conversation = conversationStore.get(conversationResearchMatch[1]);
      if (!conversation) {
        sendJson(response, 404, error('conversation_not_found', 'Conversation not found'));
        return;
      }
      const body = await readJson(request);
      if (!isBoundedMessage(body?.brief)) {
        sendJson(response, 400, error('invalid_request', 'brief must be a non-empty string of at most 2000 characters'));
        return;
      }

      const previousInvestigation = structuredClone(conversation.activeInvestigation);
      const previousSession = previousInvestigation ? sessions.get(previousInvestigation.sessionId) : null;
      const userMessage = conversationStore.append(conversation.id, {
        role: 'user', text: body.brief, kind: 'brief',
      });
      const session = createSession(body.brief);
      try {
        await executeWorkflow(session);
      } catch {
        sessions.delete(session.id);
        sendJson(response, 502, error('workflow_failed', 'Workflow execution failed'));
        return;
      }
      if (previousSession?.status === 'awaiting_approval') {
        previousSession.status = 'replaced';
        previousSession.approvalToken = undefined;
      }
      attachConversationInvestigation(conversation.id, session);
      const assistantMessage = conversationStore.append(conversation.id, {
        role: 'assistant', text: resultMessage(session.result), kind: 'result',
      });
      sendJson(response, 200, {
        conversation: conversationStore.publicView(conversation.id),
        messages: [userMessage, assistantMessage],
        session: publicSession(session),
        result: session.result,
        approval: { token: session.approvalToken },
      });
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

      try {
        await executeWorkflow(session);
      } catch {
        sendJson(response, 502, error('workflow_failed', 'Workflow execution failed'));
        return;
      }
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
        const conversationId = sessionConversations.get(session.id);
        if (conversationId) {
          conversationStore.setActiveInvestigation(conversationId, {
            sessionId: session.id,
            brief: session.brief,
            status: session.status,
            result: session.result,
          });
          conversationStore.append(conversationId, {
            role: 'assistant',
            text: 'Not saved. The current evidence remains available for follow-up questions.',
            kind: 'approval',
          });
        }
        sendJson(response, 200, { session: publicSession(session) });
        return;
      }
      if (body.approved !== true) {
        sendJson(response, 400, error('invalid_request', 'approved must be a boolean'));
        return;
      }

      const savedAt = new Date().toISOString();
      const conversationId = sessionConversations.get(session.id);
      let conversationSnapshot;
      if (conversationId) {
        conversationSnapshot = conversationStore.publicView(conversationId);
        conversationSnapshot.activeInvestigation.status = 'saved';
        conversationSnapshot.messages.push({
          id: randomUUID(),
          role: 'assistant',
          text: 'Saved with your approval.',
          kind: 'approval',
          createdAt: savedAt,
        });
      }
      const dossier = {
        id: session.id,
        brief: session.brief,
        result: session.result,
        savedAt,
        ...(conversationSnapshot ? { conversation: conversationSnapshot } : {}),
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
      if (conversationId) {
        conversationStore.setActiveInvestigation(conversationId, {
          sessionId: session.id,
          brief: session.brief,
          status: session.status,
          result: session.result,
        });
        conversationStore.append(conversationId, {
          role: 'assistant', text: 'Saved with your approval.', kind: 'approval',
        });
      }
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

function error(code, message) {
  return { error: { code, message } };
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isBoundedMessage(value) {
  return isNonEmptyString(value) && value.trim().length <= 2_000;
}

function resultMessage(result) {
  const summary = isNonEmptyString(result?.summary) ? result.summary.trim() : 'The investigation is complete.';
  const resolutionMessage = isNonEmptyString(result?.resolution?.message) ? result.resolution.message.trim() : '';
  const resolution = resolutionMessage && !summary.includes(resolutionMessage) ? ` ${resolutionMessage}` : '';
  return `${summary}${resolution} I am keeping this evidence in our conversation. Would you like to approve and save it, ask a follow-up, or research again?`;
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
