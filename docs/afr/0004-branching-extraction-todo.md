# 0004 — Branching Extraction TODO

Status: `active`
Scope: clean-break refactor (no backward-compat bridge)

## Execution Order

- [x] 1) Extract `sync-user` orchestration sprawl into explicit machine transitions
  - Problem: `packages/sync/src/sync-user.ts` contains broad branching for lock/provision/invalidated/backoff/failure routing.
  - Target: orchestration becomes dispatch + side-effect execution + aggregation only.
  - Acceptance:
    - No business-policy `if` trees for retry/disable/failure class in `sync-user` loop.
    - Transition outputs drive callback payloads deterministically.
    - Adversarial tests cover invalidation/deadline/abort/failure permutations.

- [x] 2) Make destination execution outcome semantics first-class (no throw-driven control flow)
  - Problem: runtime currently throws on `CONFLICT_DETECTED` / missing transition.
  - Target: explicit typed outcomes returned and consumed by caller policy.
  - Acceptance:
    - `dispatch` returns discriminated result including conflict/no-transition outcomes.
    - Caller policy handles each outcome deterministically.
    - Concurrency/conflict tests validate no surprise throws on expected contention.

- [x] 3) Consolidate repeated provider ingestion pipelines (OAuth/CalDAV/ICS) into one runner
  - Problem: duplicated lifecycle wiring + try/catch + logging across 3 branches in `services/cron/src/jobs/ingest-sources.ts`.
  - Target: one ingestion runner with provider adapter hooks.
  - Acceptance:
    - Shared runner owns machine dispatching and outcome/log flow.
    - Provider-specific behavior isolated in adapters.
    - Existing behavior preserved via contract tests.

- [x] 4) Centralize ingestion error classification -> machine event mapping
  - Problem: repeated ad-hoc `isNotFound` / auth / transient mapping.
  - Target: single classifier producing enum-backed failure category + code.
  - Acceptance:
    - One classifier path used by all provider adapters.
    - No inlined catch-branch mapping duplication.
    - Tests for ambiguous/provider-specific error shapes.

- [x] 5) Refactor provider resolution into strategy registry (remove nullable flow-control branching)
  - Problem: `resolve-provider.ts` uses chained provider checks + `null` semantics.
  - Target: typed provider strategy resolution result (ready/not-configured/not-supported/missing-credentials).
  - Acceptance:
    - No chained provider `if`s in orchestration path.
    - Caller decisions based on typed resolution outcomes.
    - Tests cover all provider capability states.

- [x] 6) Simplify ingestion orchestrator actor/event mapping hotspots
  - Problem: redundant actor mapping branch in `ingestion-orchestrator`.
  - Target: concise, explicit mapping with no unreachable/default drift.
  - Acceptance:
    - Mapping reduced to deterministic table/switch.
    - Exhaustive compile-time checks for event variants.

- [x] 7) Replace command handling `if` chains with deterministic command executors
  - Problem: `sync-lifecycle-orchestrator` command routing is chained branching.
  - Target: command executor map/switch per command type.
  - Acceptance:
    - Single dispatch structure per command type.
    - Easy extension without branching drift.

- [x] 8) Convert composition output routing to declarative mapping table
  - Problem: `machine-composition-coordinator` manually maps outputs to lifecycle events.
  - Target: output->domain-event routing table.
  - Acceptance:
    - No ad-hoc output scanning branches.
    - Routing table tested for all output variants.

## Cross-Cutting Requirements (applies to all items)

- [ ] No fallback runtime defaults that hide missing data.
- [ ] Enum-first policy vocabulary (no mixed string literals for same concept).
- [ ] Adversarial tests for race/conflict/duplicate/stale-event paths.
- [ ] Deterministic envelope + event mapping boundaries.
- [ ] Wide logging remains unit-of-work scoped and machine-field rich.

## Current Work Item

- Complete: **All listed refactor items executed in this slice**
