# The Verifier — UI Design Specification

## Product intent

The Verifier should feel like a calm, high-trust briefing console—not a chat application. It helps a user understand what the agent is doing, why evidence conflicts, what the deterministic resolver found, and exactly when their approval is needed.

The main design principle is **visible control**: agent work is observable; irreversible actions are impossible until the user explicitly approves.

## Landing-page information architecture

The first visit is now an explanatory product journey before the operational workspace. It answers four questions in order:

1. **What does The Verifier do?** — The hero promises inspectable evidence, not a generic AI answer.
2. **Why is it needed?** — The problem section explains how confident answers can hide outdated sources.
3. **How does it work?** — A four-stage process explains brief, adversarial research, date resolution, and approval.
4. **Why should I trust it?** — The trust section names the evidence, resolution, persistence, and export boundaries.

The hero includes a compact, code-native preview of the real Starbucks leadership conflict. It functions as product proof rather than decoration: two dated sources disagree, structured date metadata resolves the order, and approval remains required. Primary calls to action scroll directly to the live verifier on the same page, so explanation never becomes a barrier to trying the product.

The landing page uses varied section rhythms rather than a repeated card grid: a split hero, an open principle rail, a numbered process list, a dark trust band, and finally the framed product workspace. It reuses the existing ink, amber, red, and green evidence system.

## Live product workspace

The desktop product experience is a two-column decision workspace embedded below the landing narrative.

- **Left column:** a prominent claim composer followed by the active verification workflow.
- **Right column:** a sticky dossier that summarizes evidence, conclusion, and save state.
- **Top bar:** product context, active-session indicator, and export action.
- **Progress strip:** a persistent four-step indicator that makes the current gate obvious.

The order of the workflow is fixed:

1. Spoken brief
2. Investigation timeline
3. Date-metadata resolver
4. Human approval

This sequence is intentional: the user should see the agent's work before being asked to trust or approve it.

## Visual direction

| Token | Value | Use |
|---|---:|---|
| Ink | `#09111F` | Page background |
| Panel | `#101D30` | Primary surfaces |
| Recessed panel | `#0C1728` | Inputs, source cards, tables |
| Rule | `#293850` | Surface borders and dividers |
| Primary text | `#EDF3FF` | Headings and key actions |
| Muted text | `#A7B3C8` | Supporting detail |
| Amber | `#F6B84A` | Primary action, current-claim lane, active states |
| Red | `#ED655E` | Contradictions and blocked/error states |
| Green | `#5DCC9C` | Supporting evidence and confirmed save |

- Background: midnight blue, with an extremely restrained cool-blue radial lift near the top left.
- Surfaces: 9–18 px radii, fine rules, restrained depth, and no glassmorphism.
- Type: Inter/system sans serif, large editorial claim framing, high contrast, and uppercase tracked labels only for process chrome.
- Hierarchy: the claim composer is the strongest visual element; evidence, resolver, and approval become progressively more compact and operational.
- Motion: brief state transitions only; no decorative animation. Respect reduced-motion settings.

## Component system

### Top bar

- **Context label:** `EVIDENCE OPERATIONS`, small and tracked above the wordmark.
- **Wordmark:** `THE VERIFIER`, uppercase, tracked, left-aligned.
- **Session state:** small green dot and plain-language session status.
- **Export action:** secondary button. It must not imply a dossier has been saved; before approval, explain that export is unavailable.

### Claim composer / spoken brief

- Hero statement: `Verify a public claim before it becomes permanent.`
- Supporting copy explains the opposing research angles, deterministic resolver, and approval lock.
- Four-step progress strip: Brief → Research → Resolve → Approve.
- Process label: `1. SPOKEN BRIEF` beneath the progress strip.
- Editable multiline brief field with clearly labeled voice and typed-input actions.
- Primary compact action: `Verify brief`.
- Supporting line confirms voice-or-text entry and identifies pinned-demo data where applicable.

The brief remains editable at all times. Starting a new verification clears any earlier save state.

### Investigation timeline

Two balanced research lanes make the adversarial architecture legible. The old decorative time ruler is intentionally omitted; it consumed space without communicating reliable progress.

| Lane | Accent | Job | Result label |
|---|---|---|---|
| Current Claim Finder | Amber | Find the newest source supporting the claim | `Supports claim` |
| Contradiction Hunter | Red | Find public evidence that conflicts with the claim | `Contradicts claim` |

Each source card must show:

- Source title
- Source host/URL label
- A concise extracted claim
- Support/contradiction state using both color and text

When agents disagree, show a full-width red conflict panel. It should state what fact is disputed and that the resolver has been invoked. Never quietly choose one source in the UI.

### Date-metadata resolver

The resolver is a deterministic-evidence panel, not a narrative explanation.

Use a table with these columns:

1. Source
2. Metadata field
3. Raw value
4. Normalized UTC value

Display metadata in the PRD-defined priority order:

1. JSON-LD `dateModified` / `datePublished`
2. Open Graph `article:modified_time` / `article:published_time`
3. HTML date metadata
4. HTTP `Last-Modified` only as a weak corroborating signal

The result line must use one of two states:

- **Resolved** (green): name the source with the newest strong machine-readable signal.
- **Unresolved** (amber): state that the available date evidence is insufficient; do not claim a winner.

### Approval gate

The approval panel should stand apart with an amber border and contain:

- Process label: `4. HUMAN APPROVAL`
- Question: `Save this verified brief?`
- Explanation that saving is blocked until the user decides
- Primary action: `Approve & save`
- Secondary action: `Keep investigating`

`Approve & save` is disabled until the investigation and resolver complete. Saving changes the dossier status to green `Saved with approval`. Until then, the dossier must state `Not saved` and explain that no data has left the session.

## Dossier sidebar

The dossier is sticky on desktop and follows the user while reviewing evidence. It contains:

1. **Overall conclusion** — awaits evidence, conflict resolved, or needs review
2. **Evidence summary** — one concise row per source, including source role
3. **Dossier status** — `Not saved` or `Saved with approval`

The summary should remain short: it orients the user but never replaces the detailed evidence in the main workflow.

## Interaction states

| State | UI behavior |
|---|---|
| Ready | Editable brief; `Verify brief` enabled; dossier is unsaved |
| Investigating | Both agent lanes visibly active; approval disabled |
| Conflict found | Red conflict panel appears; resolver runs/returns evidence |
| Resolved | Resolver result names newest strong date signal; approval enabled |
| Unresolved | Resolver explains evidence gap; approval still permits saving an unresolved brief |
| Approved | Dossier changes to `Saved with approval`; confirmation is announced |
| Keep investigating | No save occurs; existing evidence remains visible |

## Accessibility requirements

- Use text labels in addition to color for every status.
- Keep body text at 12 px minimum and important content at 13 px or above.
- Maintain high contrast for text, table cells, and controls.
- Use native buttons and a labeled textarea.
- Announce investigation and save status through a polite live region.
- Preserve keyboard order: brief → verify → evidence → approval actions.
- Do not rely on hover to expose essential evidence.

## Responsive behavior

### Desktop (≥981 px)

- Two columns: flexible workflow area plus a 352 px dossier sidebar.
- Source cards use two columns per agent lane.
- Dossier is sticky.

### Tablet (681–980 px)

- Stack dossier below the workflow.
- Keep two-card source rows when horizontal room permits.
- Make the dossier non-sticky.

### Mobile (≤680 px)

- One-column layout.
- Agent label stacks above its source cards.
- Source cards become a single vertical stream.
- Brief textarea and `Verify brief` action become full-width.
- Approval actions wrap but retain primary-before-secondary order.
- Tables scroll horizontally rather than truncating date evidence.

## Demo choreography

The UI should support a three-minute demo in this order:

1. Enter or dictate a claim.
2. Start verification and reveal both agent lanes.
3. Surface the red conflict panel.
4. Show machine-readable metadata normalized in the sandbox table.
5. Read the conclusion aloud.
6. Pause at `Approve & save`.
7. Confirm approval and show the saved dossier state.

## Implementation map

| Area | Current implementation |
|---|---|
| App composition | `src/App.jsx` |
| Seeded demo evidence | `src/data.js` |
| Date normalization and resolver policy | `src/lib/dateMetadata.js` |
| Visual tokens, layout, and responsive styles | `src/styles.css` |

The UI now consumes the server session workflow, renders returned research and resolver evidence, exposes recoverable errors, and binds save/reject actions to the server's one-time approval checkpoint. The browser Web Speech API captures an editable spoken brief, pauses for transcript confirmation, narrates the result and save question, and accepts an explicit spoken yes/no decision. Browsers without a working browser speech service receive an actionable Chrome/Safari or typed-input fallback; no external speech API is required. JSON export remains disabled until the server confirms persistence, then retrieves the saved dossier from the session endpoint. TrueForge live mode uses the same UI contract; future streaming support can replace the current request/response transition with incremental direct-research events without changing the layout.

## Figma working file

The design audit, captured before-state, and redesigned navigation foundation are available in [The Verifier — Product UI](https://www.figma.com/design/lPFjpIVftKQA4pHe9NOphW). The Figma Starter-plan MCP limit prevented completing every frame in that file, so the verified React implementation is the current visual source of truth.
