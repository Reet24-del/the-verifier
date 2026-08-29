function endpoint(apiBaseUrl, path) {
  return `${apiBaseUrl.replace(/\/$/, '')}${path}`;
}

async function requestJson(fetchImpl, url, options) {
  const response = await fetchImpl(url, options);
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body?.error?.message ?? `Request failed with status ${response.status}`);
  }
  return body;
}

export async function runVerification({
  brief,
  fetchImpl = globalThis.fetch,
  apiBaseUrl = '',
}) {
  const normalizedBrief = brief.trim();
  const created = await requestJson(fetchImpl, endpoint(apiBaseUrl, '/api/sessions'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ brief: normalizedBrief }),
  });
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
  return requestJson(
    fetchImpl,
    endpoint(apiBaseUrl, `/api/sessions/${encodeURIComponent(sessionId)}/approval`),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ approvalToken, approved }),
    },
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
