# Pact Network — Task Breakdown (Phases 1 & 2)

> Parsed from PRD v1.0 (2026-04-05)
> Deadline: 2026-04-12 (Colosseum hackathon)
> Copy this into the pact-network repo when available.
> Format compatible with Task Master's `tasks.json` — convert with `task-master parse` when MCP is configured.

---

## Phase 1: Pact Monitor (SDK + Backend)

### 1.1 SDK Core — Transparent API Call Wrapping
**Priority:** HIGH | **Complexity:** Medium | **Due:** Apr 8
**Depends on:** nothing
**Description:** Create a TypeScript SDK (`@pact-network/monitor`) that wraps `fetch()` transparently. For every call, record: timestamp, provider/endpoint, HTTP status, latency (ms), schema match result, USDC amount (from x402 headers or manual override).
**Key constraint:** Wrapping must NOT break the original API call. If monitoring fails internally, the API call still succeeds.
**Files:** `sdk/src/wrapper.ts`, `sdk/src/types.ts`
**Test:** Wrap a real HTTP call, verify original response is unchanged, verify call record is created.

### 1.2 SDK — Failure Classification Engine
**Priority:** HIGH | **Complexity:** Low | **Due:** Apr 8
**Depends on:** 1.1
**Description:** Classify each recorded call as one of: `success` (2xx + within latency threshold + schema valid), `timeout` (exceeds latency threshold), `error` (non-2xx or network failure), `schema_mismatch` (2xx but body doesn't match expected JSON schema).
**Files:** `sdk/src/classifier.ts`
**Test:** Unit tests for each classification type with edge cases.

### 1.3 SDK — Local Storage
**Priority:** HIGH | **Complexity:** Low | **Due:** Apr 8
**Depends on:** 1.1, 1.2
**Description:** Store all call records locally (SQLite or JSON file on agent's machine). Provide query methods: total calls, failure rate, average latency, breakdown by provider. No network access required.
**Files:** `sdk/src/storage.ts`
**Test:** Write 100 records, query aggregate stats, verify accuracy.

### 1.4 SDK — Remote Batch Sync
**Priority:** HIGH | **Complexity:** Medium | **Due:** Apr 9
**Depends on:** 1.3, 1.6
**Description:** Optionally push call records to Pact backend in batches. If backend unreachable, queue locally and retry later. No data loss. Configurable batch size and interval.
**Files:** `sdk/src/sync.ts`
**Test:** Sync records to backend, simulate network failure, verify retry + no data loss.

### 1.5 SDK — Package & Publish
**Priority:** MEDIUM | **Complexity:** Low | **Due:** Apr 9
**Depends on:** 1.1-1.4
**Description:** Package SDK as npm-installable module. README with quick-start example. Export types. Provide git-based install path as fallback.
**Files:** `sdk/package.json`, `sdk/README.md`, `sdk/tsconfig.json`
**Test:** `npm install` from git URL works, import and wrap a call in <10 lines.

### 1.6 Backend — API Server Scaffold
**Priority:** HIGH | **Complexity:** Medium | **Due:** Apr 8
**Depends on:** nothing (parallel with SDK)
**Description:** Set up backend API server (Node.js/Hono or Fastify). Database (PostgreSQL or SQLite). Data model for: providers, endpoints, call_records. Health check endpoint.
**Files:** `backend/src/server.ts`, `backend/src/db.ts`, `backend/src/schema.ts`
**Test:** Health check returns 200, DB migrations run cleanly.

### 1.7 Backend — Batch Submission Endpoint
**Priority:** HIGH | **Complexity:** Medium | **Due:** Apr 9
**Depends on:** 1.6
**Description:** `POST /api/v1/records` — accepts batch of call records (authenticated via API key). Validates payload, stores in DB. Returns count of accepted records.
**Files:** `backend/src/routes/records.ts`, `backend/src/middleware/auth.ts`
**Test:** Submit batch of 50 records with valid API key, verify stored. Reject without key (401).

### 1.8 Backend — API Key Auth
**Priority:** HIGH | **Complexity:** Low | **Due:** Apr 9
**Depends on:** 1.6
**Description:** API key auth for write endpoints. Keys stored in DB or env. Manual generation (no self-service). Read-only endpoints are public (no auth).
**Files:** `backend/src/middleware/auth.ts`, `backend/src/scripts/generate-key.ts`
**Test:** Generate key via script, use it for submission, reject invalid key.

### 1.9 Backend — Public Read Endpoints
**Priority:** HIGH | **Complexity:** Medium | **Due:** Apr 9-10
**Depends on:** 1.7
**Description:** Public endpoints:
- `GET /api/v1/providers` — list all tracked providers with aggregate stats
- `GET /api/v1/providers/:id` — detailed stats: failure rate, latency percentiles (p50/p95/p99), uptime, failure type breakdown
- `GET /api/v1/providers/:id/timeseries` — failure rate over time (hourly/daily granularity, for charts)
**Files:** `backend/src/routes/providers.ts`
**Test:** Seed data, query each endpoint, verify response schema and accuracy.

### 1.10 Backend — Data Seeding Script
**Priority:** HIGH | **Complexity:** Medium | **Due:** Apr 10
**Depends on:** 1.7
**Description:** Script generating realistic monitoring data for 5+ Solana API providers:
- **Helius** (RPC) — low failure rate (~0.3%), fast latency
- **QuickNode** (RPC) — very low failure rate (~0.1%), moderate latency
- **Jupiter** (DEX Aggregator) — moderate failure rate (~1.5%), variable latency
- **CoinGecko** (Price Feed) — elevated failure rate (~3%), rate limiting patterns
- **DexScreener** (Price Feed) — moderate failure rate (~2%), occasional timeouts
- Realistic time patterns: higher failures during peak hours, occasional outage windows
- Generate 10,000+ records total across providers
**Files:** `backend/src/scripts/seed.ts`
**Test:** Run script, verify 10K+ records in DB, verify provider stats look realistic.

### 1.11 Backend — Docker + Deployment
**Priority:** HIGH | **Complexity:** Medium | **Due:** Apr 10
**Depends on:** 1.6-1.9
**Description:** Dockerize backend. Caddy reverse proxy config for api.pactnetwork.io. Deploy to 34.87.125.241. CORS headers for scorecard.pactnetwork.io.
**Files:** `backend/Dockerfile`, `backend/docker-compose.yml`, `Caddyfile`
**Test:** `docker compose up` works, API accessible at api.pactnetwork.io, CORS allows scorecard origin.

---

## Phase 2: Reliability Scorecard (Dashboard)

### 2.1 Scorecard — Project Setup
**Priority:** HIGH | **Complexity:** Low | **Due:** Apr 10
**Depends on:** nothing (parallel with backend)
**Description:** Set up standalone web app (Next.js or Astro or Vite+React). Configure design system from DESIGN.md: dark bg #151311, copper #B87333, burnt sienna #C9553D, slate #5A6B7A. Fonts: Inria Serif (headlines), Inria Sans (body), JetBrains Mono (data). Brutalist aesthetic — zero/minimal border radius, no emojis, no gradients.
**Files:** `scorecard/`, `scorecard/src/styles/`
**Test:** Dev server runs, base theme matches design system.

### 2.2 Scorecard — Ranked Provider Table
**Priority:** HIGH | **Complexity:** Medium | **Due:** Apr 11
**Depends on:** 2.1, 1.9 (needs API)
**Description:** Main page: table of all providers ranked by insurance rate (lowest first). Columns: provider name, category (RPC/Price Feed/MCP Tool), total calls, failure rate (%), avg latency (ms), uptime (%), insurance rate, reliability tier badge (RELIABLE/ELEVATED/HIGH RISK).
**Files:** `scorecard/src/components/ProviderTable.tsx`
**Test:** Displays 5+ providers with all columns populated. Sorted by insurance rate.

### 2.3 Scorecard — Insurance Rate Calculation
**Priority:** HIGH | **Complexity:** Low | **Due:** Apr 11
**Depends on:** 1.9
**Description:** Compute insurance rate from failure rate. Requirements:
- 0.1% failure → ~0.2-0.3% insurance rate
- 5% failure → ~7-8% insurance rate
- Floor: no provider gets 0% (minimum ~0.1%)
- Derived from real data, never hardcoded
- Suggested formula: `rate = max(0.001, failureRate * 1.5 + 0.001)` (adjust multiplier to hit targets)
- Tiers: RELIABLE (<1%), ELEVATED (1-5%), HIGH RISK (>5%)
**Files:** `scorecard/src/utils/insurance.ts` or `backend/src/utils/insurance.ts` (compute server-side)
**Test:** Unit test with known failure rates, verify output matches expected ranges.

### 2.4 Scorecard — Provider Detail View
**Priority:** HIGH | **Complexity:** Medium | **Due:** Apr 11-12
**Depends on:** 2.2, 1.9
**Description:** Click provider → detail page showing:
- Summary stats (failure rate, latency, uptime, insurance rate, tier)
- Failure rate over time chart (hourly/daily, line chart)
- Failure type breakdown (pie/bar: timeout vs error vs schema_mismatch)
- Top endpoints by call volume and failure rate
**Charts:** Use Recharts or Chart.js. Match design system colors.
**Files:** `scorecard/src/pages/provider/[id].tsx`, `scorecard/src/components/Charts/`
**Test:** Detail page loads for each seeded provider, chart renders with data.

### 2.5 Scorecard — Auto-Refresh
**Priority:** MEDIUM | **Complexity:** Low | **Due:** Apr 11
**Depends on:** 2.2
**Description:** Scorecard data refreshes every 30 seconds without page reload. Use polling or SSE. Show subtle refresh indicator (not disruptive).
**Files:** `scorecard/src/hooks/useAutoRefresh.ts`
**Test:** Seed new data → appears on scorecard within 30s without manual reload.

### 2.6 Scorecard — Deploy
**Priority:** HIGH | **Complexity:** Low | **Due:** Apr 12
**Depends on:** 2.1-2.5
**Description:** Static build, deploy to same VM (34.87.125.241) or Vercel. Caddy config for scorecard.pactnetwork.io. Verify public URL accessible.
**Files:** `scorecard/Dockerfile` or Vercel config, `Caddyfile` update
**Test:** scorecard.pactnetwork.io loads, shows live data, judges can browse.

---

## Execution Schedule

| Day | Tasks | Milestone |
|-----|-------|-----------|
| Apr 7 | 1.1, 1.2, 1.6 (parallel: SDK core + backend scaffold) | SDK wraps calls, backend boots |
| Apr 8 | 1.3, 1.7, 1.8, 2.1 (parallel: SDK storage + backend endpoints + scorecard setup) | SDK stores locally, backend accepts data |
| Apr 9 | 1.4, 1.5, 1.9 (SDK sync + publish + public API) | SDK installable, API live |
| Apr 10 | 1.10, 1.11, 2.2, 2.3 (seed data + deploy backend + scorecard table) | Backend deployed with data |
| Apr 11 | 2.4, 2.5 (detail view + auto-refresh) | Scorecard feature-complete |
| Apr 12 | 2.6, polish, demo prep | Ship |

## Open Decisions (Alan's call)
1. **SDK storage**: SQLite (heavier, better queries) vs JSON file (simpler, faster MVP) → Recommend JSON for hackathon
2. **Backend framework**: Hono (lightweight) vs Fastify (ecosystem) → Either works
3. **Backend DB**: PostgreSQL (production) vs SQLite (simpler deploy) → SQLite for hackathon, single file
4. **Scorecard framework**: Next.js (SSR) vs Vite+React (SPA) → Vite+React, simpler for static deploy
5. **x402 USDC**: Manual override for hackathon (PRD suggests this is fine)
6. **CORS**: Caddy handles it if both on same VM → simplest approach
