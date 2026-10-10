# Integrations Research — neatlogs / Entire / cfo.ai / Crustdata vs Shawtty

**Date:** 2026-10-10 · **Scope:** where each external service fits the Shawtty pipeline (MVP + v2 plan), with file:line evidence.
**Status tags:** verified = read the owning source; docs-claimed = source asserts, not locally tested; unverified = gated/unclear, stated as such.
**Paths:** app-relative paths (`server/…`, `remotion/…`) resolve under `app/`; docs (`plan.md`, `revise-plan.md`, `MOTION-GRAPHICS-RESEARCH.md`) sit in `docs/`.

## 0. Summary table

| Service | Verdict | Insertion point (no code changed) | Effort | Order |
|---|---|---|---|---|
| neatlogs.com | **Integrate now (M0)** — only service that fills a pipeline gap with ~zero churn | `server/jobs.js:59-158` (`runJob` stages) via HTTP `POST /v1/trace`; readback via CLI/Public API | S (~2–3h) | M0, before M1 |
| entire.com | **Adopt now as workflow, not code** — zero pipeline insertion | Repo root ops: install CLI, mirror repo; no `server/` or `remotion/` change | S (ops only) | Anytime, parallel to M0 |
| cfo.ai | **Later / not as code** — finance product, no pipeline API; useful only for unit-economics modeling after revenue decision | No code insertion; external workspace for `plan.md:11.1/11.2` decisions | Zero code (but $) | After M4, if monetized |
| crustdata.com | **Not recommended** (optional brief) — duplicates decided `sonar` research stage | Would be `server/stages/research.js` (proposed, `revise-plan.md:50`), replacing/augmenting sonar | M | Only if sonar fails |

Overlap ruling: Crustdata Web Search vs `perplexity/sonar` cover the same gap — **sonar wins** (already decided, citation-verified, priced; see §4). Neatlogs, Entire, cfo.ai overlap with nothing.

## 1. neatlogs.com — INTEGRATE NOW (M0)

**What it is (verified, primary docs):** Observability for AI-agent/LLM runs — traces, spans, detections, evals, fixes ([neatlogs.com](https://neatlogs.com), [docs index](https://docs.neatlogs.com/llms.txt)).
TypeScript SDK is `npm install neatlogs@latest`, Node ≥18, `await init({apiKey, workflowName})`, `span({kind})` wrappers, `flush()/shutdown()` lifecycle ([TS SDK](https://docs.neatlogs.com/sdk/typescript)).
Zero-dependency alternative: **HTTP trace injection** `POST https://ingest.neatlogs.com/v1/trace` with nested-JSON span tree, Bearer write key, no IDs to manage ([HTTP injection](https://docs.neatlogs.com/sdk/http-injection)).
Pricing (docs-claimed, [site](https://neatlogs.com)): Free $0 = 100k spans/mo hard cap, 3 investigations, 14-day retention; Starter $99/mo. Span = one LLM/tool/retriever step; typical trace 5–20 spans.
Existing brief: `netlogs-trail/netlogs.md:1-79` already scopes this exact integration (coverage table, SDK Doctor, evidence loop).

**Gaps it fills (local evidence):**
- Today failures persist only `error` + `trace` stack in `job.json` (`server/jobs.js:148-157`) — no per-stage timing, model/usage, or 429/truncation history. Plan already hit `429 Concurrency Limit Exceeded` and truncated JSON (`plan.md:83-94`), and v2 adds 5 stages × retries where blind spots multiply (`revise-plan.md:38`).
- No cost/latency breakdown per reel vs the `plan.md:8.2` cost table — Neatlogs analytics covers cost/errors/tools ([llms.txt](https://docs.neatlogs.com/llms.txt)).

**Proposed wiring (efficient — minimal churn):**
- Prefer **HTTP injection** over the SDK: Shawtty calls AICredits via raw `fetch` in `postJson` (`server/aicredits.js:23-71`), which the TS SDK does **not** auto-instrument ("does not instrument `fetch`/Node HTTP", [TS SDK](https://docs.neatlogs.com/sdk/typescript)) — the SDK would add a dep (`package.json:14-23` frozen at Remotion 4.0.534) for little gain. One `fetch` helper posting a nested trace per job = ~30 lines, no new dependency.
- One WORKFLOW trace per job (`name: shawtty-reel`, session = job id), children per stage: `research`/`script`/`scenes` (LLM: model, tokens, `finish_reason`), `voice`/`images` (TOOL per line/scene), `render`/`mix` (TOOL, duration), ERROR spans on 429/5xx/400 with plain-message mapping (`plan.md:8.1`). Fits stage boundaries exactly (`revise-plan.md:41-46`).
- Privacy: BYOK keys must never enter spans — redaction pattern already required (`revise-plan.md:58`; SDK `mask`/PII docs). Keep `NEATLOGS_API_KEY` server-side in `.env` alongside `AICREDITS_API_KEY` (`server/config.js:13-29`).
- Dependency/order: **M0** — instrument current `runJob` first (proves the loop on today's 3-step pipeline), then extend to `server/stages/*` as M1–M3 land. Follow `netlogs-trail/netlogs.md` gates (Doctor → coverage rows → evidence loop).

**Tradeoffs/cost:** Free tier covers MVP volumes (a reel ≈ 1 trace × ~10–20 spans; 100k spans ≈ thousands of reels). Pitfall: telemetry failure must never fail the job (fire-and-forget + try/catch around export).

## 2. entire.com — ADOPT AS WORKFLOW, NOT CODE

**What it is (verified, primary docs):** Distributed Git hosting + agent-session storage. "Every commit an agent makes becomes a checkpoint: code change paired with prompt, reasoning, tool calls" with secret redaction; regional mirrors "up to 89x faster" clones; open-source MIT CLI (`curl -fsSL https://entire.io/install.sh | bash`); supports OpenCode explicitly ([entire.io](https://entire.io), [docs](https://docs.entire.io/)). Search across code + sessions; resume/hand off work across agents.

**Gaps it fills:** None inside the render pipeline — and that is the point. Value is **developer workflow**: Shawtty is already multi-agent-built (`plan.md:4` "with Claude Code", `revise-plan.md` series, vendored skills ×3 runtimes); intent (why a change was made) currently lives only in session chat. Checkpoints + agentic search attack exactly the "diff doesn't explain why" problem for the M0–M4 stretch, plus fast parallel-agent clones.
**Insertion:** repo-root ops only — install CLI, mirror GitHub repo to nearest region, point agent remotes at mirror. **Zero edits** to `server/`, `remotion/`, `public/`, `scripts/`. No milestone dependency; can run parallel to M0.
**Tradeoffs:** pricing **unverified** (no pricing page found on apex/docs at research time — confirm before team-wide rollout). Not a substitute for in-pipeline fixes (transitions, timing.json). Verdict: adopt now for the team, expect ~0 code churn.

## 3. cfo.ai — LATER / NOT AS CODE

**What it is (verified, primary docs):** Ari, an AI-CFO finance product: connects accounting/HR/CRM/banking sources, builds a live financial Model with Scenarios, answers business questions against it ([cfo.ai](https://cfo.ai), [docs](https://docs.cfo.ai)). Remote MCP server at `https://api.cfo.ai/mcp` lets external agents (Claude Code, Codex) read/edit the workspace Model ([MCP docs](https://docs.cfo.ai/integrations/mcp-server.md)).
Pricing (docs-claimed, [pricing](https://cfo.ai/pricing)): Startup **$375/mo** billed annually (5 integrations, 500k rows), Growth $1,125/mo, 14-day trial.

**Why NOT a pipeline integration:** cfo.ai exposes workspace-modeling tools (`inspect/edit_table_blocks`, scenarios, integrations) — there is **no per-transaction costing API** to call from `server/jobs.js`, and Shawtty's cost problem is per-reel AICredits spend, not corporate actuals. Inserting it into stages would be redundant work with no contract to attach to.
**Where it genuinely helps (non-code):** the two open money decisions — BYOK revenue model (`plan.md:11.1`) and Flux per-image price check (`plan.md:11.2`, cost table `plan.md:8.2`). A cfo.ai workspace modeling "₹1.10 + images per reel × volume vs subscription price" is the right shape — but only **after M4**, when monetization is real. At $375/mo vs current ~₹1/reel economics it is overkill for a pre-revenue MVP; the M4 "cost estimate in UI" (`plan.md:10`) plus a spreadsheet covers v2.
Verdict: **do not integrate into code; revisit as a finance tool post-launch.**

## 4. crustdata.com — NOT RECOMMENDED (optional brief)

**What it is (verified, primary docs):** Real-time B2B people/company data API + MCP: search/enrich over "1B people, 200M+ companies", plus Web Search `POST https://api.crustdata.com/web/search/live` (sources: web/news/scholar/ai/social, `1 credit per query`, default 10 req/min rate limit) and `/web/enrich/live` URL fetch ([site](https://crustdata.com), [docs](https://docs.crustdata.com), [web search](https://docs.crustdata.com/web-docs/search/introduction)). Auth: `Authorization: Bearer + x-api-version: 2025-11-01`. Credit $ pricing **unverified** (credit-based tiers, no public unit prices; live endpoints "enterprise-only and plan-specific").

**Mapping vs decided plan:** The only plausible insertion is `server/stages/research.js` (`revise-plan.md:50`): Crustdata web/news search as the findings source instead of `perplexity/sonar` (`plan.md:5.1`). This **loses on every axis**: sonar is already validated (16 annotations, 3.3s, ~₹0.60/call, citation-annotation filtering — `plan.md:89`); Crustdata adds a second key/billing, rate limits (10/min) that fight the ≤3-concurrency design (`plan.md:8.1`), and `ai`-source overviews whose references need re-fetching. People/company enrichment (Crustdata's actual strength) has **no consumer** in v2 — explainer reels need topic facts with source URLs, not B2B profiles. Effort M (new client, citation-filter rewrite, fallback logic) for negative benefit.
Verdict: **rule out** unless sonar citation quality measurably fails in M1; then spike Crustdata web search behind the same `research.json` contract.

## 5. Prioritized implementation order (tied to M0–M4, `plan.md:10`)

1. **M0 — Neatlogs HTTP-injection helper** (~2–3h): new `server/neatlogs.js` (post trace, swallow errors), wrap `runJob` stages (`server/jobs.js:59-95`), verify one trace readback per `netlogs-trail/netlogs.md:53-71`. Unblocks M1–M3 debugging.
2. **Parallel to M0 — Entire CLI + mirror** (ops, ~1h): install, mirror, document clone URL in README. No code.
3. **M1 — extend traces** to `research.js`/`script.js` + review API (`PUT /script`, `POST /approve` proposed `revise-plan.md:60-66`); add `unsourced`-line GUARDRAIL span.
4. **M2/M3 — asset-stage spans**: per-line TTS + per-scene Flux as TOOL spans with retry counts; render/mix TOOL spans; keep Free-tier span budget in mind (~20 spans/reel).
5. **Post-M4 — cfo.ai revisit** only when revenue model (`plan.md:11.1`) is decided; Crustdata only on sonar failure.

## 6. Sources

- Docs (verified): https://neatlogs.com · https://docs.neatlogs.com/llms.txt · https://docs.neatlogs.com/sdk/typescript · https://docs.neatlogs.com/sdk/http-injection · https://entire.io · https://docs.entire.io/ · https://cfo.ai · https://cfo.ai/pricing · https://docs.cfo.ai · https://docs.cfo.ai/integrations/mcp-server.md · https://crustdata.com · https://crustdata.com/pricing · https://docs.crustdata.com · https://docs.crustdata.com/web-docs/search/introduction
- Local (verified): `server/jobs.js:59-158,148-157` · `server/aicredits.js:23-71,218-323` · `server/config.js:13-29` · `server/index.js:33-61` · `server/render.js:19-55` · `server/media.js:6-43` · `server/sound.js:130-147` · `remotion/timeline.js:5-19` · `remotion/Root.jsx:56-66` · `public/app.js:1-216` (no review screen yet) · `package.json:14-23` · `plan.md:5.1,8.1,8.2,10,11` · `revise-plan.md:38,41-66` · `netlogs-trail/netlogs.md:1-79` · `MOTION-GRAPHICS-RESEARCH.md:1-81`
- Unverified: Entire pricing/plans; Crustdata credit $ values + live-endpoint plan gating for this account; Neatlogs Free-tier span counting for HTTP-injected vs SDK traces.

## 7. Open questions

1. Neatlogs project key provisioning: who owns the project + where is `NEATLOGS_API_KEY` stored (server `.env` only, never `job.json`)?
2. HTTP injection vs TS SDK final call after M0 spike — confirm dashboard grouping by `workflowName` + session id is sufficient.
3. Entire: confirm pricing + data-residency region before mirroring.
4. Flux per-image price (`plan.md:11.2`) still blocks M3 costing — independent of all four services here.
5. cfo.ai trial: only worth starting when real revenue/volume numbers exist to model.
