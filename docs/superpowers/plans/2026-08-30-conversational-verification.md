# Conversational Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an evidence-grounded, multi-turn text and voice conversation that remembers the active verification, reruns research only on explicit request, and preserves the existing server approval and export boundary.

**Architecture:** A server-owned in-memory conversation coordinates one active verification session and a bounded message transcript. Follow-ups use an injected evidence-grounded responder; explicit research reruns create a new active verification session and invalidate pending approval. React adds focused conversation components and a voice-loop hook while continuing to render the existing evidence workspace.

**Tech Stack:** Node.js HTTP server, React, Vite, Web Speech API, Node test runner, Vitest, Testing Library

**Spec:** `docs/superpowers/specs/2026-08-30-conversational-verification-design.md`

## Global Constraints

- Conversation memory is server-held and ephemeral; the browser stores only the opaque ID in `sessionStorage`.
- Follow-up responses may use only the active result and bounded transcript; new factual research requires explicit **Research again**.
- Approval tokens never appear in public conversation reads or transcript messages.
- Only the existing explicit approval endpoint may write a dossier.
- Starting fresh research invalidates the previous active investigation's unused approval token.
- Voice mode stops on fatal browser speech errors and always retains typed input.
- Keep existing session routes working for backward compatibility.
- Add no runtime dependency unless the existing platform cannot implement the requirement.

---

### Task 1: Conversation store and public representation

**Files:**
- Create: `server/conversationStore.js`
- Create: `test/conversationStore.test.js`

**Interfaces:**
- Produces: `createConversationStore({ idFactory?, now?, maxMessages? })`
- Store methods: `create({ brief })`, `get(id)`, `append(id, { role, text, kind })`, `setActiveInvestigation(id, investigation)`, `invalidatePendingApproval(id)`, `publicView(id)`
- `publicView` returns `{ id, messages, activeInvestigation }` without `approvalToken`.

- [ ] **Step 1: Write failing creation and redaction tests**

```js
const store = createConversationStore({
  idFactory: () => 'conversation-1',
  now: () => '2026-08-30T12:00:00.000Z',
});
const conversation = store.create({ brief: 'Verify the Starbucks CEO.' });
store.setActiveInvestigation(conversation.id, {
  sessionId: 'session-1', status: 'awaiting_approval', result: { status: 'resolved' }, approvalToken: 'secret',
});
assert.equal(store.publicView(conversation.id).messages[0].text, 'Verify the Starbucks CEO.');
assert.equal('approvalToken' in store.publicView(conversation.id).activeInvestigation, false);
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test test/conversationStore.test.js`  
Expected: FAIL because `server/conversationStore.js` does not exist.

- [ ] **Step 3: Implement the store with validation and bounded history**

```js
export function createConversationStore({ idFactory = randomUUID, now = () => new Date().toISOString(), maxMessages = 50 } = {}) {
  const conversations = new Map();
  const requireConversation = (id) => {
    const conversation = conversations.get(id);
    if (!conversation) throw new Error('Conversation not found');
    return conversation;
  };
  return {
    create({ brief }) {
      const id = idFactory();
      const createdAt = now();
      const conversation = { id, createdAt, updatedAt: createdAt, messages: [], activeInvestigation: null };
      conversations.set(id, conversation);
      this.append(id, { role: 'user', text: brief.trim(), kind: 'brief' });
      return conversation;
    },
    get(id) { return conversations.get(id); },
    append(id, { role, text, kind }) {
      const conversation = requireConversation(id);
      const createdAt = now();
      conversation.messages.push({ id: idFactory(), role, text: text.trim(), kind, createdAt });
      conversation.messages = conversation.messages.slice(-maxMessages);
      conversation.updatedAt = createdAt;
      return conversation.messages.at(-1);
    },
    setActiveInvestigation(id, investigation) {
      const conversation = requireConversation(id);
      conversation.activeInvestigation = structuredClone(investigation);
      conversation.updatedAt = now();
    },
    invalidatePendingApproval(id) {
      const investigation = requireConversation(id).activeInvestigation;
      if (investigation) {
        investigation.approvalToken = undefined;
        investigation.status = 'replaced';
      }
    },
    publicView(id) {
      const conversation = structuredClone(requireConversation(id));
      if (conversation.activeInvestigation) delete conversation.activeInvestigation.approvalToken;
      return conversation;
    },
  };
}
```

- [ ] **Step 4: Add tests for missing IDs, message limits, and token invalidation**

```js
assert.throws(() => store.append('missing', { role: 'user', text: 'hello', kind: 'follow_up' }), /Conversation not found/);
store.invalidatePendingApproval('conversation-1');
assert.equal(store.get('conversation-1').activeInvestigation.approvalToken, undefined);
```

- [ ] **Step 5: Run tests and commit**

Run: `node --test test/conversationStore.test.js`  
Expected: all tests PASS.

```bash
git add server/conversationStore.js test/conversationStore.test.js
git commit -m "Add ephemeral conversation store"
```

### Task 2: Reusable TrueForge turn runner and grounded responder

**Files:**
- Modify: `server/research.js`
- Create: `server/conversationResponder.js`
- Modify: `test/research.test.js`
- Create: `test/conversationResponder.test.js`

**Interfaces:**
- Produces: `createTrueForgeTurnRunner({ baseUrl, agentName, token?, fetchImpl?, timeoutMs?, pollIntervalMs? })`
- Runner method: `run({ prompt }) -> Promise<{ content, sessionId, turnId }>`
- Produces: `createFixtureConversationResponder()` and `createConversationResponderFromEnvironment(environment, options)`
- Responder signature: `({ message, messages, brief, result }) -> Promise<{ text, requiresResearch }>`

- [ ] **Step 1: Write a failing reusable-turn HTTP contract test**

```js
const runner = createTrueForgeTurnRunner({ baseUrl: fake.baseUrl, agentName: 'verifier-researcher', pollIntervalMs: 0 });
const answer = await runner.run({ prompt: 'Answer only from supplied evidence.' });
assert.equal(answer.content, '{"text":"Grounded answer","requiresResearch":false}');
assert.equal(fake.requests[1].body.input[0].content, 'Answer only from supplied evidence.');
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test --test-name-pattern='reusable TrueForge turn runner' test/research.test.js`  
Expected: FAIL because the export is missing.

- [ ] **Step 3: Extract session/turn/poll transport without changing research behavior**

Implement `createTrueForgeTurnRunner`; make `createTrueForgeResearchAdapter().research()` call it, then continue parsing and validating the existing source JSON exactly as before.

- [ ] **Step 4: Run all research tests**

Run: `node --test test/research.test.js`  
Expected: all existing and new tests PASS.

- [ ] **Step 5: Write failing responder tests**

```js
const fixture = createFixtureConversationResponder();
const answer = await fixture({
  message: 'Which source is newer and why?',
  messages: [],
  brief: 'Verify the Starbucks CEO.',
  result: resolvedFixture,
});
assert.match(answer.text, /2024-08-13/);
assert.equal(answer.requiresResearch, false);

const refresh = await fixture({ message: 'Search for newer evidence', messages: [], brief: 'x', result: resolvedFixture });
assert.equal(refresh.requiresResearch, true);
```

- [ ] **Step 6: Implement fixture and live responders**

The live prompt must include the active brief, full result JSON, and only the last 12 messages. Require JSON-only output:

```json
{"text":"Answer grounded in the supplied sources.","requiresResearch":false}
```

Reject missing text, non-boolean `requiresResearch`, source URLs not present in the result, and responses longer than 4000 characters.

- [ ] **Step 7: Run tests and commit**

Run: `node --test test/research.test.js test/conversationResponder.test.js`  
Expected: all tests PASS.

```bash
git add server/research.js server/conversationResponder.js test/research.test.js test/conversationResponder.test.js
git commit -m "Add grounded conversation responder"
```

### Task 3: Conversation HTTP API and approval integration

**Files:**
- Modify: `server/app.js`
- Modify: `server/index.js`
- Modify: `test/server.test.js`

**Interfaces:**
- Extend `createServer({ workflow, dossierDirectory, conversationStore, conversationResponder })`
- Add `POST /api/conversations`
- Add `GET /api/conversations/:id`
- Add `POST /api/conversations/:id/messages`
- Add `POST /api/conversations/:id/research`
- Existing approval response remains compatible and appends approval state to the mapped conversation.

- [ ] **Step 1: Write failing conversation creation/read tests**

```js
const response = await app.request('/api/conversations', jsonRequest({ brief: 'Verify the Starbucks CEO.' }));
assert.equal(response.status, 201);
const body = await response.json();
assert.equal(body.conversation.messages[0].role, 'user');
assert.equal(body.conversation.activeInvestigation.status, 'awaiting_approval');
assert.match(body.approval.token, /^[0-9a-f-]{36}$/i);
const restored = await (await app.request(`/api/conversations/${body.conversation.id}`)).json();
assert.equal(restored.conversation.messages.length, 2);
assert.equal(JSON.stringify(restored).includes(body.approval.token), false);
```

- [ ] **Step 2: Run the focused server tests and verify RED**

Run: `node --test --test-name-pattern='conversation' test/server.test.js`  
Expected: FAIL with route status 404.

- [ ] **Step 3: Implement create/read routes using the existing workflow**

Factor the existing workflow transition into an internal `runSessionWorkflow(session)` helper used by both legacy and conversation routes. Keep legacy response envelopes unchanged.

- [ ] **Step 4: Write failing follow-up and research-rerun tests**

```js
const followUp = await app.request(`/api/conversations/${id}/messages`, jsonRequest({ message: 'Which source is newer?' }));
assert.equal((await followUp.json()).requiresResearch, false);
assert.equal(workflowCalls.length, 1);

const rerun = await app.request(`/api/conversations/${id}/research`, jsonRequest({ brief: 'Check for newer evidence.' }));
assert.equal(rerun.status, 200);
assert.equal(workflowCalls.length, 2);
assert.notEqual((await rerun.json()).conversation.activeInvestigation.sessionId, firstSessionId);
```

- [ ] **Step 5: Implement messages/research routes and input limits**

Reject empty messages and messages over 2000 characters with `400 invalid_request`. On responder failure, return `502 conversation_failed` without appending an assistant claim. On research failure, restore the prior active investigation and issue no new token.

- [ ] **Step 6: Write failing approval transcript and stale-token tests**

Assert that research rerun rejects the previous token, approval persists the active result, and the saved dossier contains `conversation.messages` only after valid approval.

- [ ] **Step 7: Implement approval mapping and run all server tests**

Run: `node --test test/server.test.js`  
Expected: all tests PASS, including all legacy route tests.

- [ ] **Step 8: Wire environment responder and commit**

`server/index.js` creates the responder from the same TrueForge environment used by research and passes it to `createServer`.

```bash
git add server/app.js server/index.js test/server.test.js
git commit -m "Add conversational verification API"
```

### Task 4: Browser conversation API and refresh recovery

**Files:**
- Modify: `src/lib/verifierApi.js`
- Create: `src/lib/conversationStorage.js`
- Modify: `test/verifierApi.test.js`
- Create: `test/conversationStorage.test.js`

**Interfaces:**
- `createConversation({ brief, fetchImpl?, apiBaseUrl? })`
- `getConversation({ conversationId, fetchImpl?, apiBaseUrl? })`
- `sendConversationMessage({ conversationId, message, fetchImpl?, apiBaseUrl? })`
- `researchConversationAgain({ conversationId, brief, fetchImpl?, apiBaseUrl? })`
- `createConversationStorage(storage = globalThis.sessionStorage)` with `read()`, `write(id)`, `clear()`.

- [ ] **Step 1: Write failing API-envelope tests**

```js
await createConversation({ brief: 'Verify x', fetchImpl });
assert.equal(calls[0].url, '/api/conversations');
assert.deepEqual(JSON.parse(calls[0].options.body), { brief: 'Verify x' });
```

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test test/verifierApi.test.js test/conversationStorage.test.js`  
Expected: FAIL because exports/modules are missing.

- [ ] **Step 3: Implement API calls and safe session storage**

Storage key: `the-verifier-conversation-id`. Treat storage exceptions as no-op so private browsing cannot break the app.

- [ ] **Step 4: Run tests and commit**

Run: `node --test test/verifierApi.test.js test/conversationStorage.test.js`  
Expected: all tests PASS.

```bash
git add src/lib/verifierApi.js src/lib/conversationStorage.js test/verifierApi.test.js test/conversationStorage.test.js
git commit -m "Add conversation client and refresh storage"
```

### Task 5: Conversation thread and composer UI

**Files:**
- Create: `src/components/ConversationThread.jsx`
- Create: `src/components/ConversationComposer.jsx`
- Modify: `src/styles.css`
- Create: `test/ui/ConversationThread.test.jsx`
- Create: `test/ui/ConversationComposer.test.jsx`

**Interfaces:**
- `ConversationThread({ messages, busy })`
- `ConversationComposer({ draft, onDraftChange, onSend, onResearchAgain, requiresResearch, voiceAvailable, voiceMode, onStartVoice, onStopVoice, disabled })`

- [ ] **Step 1: Write failing accessible component tests**

```jsx
render(<ConversationThread messages={[{ id: '1', role: 'user', text: 'Which source is newer?' }]} />);
expect(screen.getByRole('log', { name: /conversation/i })).toBeTruthy();
expect(screen.getByText('Which source is newer?')).toBeTruthy();

render(<ConversationComposer requiresResearch voiceMode="listening" onStopVoice={stop} />);
expect(screen.getByRole('button', { name: /research again/i })).toBeTruthy();
expect(screen.getByRole('button', { name: /stop listening/i })).toBeTruthy();
```

- [ ] **Step 2: Run component tests and verify RED**

Run: `npx vitest run test/ui/ConversationThread.test.jsx test/ui/ConversationComposer.test.jsx`  
Expected: FAIL because components are missing.

- [ ] **Step 3: Implement semantic components**

Use `role="log"`, `aria-live="polite"`, explicit user/assistant labels, a labeled textarea, native buttons, and an inline processing message. Keep the detailed evidence panels outside the chat transcript.

- [ ] **Step 4: Add responsive styles**

Desktop: thread max-height 420px inside the primary column; messages use constrained 72% width. Mobile: messages use 92% width and composer actions stack. Reuse existing midnight, amber, red, green, border, and type tokens.

- [ ] **Step 5: Run component tests and commit**

Run: `npx vitest run test/ui/ConversationThread.test.jsx test/ui/ConversationComposer.test.jsx`  
Expected: all tests PASS.

```bash
git add src/components src/styles.css test/ui/ConversationThread.test.jsx test/ui/ConversationComposer.test.jsx
git commit -m "Add conversational verifier interface"
```

### Task 6: Automatic voice conversation loop

**Files:**
- Create: `src/hooks/useVoiceConversation.js`
- Create: `test/ui/useVoiceConversation.test.jsx`
- Modify: `src/lib/speech.js`
- Modify: `test/speech.test.js`

**Interfaces:**
- `useVoiceConversation({ voice, enabled, busy, onTranscript, onFatalError })`
- Returns `{ state, start, stop }`, where state is `off | listening | processing | narrating`.
- Add `isFatalSpeechError(error)` in `speech.js` for permission, hardware, unsupported, and service-network failures.

- [ ] **Step 1: Write failing hook test for automatic re-arming**

```jsx
const voice = { recognitionSupported: true, listen: vi.fn().mockResolvedValueOnce('first').mockResolvedValueOnce('second') };
const onTranscript = vi.fn().mockResolvedValue(undefined);
const { result } = renderHook(() => useVoiceConversation({ voice, enabled: true, busy: false, onTranscript }));
act(() => result.current.start());
await waitFor(() => expect(onTranscript).toHaveBeenCalledWith('first'));
await waitFor(() => expect(voice.listen).toHaveBeenCalledTimes(2));
```

- [ ] **Step 2: Run hook test and verify RED**

Run: `npx vitest run test/ui/useVoiceConversation.test.jsx`  
Expected: FAIL because the hook is missing.

- [ ] **Step 3: Implement abort-safe loop**

Use refs for active state and generation ID. After each successful `onTranscript`, re-arm only when active, not busy, and the generation still matches. `stop()` increments generation so any pending promise cannot restart listening.

- [ ] **Step 4: Add fatal/nonfatal and stop tests**

Test that silence/no-match retries once, fatal service errors call `onFatalError` and stop, and `stop()` during processing prevents a second `listen()` call.

- [ ] **Step 5: Run tests and commit**

Run: `node --test test/speech.test.js && npx vitest run test/ui/useVoiceConversation.test.jsx`  
Expected: all tests PASS.

```bash
git add src/hooks/useVoiceConversation.js src/lib/speech.js test/speech.test.js test/ui/useVoiceConversation.test.jsx
git commit -m "Add continuous voice conversation loop"
```

### Task 7: Integrate conversation into the verification workspace

**Files:**
- Modify: `src/App.jsx`
- Modify: `test/ui/App.test.jsx`
- Modify: `src/styles.css`

**Interfaces:**
- App uses the APIs from Task 4, components from Task 5, and hook from Task 6.
- Existing `api` injection expands to `createConversation`, `getConversation`, `sendConversationMessage`, `researchConversationAgain`, `submitApproval`, and `getDossier`.

- [ ] **Step 1: Write failing multi-turn memory test**

```jsx
await user.click(screen.getByRole('button', { name: /verify brief/i }));
await user.type(screen.getByRole('textbox', { name: /message the verifier/i }), 'Which source is newer?');
await user.click(screen.getByRole('button', { name: /send/i }));
expect(await screen.findByText('The August source is newer.')).toBeTruthy();
expect(api.sendConversationMessage).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'conversation-1' }));
```

- [ ] **Step 2: Run focused test and verify RED**

Run: `npx vitest run test/ui/App.test.jsx -t 'retains evidence across follow-up turns'`  
Expected: FAIL because the conversation composer is absent.

- [ ] **Step 3: Integrate initial creation, transcript, and follow-ups**

Replace one-shot `runVerification` use in the primary path with `createConversation`. Preserve the returned session/result/token fields for existing evidence and approval rendering. Append follow-up responses without clearing those fields.

- [ ] **Step 4: Write and implement refresh-recovery test**

On mount, read the stored conversation ID and call `getConversation`. On 404/expired error, clear storage and return to ready state without discarding the typed draft.

- [ ] **Step 5: Write and implement Research again test**

Assert that `requiresResearch` shows the action, clicking it calls `researchConversationAgain`, changes the active session/token/result, preserves old messages, and disables export until the new result is approved.

- [ ] **Step 6: Integrate voice loop**

Initial voice transcript populates and submits the brief. Later transcripts send follow-up messages. Assistant result/follow-up text is narrated; after narration the hook automatically listens again. **Stop listening** prevents re-arm.

- [ ] **Step 7: Re-run all App tests**

Run: `npx vitest run test/ui/App.test.jsx`  
Expected: all legacy approval/export tests plus new conversation tests PASS.

- [ ] **Step 8: Commit**

```bash
git add src/App.jsx src/styles.css test/ui/App.test.jsx
git commit -m "Integrate conversational verification workflow"
```

### Task 8: Documentation, full verification, and rendered QA

**Files:**
- Modify: `README.md`
- Modify: `design.md`
- Modify: `docs/live-rehearsal.md` only if a fresh live follow-up rehearsal is completed

**Interfaces:**
- No new runtime interface; this task verifies and documents the completed feature.

- [ ] **Step 1: Update product and usage documentation**

Document conversation memory lifetime, **Research again**, typed fallback, voice loop browser support, and the unchanged approval/export boundary. Replace the old statement that the workspace is not a chat application with the new narrow evidence-conversation model.

- [ ] **Step 2: Run the complete automated suite**

Run: `npm test`  
Expected: zero failures across Node and Vitest suites.

- [ ] **Step 3: Run production checks**

Run: `npm run build && git diff --check`  
Expected: Vite build exits 0 and diff check emits no output.

- [ ] **Step 4: Rendered desktop QA**

At `http://localhost:5173`, exercise:

```text
initial brief -> result -> three grounded follow-ups -> Research again -> new result -> approve -> export
```

Confirm page identity, meaningful DOM, no error overlay, zero relevant console errors/warnings, message continuity, source count, approval unlock, and export gating.

- [ ] **Step 5: Rendered mobile QA**

At a 390×844 viewport, confirm conversation messages, composer controls, evidence panels, resolver table scrolling, and approval actions do not clip or overlap.

- [ ] **Step 6: Voice rehearsal**

In Safari or Chrome, confirm one **Start voice conversation** action captures two successive turns and **Stop listening** prevents a third. In the in-app browser, confirm fatal service failure stops voice mode and leaves the typed composer enabled.

- [ ] **Step 7: Commit and push**

```bash
git add README.md design.md docs/live-rehearsal.md
git commit -m "Document conversational verification"
git push origin HEAD:main
```

- [ ] **Step 8: Final evidence check**

Run: `git fetch origin main && git status --short --branch && git rev-parse HEAD && git rev-parse origin/main`  
Expected: clean status with identical local and remote revisions.
