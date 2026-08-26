# The Verifier

The Verifier is a voice-briefed, contradiction-aware fact verification agent for high-stakes meetings. It sends two research agents down opposing paths, surfaces conflicting evidence, uses a deterministic date-metadata resolver in a sandboxed step, and requires human approval before saving a dossier.

## What this prototype demonstrates

- Parallel current-claim and contradiction-hunting research lanes
- Explicit conflict visibility rather than silent source selection
- Deterministic extraction and normalization of JSON-LD and Open Graph date metadata
- A genuine UI-level approval gate: saving stays disabled until investigation completes and only proceeds after approval
- A presentation-oriented session console with source evidence and resolver provenance

## Run locally

```bash
npm install
npm run dev
```

Open the localhost address printed by Vite.

## Architecture direction

This front end is intentionally a runnable interaction prototype. For the hackathon integration, attach its actions to a TrueForge session: use MCP search/fetch for both subagents, run the metadata extractor as sandboxed code, and persist/approve the save action through TrueForge's approval checkpoint. TrueForge documents MCP tools, sandbox execution, human checkpoints, subagents, and session state as first-class harness capabilities.

## Demo flow

1. Edit or accept the spoken brief.
2. Choose **Verify brief**.
3. Watch paired evidence and the conflict state appear.
4. Inspect the resolver's metadata rows and normalized UTC dates.
5. Choose **Approve & save**; until then, the dossier remains unsaved.
