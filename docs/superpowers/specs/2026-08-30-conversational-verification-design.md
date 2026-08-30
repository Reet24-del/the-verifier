# Conversational Verification Design

**Date:** 2026-08-30  
**Status:** Approved design, awaiting specification review  
**Project:** The Verifier

## Purpose

Turn The Verifier's one-shot spoken brief into a continuing, evidence-grounded conversation without weakening the existing approval gate. The user should be able to ask follow-up questions about the current claim, sources, date metadata, and conclusion without repeating the original brief. A single voice-mode action should continue the listen/respond/listen cycle until the user stops it.

This design intentionally overrides the earlier one-shot, non-chat direction in the PRD and UI specification. The product remains a narrow verification assistant rather than a general-purpose chatbot: follow-ups must stay grounded in the active investigation, and fresh factual claims require an explicit research rerun.

## User experience

### Initial investigation

1. The user types a claim or selects **Start voice conversation** and speaks it.
2. The transcript appears as the first user message and remains editable until verification begins.
3. The existing two-angle investigation runs unchanged.
4. The assistant adds a conversational result message containing the conclusion, conflict, date evidence, and approval question.
5. The detailed source lanes, resolver table, approval gate, and dossier remain visible as the inspectable record behind the conversation.

### Follow-up conversation

- A conversation timeline shows user and assistant turns in chronological order.
- Follow-up text or speech is sent with the conversation ID. The server retrieves the active brief, result, evidence, resolution, and earlier messages.
- Ordinary follow-ups answer from the existing evidence. They do not invoke web research or introduce uncited facts.
- When the user changes the claim, asks for newer evidence, or wants another search, the assistant explains that fresh research is required and exposes **Research again**.
- **Research again** reruns both opposing research angles and replaces the active investigation while preserving the earlier transcript.
- Approval always applies to the currently active investigation. Starting fresh research invalidates any unused approval token from the prior investigation.

### Voice mode

- **Start voice conversation** begins one controlled loop: listen for one utterance, append its transcript, obtain the assistant response, narrate it, and automatically listen again.
- A persistent **Stop listening** control ends the loop immediately and prevents automatic re-arming.
- The loop pauses while research, approval, export, or narration is active.
- A silence/no-match result prompts once and then resumes listening. Permission denial, missing hardware, or a speech-service network failure stops voice mode and leaves text entry enabled.
- Browsers without a working Web Speech API receive the complete typed conversation experience. No external speech credential is required.

## Architecture

### Conversation record

The server owns an in-memory `Conversation` record:

```js
{
  id,
  createdAt,
  updatedAt,
  messages: [{ id, role, text, createdAt, kind }],
  activeInvestigation: {
    sessionId,
    brief,
    status,
    result,
    approvalToken
  }
}
```

`kind` is one of `brief`, `follow_up`, `result`, `answer`, `system`, or `approval`. Approval tokens are never returned by conversation-read endpoints or included in messages.

Conversation memory is ephemeral: it remains available while the server process lives. The browser stores only the opaque conversation ID in `sessionStorage`, allowing refresh recovery without writing the transcript to durable browser storage. If the server no longer knows the ID, the client clears it and starts a new conversation.

### Existing session boundary

The existing verification session remains the authority for workflow execution, one-time approval tokens, dossier persistence, and export. A conversation coordinates one active verification session at a time rather than replacing session security.

Fresh research creates a new verification session and marks it as the conversation's active investigation. Any prior unused approval token is invalidated before the new workflow starts. Saved dossiers remain immutable.

### Follow-up responder

Add an injected `conversationResponder` boundary:

```js
conversationResponder({ message, messages, brief, result })
```

- Fixture mode returns deterministic, evidence-grounded answers for the demo case and clearly declines unsupported claims.
- Live mode uses the configured TrueForge agent with a prompt containing the active evidence and bounded transcript. It must answer only from that payload, cite source titles/URLs already present, and request **Research again** when new evidence is needed.
- The responder returns `{ text, requiresResearch }`.
- Malformed, empty, or ungrounded responses fail closed with an actionable typed message; they never silently invent evidence.

The transcript supplied to live follow-ups is capped to the latest 12 messages plus the full active result, preventing unbounded context growth while retaining the original claim and evidence.

## HTTP API

Existing session routes remain supported for backward compatibility.

### `POST /api/conversations`

Input:

```json
{ "brief": "Verify that Brian Niccol is CEO of Starbucks." }
```

Creates the conversation, appends the initial user message, creates a verification session, runs the existing workflow, and appends the result/approval message. Returns the public conversation, active workflow result, and approval token in a dedicated top-level `approval` object.

### `GET /api/conversations/:id`

Returns the public transcript and active investigation without any approval token. This restores the UI after refresh. A missing in-memory conversation returns `404 conversation_not_found`.

### `POST /api/conversations/:id/messages`

Input:

```json
{ "message": "Which source is newer and why?" }
```

Appends the user turn, invokes the grounded responder, appends the assistant answer, and returns both new messages plus `requiresResearch`.

### `POST /api/conversations/:id/research`

Input:

```json
{ "brief": "Check the same claim for the latest available evidence." }
```

Invalidates any pending approval for the previous active investigation, creates a new verification session, runs both research angles, updates the active investigation, and appends a new result message. Returns the new workflow result and approval token.

### Approval and export

The existing session approval and dossier routes remain unchanged. The client reads the active `sessionId` from the conversation and submits the server-issued token exactly once. After approval, the conversation receives an `approval` message and the persisted dossier includes a snapshot of the conversation transcript through that approval.

## Frontend components and state

`App.jsx` will coordinate a small set of focused modules rather than accumulating all conversation logic in the page component:

- `ConversationThread`: renders chronological, accessible user/assistant messages.
- `ConversationComposer`: shared text field, send action, voice-mode control, and **Research again** action.
- `useVoiceConversation`: owns start/stop state and the listen/respond/narrate/re-arm loop.
- `verifierApi`: adds conversation create/read/message/research methods.
- Existing evidence, resolver, approval, and dossier components continue to render the active investigation.

The app stores `conversationId`, `messages`, `activeInvestigation`, `requiresResearch`, and `voiceMode`. It keeps the current typed draft separate from the verified brief so follow-up text never accidentally overwrites the active claim.

The conversation thread uses a polite live region for new assistant messages. Automatic focus remains in the composer during typed use; voice mode does not steal focus from approval controls.

## State transitions

```text
new
  -> investigating
  -> awaiting_approval
  -> discussing <-> awaiting_approval
  -> research_required
  -> investigating (Research again)
  -> saved | rejected
```

Voice mode is orthogonal: `off -> listening -> processing -> narrating -> listening`, with any fatal speech error returning it to `off`.

Starting a follow-up does not change the active investigation's approval eligibility. Starting fresh research does.

## Error handling

- Backend unavailable: retain the draft and transcript already rendered; show a specific retry action.
- Conversation expired: clear the stale session ID, preserve the current draft, and offer to begin a new conversation.
- Follow-up responder failure: append no assistant claim; show a retryable system message.
- Speech permission/service failure: stop auto-listening, announce the reason, and retain typed input.
- Research rerun failure: keep the previous evidence visible and eligible for discussion; do not issue a new approval token.
- Approval failure: retain the active result and return to the approval checkpoint.

## Security and privacy

- Conversation IDs and message IDs use `crypto.randomUUID()`.
- The public conversation representation never exposes approval tokens.
- Follow-up messages cannot call approval, persistence, or export implicitly.
- Only the explicit approval endpoint can persist a dossier.
- No conversation transcript is written to disk before approval.
- Live follow-up prompts contain only the current conversation and public evidence, never provider credentials.
- Input length limits apply to each message and the total retained transcript.

## Testing

### Server

- Conversation creation runs one investigation and returns a dedicated approval token.
- Public conversation reads omit the approval token.
- Follow-ups receive the original brief, result, and bounded transcript.
- Follow-ups do not rerun research.
- Research again invalidates the prior pending token and creates a new active session.
- Refresh recovery returns messages and the active investigation.
- Approval persists only the active investigation and transcript snapshot.
- Expired, malformed, oversized, and missing conversation inputs fail safely.

### Client

- Initial verification renders a user turn and assistant result.
- Multiple follow-ups retain the original claim and earlier messages.
- `requiresResearch` reveals **Research again** without silently searching.
- Refresh restores an active conversation from `sessionStorage` and the server.
- Text conversation works with voice unavailable.
- Starting voice mode re-arms after a successful response; stopping it prevents re-arming.
- Fatal speech errors stop the loop and preserve the composer.
- Approval and export remain gated after conversational changes.

### Rendered QA

- Desktop and mobile conversation layouts remain readable alongside evidence.
- The flow `initial brief -> result -> follow-up -> answer -> Research again -> new result -> approve -> export` completes without console errors.
- Safari/Chrome voice mode is manually rehearsed; the in-app browser validates typed fallback and fatal speech handling.

## Acceptance criteria

1. The user can ask at least three follow-up questions without repeating the original claim.
2. Every follow-up answer identifies the current evidence context and introduces no uncited factual source.
3. Ordinary follow-ups make no new research workflow call.
4. **Research again** runs both opposing angles and preserves the earlier transcript.
5. One **Start voice conversation** action supports repeated turns until **Stop listening** or a fatal browser speech failure.
6. Page refresh restores the conversation while the server session remains alive.
7. Approval, persistence, and export remain server-enforced and scoped to the active investigation.
8. The existing credential-free fixture, live TrueForge rehearsal, test suite, and production build continue to pass.

## Out of scope

- General knowledge chat unrelated to the active verification.
- Durable account-level conversation history.
- Multiple simultaneous active investigations in one conversation.
- Background microphone capture after the user stops voice mode.
- Saving or exporting an unapproved transcript.
