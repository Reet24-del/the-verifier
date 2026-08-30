# Live TrueForge rehearsal evidence

Completed on 2026-08-30 against the locally configured TrueForge instance. Both opposing research lanes used the saved Groq Qwen agent with Exa; a dedicated sandbox-enabled TrueForge resolver agent executed the deterministic recency proof in Daytona. The application accepted the result only after reading the persisted event chain and matching the exact command and output to its server-side oracle.

## Result

- Workflow mode: `trueforge`
- Claim: `Verify that Brian Niccol is CEO of Starbucks.`
- Final resolver status: `resolved`
- Pre-approval dossier request: HTTP `404` (correctly blocked)
- Approval result: `saved`
- Application session and dossier ID: `6145e32c-e9f2-4dde-9aae-bb2be4ec0fff`
- Export after approval: succeeded
- Rehearsal completed at: `2026-08-30T18:08:23.583Z`

## Verified sandbox event chain

- TrueForge resolver session: `01m19xkft95jdvz9t51kqf0gse`
- Resolver turn: `01m19xkfthjgq7cbhztkx9dwqt.local`
- Sandbox: `v1:daytona:default.1f1594c6-77cb-4af8-9416-d4e6ce639a0e`
- Tool call: `9ef6nw5k6`
- Persisted event IDs:
  - model `exec` call: `01m19xkftrd744b8bj8wrvppe9`
  - `sandbox.created`: `01m19xnn90xtqm43t6xzv3cwv8`
  - matching `tool.response`: `01m19xnn95evygxmv1t41vk7v0`

The verifier required the exact generated command, a successful response with exit code `0`, and the compact sandbox proof `{status, newestIndex, normalizedDates}`. It then compared that proof with the independent server oracle before exposing the full resolution. A changed command, missing event, failed command, or mismatched result is rejected.

## Live opposing sources

| Angle | Stance | Source | Structured publication date |
|---|---|---|---|
| Current Claim Finder | Supports | [Reuters — Reshaping Starbucks: Brian Niccol's big moves in first year at helm](https://www.reuters.com/business/reshaping-starbucks-brian-niccols-big-moves-first-year-helm-2025-11-03/) | `2025-11-03T00:00:00.000Z` |
| Contradiction Hunter | Contradicts | [Starbucks — Q3 Fiscal 2024 Results](https://investor.starbucks.com/news/financial-releases/news-details/2024/Starbucks-Reports-Q3-Fiscal-2024-Results/default.aspx) | `2024-07-30T00:00:00.000Z` |

Both timestamps were copied from Exa's structured `publishedDate` result and normalized as `publishedAt` with `search-provider` provenance. The resolver selected the Reuters source as the unique newest strong signal.

## Reproduction

1. Start the configured TrueForge instance.
2. For the Groq free-tier Qwen setup, start `npm run groq-proxy` and use the loopback provider URL documented in the README.
3. Configure the research agent with Exa and the resolver agent with sandbox access.
4. Start The Verifier server with `TRUEFORGE_BASE_URL`, `TRUEFORGE_AGENT_NAME`, `TRUEFORGE_RESOLVER_AGENT_NAME`, and `TRUEFORGE_TIMEOUT_MS=360000`.
5. Run `npm run rehearse:live`. Set `VERIFIER_REHEARSAL_TIMEOUT_MS=900000` when the provider queue can exceed Node's default five-minute header timeout.

No provider credential is exposed to the browser, written to this report, or printed by the proxy.
