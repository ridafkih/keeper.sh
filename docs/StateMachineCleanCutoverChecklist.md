# State Machine Clean-Cutover Checklist

This checklist is for a single cutover where the new machine-orchestrated backend path becomes authoritative and legacy orchestration is removed.

## 1) Cutover Readiness Gates

- [ ] `destination_execution` failure routing is machine-owned (`EXECUTION_FAILED` drives backoff vs disable).
- [ ] Per-calendar worker wide event contract is enforced by tests:
  - [ ] one `push-sync-calendar` wide event per calendar unit-of-work
  - [ ] one `push-sync` summary event per worker job
  - [ ] machine counters are isolated per calendar (no cross-calendar accumulation)
- [ ] Deterministic `calendar_sync.id` is emitted on every calendar-wide event.
- [ ] Cron runtime discovery excludes helper runtime modules.
- [ ] Push arbitration concurrency conflicts are eliminated by per-user serialization.
- [ ] Machine runtime CAS contention is modeled as `CONFLICT_DETECTED` (not throw-driven control flow).
- [ ] In-process aggregate locking is active in runtime driver; adapters avoid blind conflict retry loops.

## 2) Authoritative Runtime Boundaries

- [ ] `MachineRuntimeDriver` + runtime adapters are the only transition authority.
- [ ] Runtime command dispatch is outbox-first (`process` enqueues, `drainOutbox` executes).
- [ ] Durable outbox backend is configured for machine command persistence.
- [ ] Durable outbox is wired for `push_job_arbitration`, `destination_execution`, `credential_health`, and `source_ingestion_lifecycle`.
- [ ] Recovery worker drains pending push arbitration outbox aggregates on startup and interval.
- [ ] Add aggregate recovery workers for destination/credential/source outboxes (currently drained inline during runtime dispatch).
- [ ] Application services do orchestration and IO only, not transition logic.
- [ ] Repeated conditional flows (retry/backoff/disable) are encoded as machine events/transitions.
- [ ] Invariant failures are fail-fast and observable (no silent fallbacks).

## 3) Logging and Observability Contract

- [ ] Calendar log fields include:
  - [ ] `calendar_sync.id`
  - [ ] `provider.calendar_id`
  - [ ] machine state/counter fields scoped to that calendar
  - [ ] `machine.*.conflict_total`
  - [ ] `outcome`, `duration_ms`, and sync deltas
- [ ] Job summary log fields include:
  - [ ] job identity + correlation
  - [ ] aggregate totals
  - [ ] overall job outcome
- [ ] No cross-calendar leakage in calendar log machine fields.

## 4) Legacy Deletion Plan

- [ ] Enumerate legacy orchestration entrypoints and helper branches that duplicate machine logic.
- [ ] Remove legacy branch logic after replacement paths are production-enabled.
- [ ] Delete dead helper abstractions and wrappers that only forward to machine runtimes.
- [ ] Delete obsolete tests tied to removed legacy code paths.
- [ ] Keep only tests that validate new machine behavior and contracts.

## 5) Rollout Plan (Single Cut)

- [ ] Freeze concurrent backend behavior refactors during cutover window.
- [ ] Deploy cutover build with machine path authoritative.
- [ ] Run smoke checks for:
  - [ ] source ingestion loop
  - [ ] destination push loop
  - [ ] credential refresh flow
- [ ] Verify log contracts in production telemetry.
- [ ] Remove any temporary toggles/shims used only for rollout safety.

## 6) Post-Cutover Hardening

- [ ] Run dead code scan and remove unreachable paths.
- [ ] Re-run full lint/types/tests and fix regressions.
- [ ] Update architecture docs to reference machine-first orchestration only.
- [ ] Capture follow-up improvements as new slices (not as compatibility shims).
