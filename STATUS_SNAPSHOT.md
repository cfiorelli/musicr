# Musicr Status Snapshot

**Generated:** 2026-02-17; updated 2026-02-20 (Aboutness V2)

---

## Aboutness V2 Status (updated 2026-02-20)

| Item | Status |
|---|---|
| V1 metadata-derived approach | **REMOVED** — 10,000 legacy rows purged from DB |
| OpenAI provider decision | **FINALIZED** — gpt-4o-mini, title+artist only |
| Local model comparison | **CLOSED** — A/B pilot ran Feb 2026, OpenAI won |
| Schema migration | **APPLIED** — `20260220000000_aboutness_v2_emotions_moments` |
| New columns | emotions_text/vector/confidence, moments_text/vector/confidence, provider, generation_model |
| emotions_vector index | **CREATED** — HNSW cosine (`idx_song_aboutness_emotions_hnsw`) |
| moments_vector index | **NOT indexed** (rerank on candidate set only, deliberate) |
| Generator service | `apps/api/src/services/aboutness/generator.ts` |
| Backfill script | `apps/api/scripts/ingestion/aboutness-v2-backfill.ts` |
| Sample review script | `apps/api/scripts/ingestion/aboutness-v2-sample-review.ts` |
| API matching | V2 3-signal path added (`ABOUTNESS_V2_ENABLED` flag, default false) |
| UI Why panel | Updated for V2 emotions/moments display |
| V2 rows in DB | **0** — backfill not yet run in prod |
| Feature flag | `ABOUTNESS_V2_ENABLED=false` — off in prod pending backfill |

**To enable in prod:**
1. Run backfill (`--limit=50` first to validate, then full)
2. Set `ABOUTNESS_V2_ENABLED=true` in Railway Variables
3. Redeploy API

**Rollback:** Set `ABOUTNESS_V2_ENABLED=false` → redeploy.

---

---

## 1. Repo State

| Field | Value |
|---|---|
| Current branch | `main` |
| Working tree | **Clean** (no uncommitted changes) |
| Local vs origin/main | **Even** (0 ahead, 0 behind) |
| Uncommitted files | None |
| Unpushed commits | None |

### Latest 20 commits (newest first)

```
c1985c9 Fix embedding model mismatch: re-embed all 114k songs with local model
565f2c5 Show HN: tighten README for launch, add score tooltip
8c1d6ff Fix 12 dependency vulnerabilities via bumps and pnpm overrides
2493d8d Ingestion: add canonical artist fields for diversity tracking
86156e0 Catalog expansion: 50k→111k songs with diversity caps and rollback support
9e67ccd Show HN hardening: static shell, maintenance mode, rate limits, input caps
3b85448 Fix iOS input auto-zoom with iOS-only form-control font-size rule
8e82d97 UI: YouTube-style flat thread groups (single indent, vertical spine)
09e075a UI: fix thread indent compounding + text overflow; improve empty-state clarity
4f12620 Improve reply UX: nested threading, inline composer, action icons, About modal
337db70 Sanitize placeholder API keys in docs to prevent gitleaks false positives
3354dad Add security hardening: secret scanning CI, dependabot, rotation runbook
0350dbf Add one-level message threading with collapsed replies and density improvements
0a66b65 Add DB storage cleanup script and monitoring query
c09a12d Add minimal builder-credit footer with profile and GitHub links
a8bf153 Redesign onboarding: explain the chat+song paradigm, remove confusing mood prompt
ec510eb Fix: persist messages even when song matching fails
5308237 Fix iOS auto-zoom: move font-size rule outside @layer, add regression guard
7b95846 Harden iOS auto-zoom prevention: robust input selector
473cf12 Fix message consistency: ID-based dedup, cross-instance sync, stable timestamps
```

---

## 2. What Changed Recently

Commits from the last 7 days (2026-02-10 through 2026-02-17): **6 commits**, all on 2026-02-15 and 2026-02-16. Summary of the last 30 commits covers approximately 3 weeks of work.

### Security / Deps

| Commit | Summary | Key files |
|---|---|---|
| `8c1d6ff` | Fix 12 dependency vulnerabilities via bumps and pnpm overrides | `package.json`, `apps/web/package.json`, `pnpm-lock.yaml` |
| `337db70` | Sanitize placeholder API keys in docs to prevent gitleaks false positives | `INGESTION-IMPLEMENTATION.md`, `PHASE2-CHECKLIST.md`, `PHASE2-SUMMARY.md`, `RUNBOOK-INGEST.md`, `apps/api/scripts/ingestion/README.md` |
| `3354dad` | Add secret scanning CI, dependabot config, rotation runbook | `.github/dependabot.yml`, `.github/workflows/secret-scan.yml`, `.gitignore`, `README.md`, `SECURITY.md` |

### API / WS

| Commit | Summary | Key files |
|---|---|---|
| `c1985c9` | Fix embedding model mismatch: re-embed all 114k songs with local model | `apps/api/prisma/schema.prisma`, `apps/api/scripts/ingestion/embedding-backfill.ts`, `apps/api/src/index.ts`, `apps/api/src/services/database.ts`, migration SQL |
| `9e67ccd` | Show HN hardening: static shell, maintenance mode, rate limits, input caps | `apps/api/src/index.ts`, `apps/web/src/App.tsx`, `apps/web/src/stores/chatStore.ts`, `apps/web/index.html` |
| `0350dbf` | Add one-level message threading with collapsed replies | `apps/api/src/index.ts`, `apps/api/prisma/schema.prisma`, `apps/api/src/services/redis-service.ts`, `apps/web/src/components/ChatInterface.tsx` |
| `473cf12` | Fix message consistency: ID-based dedup, cross-instance sync | `apps/api/src/index.ts`, `apps/api/src/services/redis-service.ts`, `apps/web/src/stores/chatStore.ts` |
| `ec510eb` | Fix: persist messages even when song matching fails | `apps/api/src/index.ts` |
| `8b4823e` | Fix reaction button: resolve optimistic message ID mismatch | `apps/api/src/index.ts`, `apps/web/src/stores/chatStore.ts` |
| `beb1871` | Fix pgvector query planner issue causing 0 results | debug/test scripts |
| `8ebdee9` | Add detailed logging for semantic search 0-result edge cases | `apps/api/src/services/song-matching-service.ts` |
| `31e6f59` | Fix Bohemian Rhapsody degenerate matching bug | `apps/api/src/engine/matchers/semantic.ts`, `apps/api/src/services/song-matching-service.ts` |
| `56d457d` | Fix production issues: matching, reactions, identity, iOS | `apps/api/src/engine/matchers/semantic.ts`, `apps/api/src/index.ts`, `apps/api/src/services/user-service.ts`, `apps/web/src/components/ChatInterface.tsx` |
| `dae8bf1` | Fix Railway API build: remove unused variable (TS6133) | `apps/api/src/services/song-matching-service.ts` |
| `64a7d81` | Fix CI: use pnpm/action-setup and provide dummy DATABASE_URL | `.github/workflows/ci.yml` |
| `0b6ab2f` | Fix CI: Use Corepack to respect packageManager pnpm@8.15.5 | `.github/workflows/ci.yml` |

### Web / UX

| Commit | Summary | Key files |
|---|---|---|
| `565f2c5` | Show HN: tighten README for launch, add score tooltip | `README.md`, `apps/web/src/components/ChatInterface.tsx` |
| `3b85448` | Fix iOS input auto-zoom with iOS-only form-control font-size rule | `apps/web/src/index.css` |
| `8e82d97` | UI: YouTube-style flat thread groups (single indent, vertical spine) | `apps/web/src/components/ChatInterface.tsx` |
| `09e075a` | UI: fix thread indent compounding + text overflow | `apps/web/src/components/ChatInterface.tsx` |
| `4f12620` | Improve reply UX: nested threading, inline composer, action icons, About modal | `apps/web/src/components/ChatInterface.tsx`, `apps/web/src/App.tsx`, `apps/api/src/index.ts` |
| `a8bf153` | Redesign onboarding: explain chat+song paradigm | `apps/web/src/components/ChatInterface.tsx` |
| `c09a12d` | Add minimal builder-credit footer | `apps/web/src/App.tsx` |
| `39ee3a2` | Fix emoji picker not opening: move modal outside backdrop-filter | `apps/web/src/components/ChatInterface.tsx` |
| `7fe2f9d` | Surface silent reaction failures: warn when WS disconnected | `apps/web/src/stores/chatStore.ts` |
| `5308237` | Fix iOS auto-zoom: move font-size rule outside @layer | `apps/web/src/index.css`, `apps/web/src/components/ChatInterface.tsx` |
| `7b95846` | Harden iOS auto-zoom prevention | `apps/web/src/index.css`, `apps/web/src/components/ChatInterface.tsx` |

### Infra / Deploy / Ops

| Commit | Summary | Key files |
|---|---|---|
| `2493d8d` | Ingestion: add canonical artist fields for diversity tracking | `apps/api/prisma/schema.prisma`, migration SQL, `apps/api/scripts/ingestion/musicbrainz-bulk-importer.ts` |
| `86156e0` | Catalog expansion: 50k→111k songs with diversity caps and rollback support | `apps/api/prisma/schema.prisma`, migration SQL, `apps/api/scripts/ingestion/ingest.sh`, `apps/api/scripts/ingestion/musicbrainz-bulk-importer.ts` |
| `0a66b65` | Add DB storage cleanup script and monitoring query | `apps/api/scripts/db-storage-check.sql`, `apps/api/scripts/db-storage-cleanup.ts` |

### Docs

| Commit | Summary | Key files |
|---|---|---|
| `337db70` | Sanitize placeholder API keys in docs | Multiple `*.md` files |
| `3354dad` | Add SECURITY.md, rotation runbook | `SECURITY.md`, `README.md` |

---

## 3. P0 Checklist Status

| Check | Status | Evidence |
|---|---|---|
| Dependabot triage merged? | **YES** | `.github/dependabot.yml` present (weekly npm + GitHub Actions). Commit `8c1d6ff` explicitly fixes 12 dep vulns via bumps + pnpm overrides. |
| BLOCKED_IPS implemented for REST + WS? | **NO** | Grep for `BLOCKED_IPS`, `blocked_ip`, `blocklist`, `banned` across `apps/api` returned **zero matches**. Rate limiting exists (`RateLimiter` class in use) but no IP blocklist mechanism. |
| `/health` includes `X-Instance-Id`? | **YES** | `apps/api/src/index.ts:72` — `reply.header('X-Instance-Id', INSTANCE_ID)` set on **all responses** via `onSend` hook. `/health` endpoint at line 497 also includes `instanceId` in the JSON body. |
| No-JS fallback exists? | **YES** | `apps/web/index.html:42-46` — `<noscript>` block with styled message present. |
| Pre-HN checklist doc exists? | **NO** | No file matching `PRE-HN*` found. `PHASE2-CHECKLIST.md` exists but is a Phase 2 implementation checklist, not a pre-HN launch checklist. |
| HN.md exists with "chat-first + discovery as side effect" framing? | **NO** | No `HN.md` file found anywhere in the repo. The README does describe the product ("type anything, get a song that matches the meaning") but there is no dedicated HN post/framing document. |
| CLAUDE.md exists with rules? | **NO** | No `CLAUDE.md` file found in the repo. |
| Secret-looking strings in repo history? | **YES (sanitized)** | Commit `3a7c0d2` added docs containing `sk-proj-...` placeholder patterns in `INGESTION-IMPLEMENTATION.md` and `RUNBOOK-INGEST.md`. These were explicitly sanitized in commit `337db70`. Current tree is clean — no real API keys found. `.github/workflows/secret-scan.yml` exists for ongoing scanning. No `.env` files were ever committed. |

---

## 4. Production Config Cues

### Railway Configuration

| File | Purpose |
|---|---|
| `apps/api/railway.toml` | API service — start command: `pnpm start:railway`, healthcheck: `/health`, timeout: 300s, restart: on_failure |
| `railway.toml` (root) | Root build config — Nixpacks builder, installs pnpm@8.15.5, runs `prisma generate`, builds shared + API packages. Deploy: `cd apps/api && node dist/index.js`, healthcheck `/health`. Declares postgres DB `musicr`. |
| `apps/web/railway.json` | Web service — start: `npm start`, restart: on_failure |
| `apps/web/nixpacks.toml` | Web Nixpacks — setup corepack, `pnpm install --frozen-lockfile`, `pnpm run build`, start: `pnpm start` |

### Prisma Migrate References

| Location | Context |
|---|---|
| `apps/api/package.json:11` | `"start:railway": "prisma migrate deploy && node dist/index.js"` — **production start command runs migrations** |
| `apps/api/package.json:16-18` | Dev scripts: `db:push`, `db:migrate`, `db:migrate:deploy` |
| `apps/api/scripts/deploy-and-verify.sh:18` | `pnpm prisma migrate deploy` |
| `deploy.sh:129,133` | Docker-compose based deploy script runs `migrate deploy`, falls back to `db push` |
| `apps/api/src/index.ts:1267` | Comment: "Manual schema creation since Railway might not support migrate deploy" |

### Semantic Match Implementation

**Embedding model:** `Xenova/all-MiniLM-L6-v2` (384-dim, local, server-side). OpenAI as fallback.

**Key files:**

| File | Role |
|---|---|
| `apps/api/src/engine/matchers/semantic.ts` | KNN searcher — cosine similarity via `embedding_vector <=> q.vec` (pgvector operator) |
| `apps/api/src/services/song-matching-service.ts` | Orchestrator — calls `findEmbeddingMatches()`, sole matching strategy is embedding-based |
| `apps/api/src/embeddings/service.ts` | Embedding service — primary: local Xenova, fallback: OpenAI |
| `apps/api/src/embeddings/providers/local.ts` | Local provider using `@xenova/transformers` pipeline |
| `apps/api/src/embeddings/providers/openai.ts` | OpenAI fallback provider |
| `apps/api/src/engine/rerank.ts` | Re-ranking layer |
| `apps/api/src/services/song-search-service.ts` | Song search service |

**What gets embedded for songs:** Title + artist + tags + album metadata (per README line 17: "Matching is based on title + artist + tags + album metadata (no lyrics)"). The `embedding_vector` column (native pgvector, 384-dim) is searched via HNSW index with cosine distance.

---

## 5. Open Risks / TODOs

### From code + docs inspection

| # | Risk / TODO | Source | Location |
|---|---|---|---|
| 1 | **No IP blocklist (BLOCKED_IPS)** — rate limiting exists but no mechanism to block specific abusive IPs from REST or WS | Code inspection | `apps/api/src/index.ts` — absent |
| 2 | **No CLAUDE.md** — no project-level AI assistant rules file | File search | Repo root — absent |
| 3 | **No HN.md** — no dedicated Show HN post/framing document | File search | Repo root — absent |
| 4 | **No Pre-HN launch checklist** — no `PRE-HN-CHECKLIST.md` or similar | File search | Repo root — absent |
| 5 | **Response time instrumentation stubbed** — "No Instrumentation: Response time tracking stubbed (TODO comments)" | `PHASE2-AUDIT.md:26` | `PHASE2-AUDIT.md` line 26 |
| 6 | **Dual railway.toml conflict** — root `railway.toml` start command is `cd apps/api && node dist/index.js` (no migrate), while `apps/api/railway.toml` uses `pnpm start:railway` (with migrate). Unclear which Railway actually uses. | Config inspection | `railway.toml` vs `apps/api/railway.toml` |
| 7 | **Historical secrets in git** — `sk-proj-...` patterns exist in git history (pre-sanitization, commit `3a7c0d2`). Current tree is clean, but the history still contains them. Consider `git filter-branch` or BFG if the repo goes public. | Git history search | Commit `3a7c0d2` → sanitized in `337db70` |
| 8 | **`index.ts.backup` file** — `apps/api/src/index.ts.backup` exists in the working tree, containing an older copy of the main server file. Should be deleted or gitignored. | File inspection | `apps/api/src/index.ts.backup` |
| 9 | **Disabled test file** — `apps/api/src/services/__tests__/api-map-integration.test.ts.disabled` suggests an integration test that was disabled rather than fixed | File inspection | `apps/api/src/services/__tests__/` |
| 10 | **Large doc sprawl** — 28+ markdown files at repo root (many are implementation journals/audits). Consider consolidating into `docs/` directory. | `ls *.md` | Repo root |

---

## Appendix: Repo Documentation Index

Root-level markdown files (28):
`ARCHITECTURE.md`, `CATALOG_EXPANSION_GUIDE.md`, `CI_FIXES.md`, `CI_SETUP.md`, `CONTRIBUTING.md`, `DEPLOY-NATIVE-VECTOR.md`, `EMOJI_REACTIONS_IMPROVEMENTS.md`, `ESC_ALTERNATES_CHANGES.md`, `INGESTION-IMPLEMENTATION.md`, `LOCALSTORAGE_IDENTITY.md`, `MATCHING-BUG-INVESTIGATION.md`, `MOBILE_ZOOM_FIX.md`, `NSFW_REMOVAL_SUMMARY.md`, `PHASE2-AUDIT.md`, `PHASE2-CHECKLIST.md`, `PHASE2-SUMMARY.md`, `RAILWAY_REDIS_SETUP.md`, `README.md`, `REDIS_DEPLOYMENT.md`, `RUNBOOK-INGEST.md`, `RUNBOOK.md`, `SECURITY.md`, `SPLIT_BRAIN_TEST.md`, `SSL-CONFIG.md`, `VERIFICATION-REPORT.md`, `WEBSOCKET_RECONNECTION.md`, `WHY_BUTTON_SUBTLE_REDESIGN.md`

Docs directory: `docs/CATALOG.md`, `docs/INDEX.md`, plus `docs/archive/` and `docs/quarantine/` subdirectories.
