# PRD: The Verifier
**Voice-briefed, contradiction-aware fact verification agent**  
Built for the TrueForge "Agent Harness" Hackathon (WeMakeDevs × TrueFoundry) — Aug 24–30, 2026

---

## 1. Problem Statement

Before a high-stakes meeting — an interview, a deal, a first conversation with a source — people rely on a quick manual search to sanity-check who they're about to talk to. That search is shallow: it surfaces whatever ranks first, not what's *current* or *contradicted*. Nobody has time to cross-reference five sources and reconcile publication history before walking into a room.

**The Verifier** takes a single spoken brief — a name and a claim — and returns a verified, dated, source-backed answer in under a minute, with a human sign-off gate before anything is saved or shared.

This is explicitly **not** a general research assistant. It does one narrow job well: catch contradictions between sources and resolve them with evidence, not vibes.

---

## 2. Goals

- Demonstrate genuine harness usage: MCP tool calls, sandboxed code execution, and a real (not cosmetic) human-approval gate
- Produce a working, narrow, demoable loop — not a broad, half-built platform
- Make the agent's reasoning visible and audible at every step (voice narration + on-screen state)
- Resolve at least one class of factual contradiction using deterministic, sandboxed source-date metadata extraction rather than LLM judgment alone

## 3. Non-Goals

- Not a general-purpose research/OSINT tool
- Not attempting multiple resolver types (WHOIS/domain age, credential checks, etc.) — source-date metadata extraction is the one resolver, done well
- Not persisting user data beyond the single session/dossier being built
- Not handling private/authenticated sources — public web only

---

## 4. Primary User Story

> "I'm meeting [name] in an hour. They're claiming [specific claim]. Check that for me before I walk in."

The user speaks this once. The agent investigates, finds and resolves a contradiction if one exists, reads back its conclusion, and asks for explicit confirmation before saving the brief.

**Acceptance criteria:**

- Agent accepts a spoken name + claim and confirms it understood correctly before proceeding
- Two independent subagents research the claim from different angles (confirming vs. contradiction-seeking)
- If sources disagree, the disagreement is surfaced explicitly — never silently resolved by picking one source
- A sandboxed script extracts and compares each source's publication and modification metadata; the result is displayed as evidence, not inferred by the model
- If no trustworthy metadata is available, the agent reports that the conflict is unresolved rather than claiming a winner
- Nothing is saved or leaves the system until the user gives explicit verbal confirmation after hearing the conclusion
- The full loop completes in under 3 minutes for the pinned demo case

---

## 5. System Architecture

### 5.1 Agents

| Agent | Role | Tools |
|---|---|---|
| **Orchestrator** | Parses voice input, spawns subagents, detects contradiction, triggers sandbox resolver, owns the approval gate, narrates via TTS | STT/TTS, subagent delegation |
| **Subagent A — Current Claim Finder** | Finds the most recent public source stating the claim as true | MCP web search, MCP fetch |
| **Subagent B — Contradiction Hunter** | Actively searches for conflicting information (older title, past claim, lapsed status) | MCP web search, MCP fetch |

Subagents run in parallel and return structured output: `{claim, source_url, published_date, modified_date, date_evidence}`. `date_evidence` records the metadata field or page signal found, if any.

### 5.2 Contradiction Detection

Orchestrator compares Subagent A and B outputs. If claims conflict on the same underlying fact → escalate to the sandbox resolver. If they agree → skip the resolver and proceed directly to the approval gate.

### 5.3 Sandbox Resolver — Source-Date Metadata Extraction

The sandbox runs a deterministic script against the raw HTML from both cited sources. It extracts date signals in a fixed priority order:

1. `datePublished` / `dateModified` from JSON-LD structured data
2. Open Graph article timestamps (`article:published_time`, `article:modified_time`)
3. Standard HTML metadata (`date`, `pubdate`, `last-modified`)
4. A machine-readable HTTP `Last-Modified` header, labeled as a weaker signal

The script normalizes valid dates to ISO 8601, records the field that produced each value, and compares the evidence. It does not decide whether a claim is true: it deterministically reports which cited source has the newest strong publication/update signal and whether the available evidence is insufficient or ambiguous. The orchestrator explains that evidence and makes the final user-facing conclusion traceable to it.

**Resolution policy:**

- Prefer a newer `dateModified` only when it is present in structured or Open Graph metadata and is later than the corresponding publication date.
- Otherwise compare `datePublished` values.
- Do not treat a page's visible date alone as authoritative unless it matches an extracted metadata value.
- Treat HTTP headers as corroboration, not sole proof.
- If values are missing, contradictory, unparseable, or too weak to resolve the conflict, return **Unresolved — needs human review**. Never fabricate recency.

This resolver is deliberately the only contradiction-resolution mechanism. It is fast, demoable, source-specific, and avoids the rate limits and weak relevance of WHOIS/domain-age lookups.

### 5.4 Approval Gate

- Orchestrator composes and reads back (TTS): what was found, the contradiction, the metadata evidence, the resolution or unresolved state, and the intended action (save/send the brief)
- Execution genuinely blocks (not a UI-only "waiting" state) until the user confirms via voice (STT)
- On confirmation → dossier is written/saved
- On rejection → agent asks what to adjust and does not act

---

## 6. Demo Script (target: under 3 minutes)

1. **User:** "I'm meeting [name] in an hour — they're claiming [claim]. Check that for me."
2. **Agent:** "Checking two angles on this now." *(subagents visibly running)*
3. **Agent:** "I found a conflict. [Source A] says X; [Source B] says Y. I’m checking each source’s machine-readable publication history." *(sandbox step visibly running)*
4. **Agent:** "The sandbox found [Source A]'s `dateModified` as [ISO date] and [Source B]'s `datePublished` as [ISO date]. [Resolution], based on that metadata. I'd like to save this as your brief — can I go ahead?"
5. **User:** "Yes."
6. **Agent:** "Saved."

For an unresolved case, step 4 changes to: "The sources conflict, but their date metadata is insufficient to establish which is current. I’ve marked this unresolved for your review. Would you like me to save that brief?"

---

## 7. Judging Criteria Mapping

| Criterion | How this project addresses it |
|---|---|
| Potential impact | Real pre-meeting/due-diligence use case, not hackathon-only |
| Creativity/originality | Voice-first interrogation of an agent's findings; adversarial subagent pairing; evidence-first contradiction resolution |
| Technical excellence | Multi-agent orchestration + deterministic, sandboxed metadata extraction with an explicit unresolved state |
| Use of sponsor tools | MCP tools central to both subagents; TrueForge harness owns delegation, sandbox execution, and approval gate; Qodo reviews all PRs across the build week |
| Control and safety | Genuine execution block before any save/send action — demoed on camera, not just claimed |
| Presentation | Three-act demo structure (setup → tension/contradiction → metadata resolution + gate) |

---

## 8. Build Plan (6 days to Aug 30, 8:00 PM London)

| Day | Focus |
|---|---|
| 1 | TrueForge harness running, repo public, Qodo installed, voice I/O skeleton (reuse ai-voice-assistant pipeline) |
| 2 | MCP research tools wired to Subagent A; build and validate the metadata-extraction sandbox script against two pinned public pages |
| 3 | Subagent B + contradiction detection logic; normalize date evidence and implement the unresolved-state policy |
| 4 | Approval gate as a real execution block; first end-to-end run on the pinned test case |
| 5 | Visible agent-state UI (thinking/waiting/done); show extracted metadata fields and timestamps; ensure PR trail is real across the week, not backfilled |
| 6 | Rehearse and record demo (contradiction, sandbox metadata output, and gate must be on camera); write README + blog post; submit |

---

## 9. Risks

| Risk | Mitigation |
|---|---|
| Sources lack, misstate, or inconsistently expose date metadata | Pin demo sources with reliable JSON-LD or Open Graph dates; display evidence provenance and return an unresolved state when signals are weak |
| A source updates its metadata after rehearsal | Re-run the pinned demo case before recording; keep a second verified source pair ready |
| Voice recognition fails live during demo | Have a text-input fallback path wired in, tested, ready to switch to silently |
| Contradiction doesn't reliably surface with real test data | Pick and pin down the actual demo name/claim/source pair early — don't leave it to chance on demo day |
| Scope creep (adding a second resolver type, more sources, etc.) | Explicitly out of scope per §3 — resist mid-week additions |

---

## 10. Open Decision

**Test case:** Select and rehearse a real name/claim plus two public sources that state conflicting facts and expose stable, machine-readable publication/update metadata. Confirm both the expected resolver result and the fallback unresolved case before Day 1 build work starts.
