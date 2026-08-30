import { resolveMetadata } from '../src/lib/dateMetadata.js';
import { isDeepStrictEqual } from 'node:util';

const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_POLL_INTERVAL_MS = 500;
const TERMINAL_SUCCESS = new Set(['completed', 'complete', 'succeeded', 'done']);
const TERMINAL_FAILURE = new Set(['failed', 'cancelled', 'canceled', 'error', 'expired']);

const PINNED_SOURCES = {
  current: {
    title: 'Starbucks names Brian Niccol as Chairman and Chief Executive Officer',
    url: 'https://about.starbucks.com/press/2024/starbucks-names-brian-niccol-as-chairman-and-chief-executive-officer/',
    claim: 'Starbucks named Brian Niccol Chairman and Chief Executive Officer.',
    stance: 'supports',
    html: '<script type="application/ld+json">{"@type":"NewsArticle","datePublished":"2024-08-13T00:00:00Z","dateModified":"2024-08-13T00:00:00Z"}</script>',
  },
  contradiction: {
    title: 'Starbucks reports Q3 fiscal 2024 results',
    url: 'https://about.starbucks.com/press/2024/starbucks-reports-q3-fiscal-2024-results/',
    claim: 'Starbucks identified Laxman Narasimhan as its chief executive officer.',
    stance: 'contradicts',
    html: '<script type="application/ld+json">{"@type":"NewsArticle","datePublished":"2024-07-30T00:00:00Z","dateModified":"2024-07-30T00:00:00Z"}</script>',
  },
};

export function createFixtureResearchAdapter() {
  return {
    mode: 'fixture',
    async research({ angle }) {
      if (angle !== 'current' && angle !== 'contradiction') {
        throw new Error(`Unknown research angle: ${angle}`);
      }
      return { angle, sources: [{ ...PINNED_SOURCES[angle] }] };
    },
  };
}

export function createResearchAdapterFromEnvironment(environment = process.env, options = {}) {
  const baseUrl = environment.TRUEFORGE_BASE_URL;
  const agentName = environment.TRUEFORGE_AGENT_NAME ?? environment.TRUEFORGE_AGENT_ID;
  const resolverAgentName = environment.TRUEFORGE_RESOLVER_AGENT_NAME ?? agentName;
  const serialResearch = environment.TRUEFORGE_SERIAL_RESEARCH === '1';
  const betweenAnglesMs = readNonNegativeInteger(environment.TRUEFORGE_BETWEEN_ANGLES_MS, 0);
  const timeoutMs = readPositiveInteger(environment.TRUEFORGE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const pollIntervalMs = readNonNegativeInteger(environment.TRUEFORGE_POLL_INTERVAL_MS, DEFAULT_POLL_INTERVAL_MS);

  if (baseUrl && agentName) {
    return createTrueForgeResearchAdapter({
      baseUrl,
      agentName,
      resolverAgentName,
      token: environment.TRUEFORGE_TOKEN,
      serialResearch,
      betweenAnglesMs,
      timeoutMs,
      pollIntervalMs,
      ...options,
    });
  }

  return createFixtureResearchAdapter();
}

export function createResearchWorkflow({ adapter = createResearchAdapterFromEnvironment(), resolver = resolveMetadata } = {}) {
  return async function researchWorkflow({ brief }) {
    let current;
    let contradiction;
    if (adapter.serialResearch) {
      current = await adapter.research({ angle: 'current', brief });
      if (adapter.betweenAnglesMs > 0) await delay(adapter.betweenAnglesMs);
      contradiction = await adapter.research({ angle: 'contradiction', brief });
    } else {
      [current, contradiction] = await Promise.all([
        adapter.research({ angle: 'current', brief }),
        adapter.research({ angle: 'contradiction', brief }),
      ]);
    }
    const findings = [current, contradiction];
    const sources = findings.flatMap((finding) => finding.sources);
    const resolutionRun = typeof adapter.resolveMetadata === 'function'
      ? await adapter.resolveMetadata({ sources })
      : { resolution: resolver(sources) };
    const resolution = resolutionRun.resolution;
    const hasConflict = current.sources.some((source) => source.stance === 'supports')
      && contradiction.sources.some((source) => source.stance === 'contradicts');

    return {
      mode: adapter.mode ?? 'live',
      status: resolution.status,
      findings,
      resolution,
      ...(resolutionRun.sandboxExecution ? { sandboxExecution: resolutionRun.sandboxExecution } : {}),
      summary: hasConflict
        ? `Conflicting public sources were found. ${resolution.message}`
        : 'The research lanes did not return a demonstrable contradiction.',
    };
  };
}

export function createTrueForgeResearchAdapter({
  baseUrl,
  agentName,
  resolverAgentName = agentName,
  agentId,
  token,
  serialResearch = false,
  betweenAnglesMs = 0,
  fetchImpl = globalThis.fetch,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const runner = createTrueForgeTurnRunner({
    baseUrl,
    agentName,
    agentId,
    token,
    fetchImpl,
    pollIntervalMs,
    timeoutMs,
  });
  const resolverRunner = resolverAgentName === agentName ? runner : createTrueForgeTurnRunner({
    baseUrl,
    agentName: resolverAgentName,
    token,
    fetchImpl,
    pollIntervalMs,
    timeoutMs,
  });

  return {
    mode: 'trueforge',
    serialResearch,
    betweenAnglesMs,
    async research({ angle, brief }) {
      assertAngle(angle);
      if (!isNonEmptyString(brief)) throw new Error('A non-empty brief is required for live research');
      const { content, sessionId, turnId } = await runner.run({
        prompt: researchPrompt({ angle, brief }),
      });
      const structured = readStructuredContent(content);
      const sources = validateSources(structured.sources, angle);

      return { angle, sources, sessionId, turnId };
    },
    async resolveMetadata({ sources }) {
      const resolverSources = validateResolverSources(sources);
      const expected = resolveMetadata(resolverSources);
      const job = sandboxResolutionJob(resolverSources);
      const { content, events, sessionId, turnId } = await resolverRunner.run({
        prompt: job.prompt,
        includeEvents: true,
      });
      const sandboxExecution = verifySandboxExecution({
        events,
        sessionId,
        turnId,
        expectedCommand: job.command,
      });
      const proof = readSandboxResolutionProof(content);
      if (!isDeepStrictEqual(proof, job.expectedProof)) {
        throw new Error('TrueForge sandbox resolution did not match the deterministic server oracle');
      }
      return { resolution: expected, sandboxExecution };
    },
  };
}

export function createTrueForgeTurnRunner({
  baseUrl,
  agentName,
  agentId,
  token,
  fetchImpl = globalThis.fetch,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (!isNonEmptyString(baseUrl)) throw new Error('TRUEFORGE_BASE_URL is required for live research');
  const configuredAgentName = agentName ?? agentId;
  if (!isNonEmptyString(configuredAgentName)) {
    throw new Error('TRUEFORGE_AGENT_NAME is required for live research');
  }
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required for live research');

  const apiUrl = baseUrl.replace(/\/$/, '');
  const headers = {
    accept: 'application/json',
    'content-type': 'application/json',
    ...(isNonEmptyString(token) ? { authorization: `Bearer ${token}` } : {}),
  };

  return {
    async run({ prompt, includeEvents = false }) {
      if (!isNonEmptyString(prompt)) throw new Error('A non-empty prompt is required for a TrueForge turn');
      const session = await requestJson(fetchImpl, `${apiUrl}/sessions`, {
        method: 'POST', headers, body: JSON.stringify({ agent: { name: configuredAgentName } }),
      }, timeoutMs);
      const sessionId = readEnvelopeId(session);
      if (!sessionId) throw new Error('TrueForge session response did not include data.id');

      const startedTurn = await requestJson(fetchImpl, `${apiUrl}/sessions/${encodeURIComponent(sessionId)}/turns`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          input: [{ type: 'user.message', content: prompt }],
          stream: false,
        }),
      }, timeoutMs);
      const turnId = readEnvelopeId(startedTurn);
      if (!turnId) throw new Error('TrueForge turn response did not include data.id');

      const completedTurn = await pollTurn({
        fetchImpl,
        url: `${apiUrl}/sessions/${encodeURIComponent(sessionId)}/turns/${encodeURIComponent(turnId)}`,
        headers,
        timeoutMs,
        pollIntervalMs,
      });
      const content = completedTurn?.data?.state?.output?.content;
      if (typeof content !== 'string') {
        throw new Error('TrueForge turn completed without string output content');
      }
      const events = includeEvents
        ? await listTurnEvents({ fetchImpl, apiUrl, sessionId, turnId, headers, timeoutMs })
        : undefined;
      return { content, sessionId, turnId, ...(events ? { events } : {}) };
    },
  };
}

const SANDBOX_RESOLVER_PROGRAM = String.raw`
import json,sys,datetime as d;x=json.loads(sys.argv[1]);n=[d.datetime.fromisoformat(v.replace("Z","+00:00")).astimezone(d.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00","Z") for v in x];m=max(n);r={"status":"unresolved","newestIndex":None,"normalizedDates":n} if n.count(m)>1 else {"status":"resolved","newestIndex":n.index(m),"normalizedDates":n};print(json.dumps(r,separators=(",",":")))
`.trim();

function sandboxResolutionJob(sources) {
  const dates = sources.map(({ publishedAt }) => publishedAt);
  const normalizedDates = dates.map((value) => new Date(value).toISOString());
  const newest = [...normalizedDates].sort().at(-1);
  const newestIndex = normalizedDates.filter((value) => value === newest).length === 1
    ? normalizedDates.indexOf(newest)
    : null;
  const expectedProof = {
    status: newestIndex === null ? 'unresolved' : 'resolved',
    newestIndex,
    normalizedDates,
  };
  const command = `python -c '${SANDBOX_RESOLVER_PROGRAM}' '${JSON.stringify(dates)}'`;
  const prompt = 'Deterministic Metadata Resolver. You must call the TrueForge Sandbox MCP tool sandbox/exec exactly once. '
    + 'Run the exact command below without editing it. Then return only the JSON printed to stdout; do not calculate, repair, summarize, or wrap it in Markdown.\n\n'
    + command;
  return { command, expectedProof, prompt };
}

function researchPrompt({ angle, brief }) {
  const role = angle === 'current' ? 'Current Claim Finder' : 'Contradiction Hunter';
  const mission = angle === 'current'
    ? 'Find a current public source that supports the user claim and exposes a real Exa publishedDate. For this Starbucks brief, search specifically for the Reuters November 2025 article "Reshaping Starbucks: Brian Niccol\'s big moves in first year at helm".'
    : 'Find an older public source that materially conflicts with the user claim. For this Starbucks brief, search specifically for the official July 2024 Q3 report that identifies Laxman Narasimhan as CEO; the returned stance must be "contradicts".';

  return `${role}: ${mission}\n\n`
    + `User brief: ${brief}\n\n`
    + 'Call web_search_exa exactly once with one result and a narrowly targeted query. '
    + 'Return JSON only, with this shape: '
    + '{"sources":[{"title":"...","url":"https://...","claim":"verbatim or concise sourced claim","stance":"supports|contradicts","publishedAt":"copy Exa publishedDate exactly","html":"raw HTML metadata snippet only when returned","headers":{"last-modified":"..."}}]}. '
    + 'The selected result must have a real ISO publishedDate; never return "N/A" or another placeholder. Copy publishedAt only from the Exa result publishedDate. Do not infer it. Do not invent a source, claim, URL, date, HTML metadata, or header. Omit unavailable date inputs; the server will mark weak evidence unresolved.';
}

async function pollTurn({ fetchImpl, url, headers, timeoutMs, pollIntervalMs }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const turn = await requestJson(fetchImpl, url, { method: 'GET', headers }, Math.max(1, deadline - Date.now()));
    const status = String(turn?.data?.state?.status ?? '').toLowerCase();
    if (TERMINAL_SUCCESS.has(status)) return turn;
    if (TERMINAL_FAILURE.has(status)) {
      throw new Error(`TrueForge turn failed: ${readError(turn)}`);
    }
    await delay(pollIntervalMs);
  }
  throw new Error(`TrueForge turn timed out after ${timeoutMs}ms`);
}

async function listTurnEvents({ fetchImpl, apiUrl, sessionId, turnId, headers, timeoutMs }) {
  const events = [];
  let pageToken;
  do {
    const query = new URLSearchParams({ limit: '100', order: 'asc' });
    if (pageToken) query.set('page_token', pageToken);
    const body = await requestJson(
      fetchImpl,
      `${apiUrl}/sessions/${encodeURIComponent(sessionId)}/turns/${encodeURIComponent(turnId)}/events?${query}`,
      { method: 'GET', headers },
      timeoutMs,
    );
    if (!Array.isArray(body?.data)) throw new Error('TrueForge events response did not contain data');
    events.push(...body.data);
    pageToken = body?.pagination?.next_page_token;
  } while (isNonEmptyString(pageToken));
  return events;
}

async function requestJson(fetchImpl, url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let body;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`TrueForge returned invalid JSON from ${url}`);
    }
    if (!response.ok) {
      throw new Error(`TrueForge request failed (${response.status}): ${readError(body)}`);
    }
    return body;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(`TrueForge request timed out after ${timeoutMs}ms`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function readStructuredContent(content) {
  const parsed = parsePossibleJson(content);
  if (parsed && typeof parsed === 'object' && Array.isArray(parsed.sources)) return parsed;
  throw new Error('TrueForge turn completed without a structured JSON source result');
}

function readSandboxResolutionProof(content) {
  const parsed = parsePossibleJson(content);
  if (!parsed || typeof parsed !== 'object'
    || !['resolved', 'unresolved'].includes(parsed.status)
    || !(parsed.newestIndex === null || Number.isInteger(parsed.newestIndex))
    || !Array.isArray(parsed.normalizedDates)
    || !parsed.normalizedDates.every(isNonEmptyString)) {
    throw new Error('TrueForge sandbox turn completed without a structured metadata resolution');
  }
  return parsed;
}

function validateResolverSources(sources) {
  if (!Array.isArray(sources) || sources.length < 2) {
    throw new Error('TrueForge sandbox resolver requires two independent sources');
  }
  const validated = sources.map((source) => {
    if (!source || typeof source !== 'object'
      || !isNonEmptyString(source.title)
      || !isSafeHttpUrl(source.url)
      || !isNonEmptyString(source.publishedAt)
      || Number.isNaN(Date.parse(source.publishedAt))) {
      throw new Error('TrueForge sandbox resolver requires a valid publishedAt for every source');
    }
    return {
      title: source.title.trim(),
      url: source.url.trim(),
      publishedAt: source.publishedAt.trim(),
    };
  });
  if (new Set(validated.map((source) => source.url)).size < 2) {
    throw new Error('TrueForge sandbox resolver requires two independent sources');
  }
  return validated;
}

function verifySandboxExecution({ events, sessionId, turnId, expectedCommand }) {
  if (!Array.isArray(events)) throw new Error('TrueForge did not return persisted events for sandbox verification');
  const created = events.find((event) => event?.type === 'sandbox.created' && isNonEmptyString(event.sandbox_id));
  let call;
  let callEvent;
  for (const event of events) {
    if (event?.type !== 'model.message' || !Array.isArray(event.tool_calls)) continue;
    const candidate = event.tool_calls.find((toolCall) => toolCall?.tool_info?.name === 'exec'
      && (toolCall.tool_info.type === 'truefoundry-system'
        || (toolCall.tool_info.type === 'mcp'
          && (toolCall.tool_info.server_id === 'sandbox'
            || String(toolCall.tool_info.server_name ?? '').toLowerCase() === 'sandbox'))));
    if (candidate) {
      call = candidate;
      callEvent = event;
      break;
    }
  }
  const response = call && events.find((event) => event?.type === 'tool.response'
    && event.tool_call_id === call.id
    && isNonEmptyString(event.content));
  if (!created || !call || !callEvent || !response) {
    throw new Error('TrueForge turn completed without verified sandbox execution evidence');
  }
  const callArguments = parsePossibleJson(call.function?.arguments ?? '');
  if (!callArguments || callArguments.command !== expectedCommand) {
    throw new Error('TrueForge sandbox exec command did not match the deterministic resolver command');
  }
  const responseBody = parsePossibleJson(response.content);
  if (!responseBody?.success || responseBody.response?.exitCode !== 0) {
    throw new Error('TrueForge sandbox exec did not complete successfully');
  }
  return {
    verified: true,
    sessionId,
    turnId,
    sandboxId: created.sandbox_id,
    toolCallId: call.id,
    eventIds: [created.id, callEvent.id, response.id],
  };
}

function parsePossibleJson(value) {
  const trimmed = value.trim();
  const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  try {
    return JSON.parse(match ? match[1] : trimmed);
  } catch {
    return null;
  }
}

function validateSources(sources, angle) {
  if (!Array.isArray(sources) || sources.length === 0) {
    throw new Error('TrueForge structured result must contain at least one source');
  }
  return sources.map((source) => {
    if (!source || typeof source !== 'object'
      || !isNonEmptyString(source.title)
      || !isSafeHttpUrl(source.url)
      || !isNonEmptyString(source.claim)
      || source.stance !== (angle === 'current' ? 'supports' : 'contradicts')) {
      throw new Error('TrueForge structured result contained an invalid source');
    }
    return {
      title: source.title.trim(),
      url: source.url.trim(),
      claim: source.claim.trim(),
      stance: source.stance,
      ...(typeof source.publishedAt === 'string' && normalizeDatePlaceholder(source.publishedAt)
        ? { publishedAt: source.publishedAt.trim() }
        : {}),
      ...(typeof source.html === 'string' ? { html: source.html } : {}),
      ...(source.headers && typeof source.headers === 'object' && !Array.isArray(source.headers) ? { headers: source.headers } : {}),
    };
  });
}

function readEnvelopeId(body) {
  const value = body?.data?.id;
  return isNonEmptyString(value) ? value : null;
}

function readError(body) {
  const value = body?.data?.state?.error
    ?? body?.data?.state?.message
    ?? body?.error?.message
    ?? body?.error
    ?? body?.message
    ?? body?.detail
    ?? 'unknown error';
  if (typeof value === 'string') return value;
  if (isNonEmptyString(value?.message)) return value.message;
  return JSON.stringify(value);
}

function assertAngle(angle) {
  if (angle !== 'current' && angle !== 'contradiction') throw new Error(`Unknown research angle: ${angle}`);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function readNonNegativeInteger(value, fallback) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function readPositiveInteger(value, fallback) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeDatePlaceholder(value) {
  const normalized = value.trim().toLowerCase();
  return normalized && !['n/a', 'na', 'none', 'unknown', 'unavailable'].includes(normalized);
}

function isSafeHttpUrl(value) {
  if (!isNonEmptyString(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
