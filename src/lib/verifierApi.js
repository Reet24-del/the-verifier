function endpoint(apiBaseUrl, path) {
  return `${apiBaseUrl.replace(/\/$/, '')}${path}`;
}

async function requestJson(fetchImpl, url, options) {
  const response = await fetchImpl(url, options);
  const body = await response.json();
  if (!response.ok) {
    const error = new Error(body?.error?.message ?? `Request failed with status ${response.status}`);
    error.code = body?.error?.code;
    error.status = response.status;
    throw error;
  }
  return body;
}

function postJson(fetchImpl, url, body) {
  return requestJson(fetchImpl, url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function normalizeConversationWorkflow(body) {
  return {
    conversation: body.conversation,
    session: body.session,
    result: body.result,
    messages: body.messages,
    approvalToken: body.approval?.token,
  };
}

export async function createConversation({
  brief,
  fetchImpl = globalThis.fetch,
  apiBaseUrl = '',
}) {
  const body = await postJson(fetchImpl, endpoint(apiBaseUrl, '/api/conversations'), { brief: brief.trim() });
  return normalizeConversationWorkflow(body);
}

export async function getConversation({
  conversationId,
  fetchImpl = globalThis.fetch,
  apiBaseUrl = '',
}) {
  const body = await requestJson(
    fetchImpl,
    endpoint(apiBaseUrl, `/api/conversations/${encodeURIComponent(conversationId)}`),
    { method: 'GET' },
  );
  return body.conversation;
}

export function sendConversationMessage({
  conversationId,
  message,
  fetchImpl = globalThis.fetch,
  apiBaseUrl = '',
}) {
  return postJson(
    fetchImpl,
    endpoint(apiBaseUrl, `/api/conversations/${encodeURIComponent(conversationId)}/messages`),
    { message: message.trim() },
  );
}

export async function researchConversationAgain({
  conversationId,
  brief,
  fetchImpl = globalThis.fetch,
  apiBaseUrl = '',
}) {
  const body = await postJson(
    fetchImpl,
    endpoint(apiBaseUrl, `/api/conversations/${encodeURIComponent(conversationId)}/research`),
    { brief: brief.trim() },
  );
  return normalizeConversationWorkflow(body);
}

export async function runVerification({
  brief,
  fetchImpl = globalThis.fetch,
  apiBaseUrl = '',
}) {
  const normalizedBrief = brief.trim();
  const created = await postJson(fetchImpl, endpoint(apiBaseUrl, '/api/sessions'), { brief: normalizedBrief });
  const workflow = await requestJson(
    fetchImpl,
    endpoint(apiBaseUrl, `/api/sessions/${encodeURIComponent(created.session.id)}/workflow`),
    { method: 'POST' },
  );

  return {
    session: workflow.session,
    result: workflow.result,
    approvalToken: workflow.approval.token,
  };
}

export async function submitApproval({
  sessionId,
  approvalToken,
  approved,
  fetchImpl = globalThis.fetch,
  apiBaseUrl = '',
}) {
  return postJson(
    fetchImpl,
    endpoint(apiBaseUrl, `/api/sessions/${encodeURIComponent(sessionId)}/approval`),
    { approvalToken, approved },
  );
}

export async function getDossier({
  sessionId,
  fetchImpl = globalThis.fetch,
  apiBaseUrl = '',
}) {
  const body = await requestJson(
    fetchImpl,
    endpoint(apiBaseUrl, `/api/sessions/${encodeURIComponent(sessionId)}/dossier`),
    { method: 'GET' },
  );
  return body.dossier;
}
