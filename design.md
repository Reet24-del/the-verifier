# The Verifier — UI Design Specification

## Product intent

The Verifier should feel like a calm, high-trust briefing console—not a chat application. It helps a user understand what the agent is doing, why evidence conflicts, what the deterministic resolver found, and exactly when their approval is needed.

The main design principle is **visible control**: agent work is observable; irreversible actions are impossible until the user explicitly approves.

## Primary screen

The desktop experience is a two-column command console.

- **Left column:** the active verification workflow, arranged as a four-step sequence.
- **Right column:** a sticky dossier that summarizes evidence, conclusion, and save state.
- **Top bar:** wordmark, active-session indicator, and export action.

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
- Surfaces: square-to-soft corners (roughly 4–5 px), fine rules, no glassmorphism.
- Type: system sans serif, high contrast, uppercase tracked labels for process chrome.
- Motion: brief state transitions only; no decorative animation. Respect reduced-motion settings.

## Component system

### Top bar

- **Wordmark:** `THE VERIFIER`, uppercase, tracked, left-aligned.
- **Session state:** small green dot and plain-language session status.
- **Export action:** secondary button. It must not imply a dossier has been saved; before approval, explain that export is unavailable.

### Spoken brief panel

- Process label: `1. SPOKEN BRIEF`.
- Editable multiline brief field with a voice/input icon.
- Primary compact action: `Verify brief`.
- Supporting line confirms voice-or-text entry and identifies pinned-demo data where applicable.

The brief remains editable at all times. Starting a new verification clears any earlier save state.

### Investigation timeline

Two side-by-side research lanes make the adversarial architecture legible.

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

The UI now consumes the server session workflow, renders returned research and resolver evidence, exposes recoverable errors, and binds save/reject actions to the server's one-time approval checkpoint. JSON export remains disabled until the server confirms persistence, then retrieves the saved dossier from the session endpoint. TrueForge live mode uses the same UI contract; future streaming support can replace the current request/response transition with incremental subagent events without changing the layout.
