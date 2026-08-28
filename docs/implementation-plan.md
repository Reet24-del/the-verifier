# The Verifier — Implementation Plan

Spec authority: `outputs/the-verifier-prd-revised.md` and `design.md`.

## Global constraints

- The product performs one narrow job: verify one person-and-claim brief using opposing evidence paths.
- Research outputs include claim, source URL, publication/modification dates, and date provenance.
- Conflicts are surfaced explicitly and resolved only through deterministic source-date metadata extraction.
- Missing or weak date evidence produces `unresolved`; the system never fabricates recency.
- No dossier is persisted or exported until a server-issued approval token is explicitly approved.
- The demo must remain runnable without secrets through a pinned fixture mode.
- Live mode targets a locally running TrueForge HTTP endpoint and never places model or tool credentials in the browser.
- Every new behavior is developed test-first and all verification commands must pass before completion.

## Task 1 — Backend workflow and safety contract

Create a small Node server that exposes session creation, workflow execution, approval, dossier retrieval, and health endpoints. Implement an in-memory session state machine with cryptographically random session and approval identifiers. Reject approval before a completed result, reject invalid tokens, and persist only after valid explicit approval. Serve persisted dossiers from a git-ignored data directory. Add tests that fail first for the state transitions and persistence boundary.

## Task 2 — Deterministic metadata resolver

Move resolver logic into a shared server-safe module. Extract JSON-LD, Open Graph, standard metadata, and weak HTTP `Last-Modified` signals from raw HTML/header inputs. Normalize valid values to ISO 8601, preserve provenance and strength, and return resolved or unresolved according to the PRD policy. Add failing tests first for priority, invalid dates, weak evidence, ambiguity, and newest-source selection.

## Task 3 — Research adapters and TrueForge integration

Define a research adapter interface. Keep a fixture adapter for a no-secret demo and add a TrueForge HTTP adapter configured by `TRUEFORGE_BASE_URL`, `TRUEFORGE_AGENT_ID`, and optional bearer token. The live adapter must submit the user brief to a persistent TrueForge session and consume structured JSON results containing two opposing source sets. The server orchestrator must run both research angles concurrently. Add contract tests with a local fake HTTP server before implementation.

## Task 4 — UI integration

Replace local timers and direct sample imports with the backend session API. Render ready, investigating, conflict, resolved/unresolved, awaiting-approval, saved, and error states. Bind `Approve & save` to the server approval endpoint and bind export to a saved dossier only. Preserve the design system and responsive layout from `design.md`. Add component behavior tests before implementation.

## Task 5 — Repository, documentation, and demo evidence

Document local fixture mode, TrueForge live mode, environment variables, architecture, security boundary, demo choreography, test commands, and Qodo review evidence. Initialize Git, create reviewable commits on a feature branch, and prepare a public-repository/Qodo checklist. Pin a real demo case only when both sources are public, independently accessible, contradictory on the same fact, and expose machine-readable dates.

## Task 6 — Verification

Run unit, integration, production-build, responsive interaction, and security checks. Confirm no secrets are committed and no save/export path bypasses approval. Record limitations that require external accounts or live service credentials.
