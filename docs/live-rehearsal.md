# Live TrueForge rehearsal evidence

Completed on 2026-08-30 against the locally configured TrueForge instance and the saved Groq Qwen agent.

## Result

- Workflow mode: `trueforge`
- Claim: `Verify that Brian Niccol is CEO of Starbucks.`
- Final resolver status: `resolved`
- Pre-approval dossier request: HTTP `404` (correctly blocked)
- Approval result: `saved`
- Persisted dossier ID: `0d878140-011e-49e1-bf0d-ee1443b9d9f4`
- Export after approval: succeeded

## Live opposing sources

| Angle | Stance | Source | Structured publication date |
|---|---|---|---|
| Current Claim Finder | Supports | [Reuters — Reshaping Starbucks: Brian Niccol's big moves in first year at helm](https://www.reuters.com/business/reshaping-starbucks-brian-niccols-big-moves-first-year-helm-2025-11-03/) | `2025-11-03T00:00:00.000Z` |
| Contradiction Hunter | Contradicts | [Starbucks — Q3 Fiscal 2024 Results](https://investor.starbucks.com/news/financial-releases/news-details/2024/Starbucks-Reports-Q3-Fiscal-2024-Results/default.aspx) | `2024-07-30T00:00:00.000Z` |

Both timestamps were copied from Exa's structured `publishedDate` result and normalized as `publishedAt` with `search-provider` provenance. The resolver selected the Reuters source as the unique newest strong signal.

## Reproduction

1. Start the configured TrueForge instance.
2. For the Groq free-tier Qwen setup, start `npm run groq-proxy` and use the loopback provider URL documented in the README.
3. Start The Verifier server with `TRUEFORGE_BASE_URL`, `TRUEFORGE_AGENT_NAME`, and `TRUEFORGE_TIMEOUT_MS=360000`.
4. Run `npm run rehearse:live`.

No provider credential is exposed to the browser, written to this report, or printed by the proxy.
