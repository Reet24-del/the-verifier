import { createTrueForgeTurnRunner } from './research.js';

const MAX_RESPONSE_LENGTH = 4_000;
const MAX_CONTEXT_MESSAGES = 12;

export function createFixtureConversationResponder() {
  return async function fixtureResponder({ message, result }) {
    const normalized = message.trim().toLowerCase();
    if (requiresFreshResearch(normalized)) {
      return {
        text: 'That needs fresh public evidence. Choose Research again and I will rerun both opposing research angles while keeping this conversation.',
        requiresResearch: true,
      };
    }

    const evidence = result?.resolution?.evidence ?? [];
    const evidenceText = evidence
      .map((item) => `${item.title}: ${item.field} ${item.normalized ?? item.raw}`)
      .join('; ');
    const sources = (result?.findings ?? [])
      .flatMap((finding) => finding.sources ?? [])
      .map((source) => `${source.title} (${source.url})`)
      .join('; ');

    if (/\b(date|newer|newest|older|recent|why)\b/.test(normalized)) {
      return {
        text: `${result?.resolution?.message ?? 'The evidence remains unresolved.'} The machine-readable date evidence is ${evidenceText || 'insufficient.'}`,
        requiresResearch: false,
      };
    }
    if (/\b(source|citation|link|where)\b/.test(normalized)) {
      return { text: `The active investigation uses these sources: ${sources || 'no validated sources are available yet.'}`, requiresResearch: false };
    }
    return {
      text: `${result?.summary ?? 'No completed investigation is available.'} ${result?.resolution?.message ?? ''}`.trim(),
      requiresResearch: false,
    };
  };
}

export function createConversationResponderFromEnvironment(environment = process.env, options = {}) {
  const baseUrl = environment.TRUEFORGE_BASE_URL;
  const agentName = environment.TRUEFORGE_AGENT_NAME ?? environment.TRUEFORGE_AGENT_ID;
  if (!baseUrl || !agentName) return createFixtureConversationResponder();

  const runner = options.runner ?? createTrueForgeTurnRunner({
    baseUrl,
    agentName,
    token: environment.TRUEFORGE_TOKEN,
    fetchImpl: options.fetchImpl,
    timeoutMs: readPositiveInteger(environment.TRUEFORGE_TIMEOUT_MS, 45_000),
    pollIntervalMs: readNonNegativeInteger(environment.TRUEFORGE_POLL_INTERVAL_MS, 500),
  });
  return createTrueForgeConversationResponder({ runner });
}

export function createTrueForgeConversationResponder({ runner } = {}) {
  if (!runner || typeof runner.run !== 'function') {
    throw new Error('A TrueForge turn runner is required for live conversation');
  }

  return async function trueForgeResponder({ message, messages = [], brief, result }) {
    const prompt = conversationPrompt({ message, messages, brief, result });
    const { content } = await runner.run({ prompt });
    const parsed = parsePossibleJson(content);
    validateResponse(parsed, result);
    return { text: parsed.text.trim(), requiresResearch: parsed.requiresResearch };
  };
}

function conversationPrompt({ message, messages, brief, result }) {
  const boundedMessages = messages.slice(-MAX_CONTEXT_MESSAGES).map(({ role, text }) => ({ role, text }));
  return 'You are The Verifier follow-up assistant. Answer only from the supplied active evidence. '
    + 'Do not call tools, search the web, or introduce a source or fact not present in ACTIVE_RESULT. '
    + 'If the question needs newer evidence, a changed claim, or information outside ACTIVE_RESULT, set requiresResearch to true and explain that the user should choose Research again. '
    + 'Return JSON only with shape {"text":"...","requiresResearch":false}.\n\n'
    + `ACTIVE_BRIEF:\n${brief}\n\n`
    + `ACTIVE_RESULT:\n${JSON.stringify(result)}\n\n`
    + `RECENT_MESSAGES:\n${JSON.stringify(boundedMessages)}\n\n`
    + `USER_FOLLOW_UP:\n${message}`;
}

function validateResponse(response, result) {
  if (!response || typeof response !== 'object'
    || typeof response.text !== 'string'
    || !response.text.trim()
    || response.text.length > MAX_RESPONSE_LENGTH
    || typeof response.requiresResearch !== 'boolean') {
    throw new Error('TrueForge conversation response was not valid grounded JSON');
  }

  const allowedUrls = new Set((result?.findings ?? [])
    .flatMap((finding) => finding.sources ?? [])
    .map((source) => source.url));
  const mentionedUrls = response.text.match(/https?:\/\/[^\s)\]}>,]+/g) ?? [];
  if (mentionedUrls.some((url) => !allowedUrls.has(url.replace(/[.!?,;:]+$/, '')))) {
    throw new Error('TrueForge conversation response cited a source URL outside the active evidence');
  }
}

function parsePossibleJson(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  try {
    return JSON.parse(match ? match[1] : trimmed);
  } catch {
    return null;
  }
}

function requiresFreshResearch(message) {
  return /\b(research again|search (?:again|for)|latest available|new evidence|fresh evidence|check again|changed? claim|different claim|right now|today)\b/.test(message);
}

function readPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readNonNegativeInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}
