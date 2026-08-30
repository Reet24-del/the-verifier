import { resolveMetadata } from '../src/lib/dateMetadata.js';

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
  const serialResearch = environment.TRUEFORGE_SERIAL_RESEARCH === '1';
  const betweenAnglesMs = readNonNegativeInteger(environment.TRUEFORGE_BETWEEN_ANGLES_MS, 0);
  const timeoutMs = readPositiveInteger(environment.TRUEFORGE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const pollIntervalMs = readNonNegativeInteger(environment.TRUEFORGE_POLL_INTERVAL_MS, DEFAULT_POLL_INTERVAL_MS);

  if (baseUrl && agentName) {
    return createTrueForgeResearchAdapter({
      baseUrl,
      agentName,
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
    const resolution = resolver(sources);
    const hasConflict = current.sources.some((source) => source.stance === 'supports')
      && contradiction.sources.some((source) => source.stance === 'contradicts');

    return {
      mode: adapter.mode ?? 'live',
      status: resolution.status,
      findings,
      resolution,
      summary: hasConflict
        ? `Conflicting public sources were found. ${resolution.message}`
        : 'The research lanes did not return a demonstrable contradiction.',
    };
  };
}

export function createTrueForgeResearchAdapter({
  baseUrl,
  agentName,
  agentId,
  token,
  serialResearch = false,
  betweenAnglesMs = 0,
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
    mode: 'trueforge',
    serialResearch,
    betweenAnglesMs,
    async research({ angle, brief }) {
      assertAngle(angle);
      if (!isNonEmptyString(brief)) throw new Error('A non-empty brief is required for live research');

      const session = await requestJson(fetchImpl, `${apiUrl}/sessions`, {
        method: 'POST', headers, body: JSON.stringify({ agent: { name: configuredAgentName } }),
      }, timeoutMs);
      const sessionId = readEnvelopeId(session);
      if (!sessionId) throw new Error('TrueForge session response did not include data.id');

      const startedTurn = await requestJson(fetchImpl, `${apiUrl}/sessions/${encodeURIComponent(sessionId)}/turns`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          input: [{ type: 'user.message', content: researchPrompt({ angle, brief }) }],
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
      const structured = readStructuredResult(completedTurn);
      const sources = validateSources(structured.sources, angle);

      return { angle, sources, sessionId, turnId };
    },
  };
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

function readStructuredResult(turn) {
  const content = turn?.data?.state?.output?.content;
  if (typeof content !== 'string') {
    throw new Error('TrueForge turn completed without a structured JSON source result');
  }
  const parsed = parsePossibleJson(content);
  if (parsed && typeof parsed === 'object' && Array.isArray(parsed.sources)) return parsed;
  throw new Error('TrueForge turn completed without a structured JSON source result');
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
