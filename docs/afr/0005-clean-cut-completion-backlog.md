# 0005 — Clean-Cut Completion Backlog

Status: `active`
Mode: `clean-break` (no compatibility bridge)

## Definition of Done

- [ ] Machine runtimes are the only orchestration path for ingest/push/provision/credential/token flows.
- [ ] Legacy orchestration paths are deleted (not bypassed).
- [ ] No hidden fallbacks/defaults in machine-critical runtime paths.
- [ ] Error/failure vocabulary is enum-first and consistent across packages.
- [ ] Adversarial tests cover conflict/duplicate/stale/replay/corruption/failure classes.
- [ ] Widelog units are deterministic and self-contained (per-calendar + per-job).
- [ ] `bun test` passes at repo root.
- [ ] Cutover checklist is fully complete and reviewed.

## Phase A — Vocabulary and Type Unification

- [ ] A1. Create shared failure enums for ingestion outcomes.
- [ ] A2. Create shared failure enums for destination execution outcomes.
- [ ] A3. Create shared failure enums for credential refresh outcomes.
- [ ] A4. Replace string literal failure tags in machine outputs with enums.
- [x] A5. Replace string literal failure tags in orchestrators with enums.
- [x] A6. Replace string literal failure tags in runtime adapters with enums.
- [x] A7. Replace string literal failure tags in logging classification with enums.
- [x] A8. Remove duplicate union type aliases that mirror enum values.
- [ ] A9. Centralize error-code mapping helpers behind enum-returning functions.
- [ ] A10. Add compile-time exhaustiveness checks via typed mapping records.
- [ ] A11. Add tests for each enum mapping edge case.
- [ ] A12. Delete now-unused string-literal constants.

## Phase B — Branching Hotspot Extraction

- [x] B1. Identify remaining non-machine policy branches in `packages/sync`.
- [x] B2. Identify remaining non-machine policy branches in `services/cron`.
- [x] B3. Identify remaining non-machine policy branches in `services/worker`.
- [x] B4. Extract retry decisioning into machine transition outputs.
- [ ] B5. Extract disable decisioning into machine transition outputs.
- [ ] B6. Extract reauth decisioning into machine transition outputs.
- [ ] B7. Extract backoff schedule decisioning into machine transition outputs.
- [ ] B8. Replace orchestration `if` trees with deterministic command/event dispatch tables.
- [ ] B9. Move any remaining provider-specific policy logic into adapter boundaries.
- [ ] B10. Add tests ensuring orchestration layers no longer encode business policy.

## Phase C — Determinism and Invariant Hardening

- [x] C1. Audit machine runtime constructors for optional fallback defaults.
- [x] C2. Remove optional fallback defaults from runtime-critical constructors.
- [x] C3. Enforce required envelope metadata in all internal dispatch builders.
- [x] C4. Ensure no auto-generated envelope IDs in runtime paths.
- [x] C5. Ensure no auto-generated envelope timestamps in runtime paths.
- [x] C6. Add invariant checks for malformed envelope payloads.
- [x] C7. Add invariant checks for malformed outbox records (all stores).
- [x] C8. Add invariant checks for invalid snapshot transitions.
- [x] C9. Add tests for invariant failures and deterministic error surfaces.
- [x] C10. Ensure invariant violations fail fast with typed errors.

## Phase D — Concurrency and Recovery Robustness

- [x] D1. Re-audit per-aggregate serialization guarantees in runtime driver.
- [x] D2. Add adversarial parallel dispatch tests for every runtime adapter.
- [x] D3. Add duplicate envelope replay tests per machine aggregate.
- [x] D4. Add stale terminal-event tests per machine aggregate.
- [ ] D5. Add conflict-detected handling tests for all caller policies.
- [x] D6. Add outbox corruption tests for each outbox namespace.
- [x] D7. Add outbox recovery idempotency tests (startup + interval).
- [x] D8. Verify no double-execution when recovery and live traffic overlap.
- [x] D9. Verify no command loss after process restart.
- [x] D10. Verify no stuck aggregate after partial command execution failures.

## Phase E — Widelog Contract Finalization

- [ ] E1. Define canonical per-calendar widelog contract fields in docs.
- [ ] E2. Define canonical per-job widelog contract fields in docs.
- [ ] E3. Ensure each per-calendar unit starts one context and flushes once.
- [ ] E4. Ensure per-job context is separate from per-calendar contexts.
- [ ] E5. Remove any immediate context+flush wrappers that act as plain logs.
- [ ] E6. Normalize machine field naming across cron/worker/api.
- [ ] E7. Add tests asserting per-calendar log isolation.
- [ ] E8. Add tests asserting per-job summary log isolation.
- [ ] E9. Add tests asserting correlation IDs and calendar sync IDs are deterministic.
- [ ] E10. Add tests asserting no field bleed between calendar units.

## Phase F — Clean Cutover (Delete Legacy)

- [ ] F1. Enumerate legacy orchestration entrypoints still reachable.
- [ ] F2. Remove legacy ingestion orchestration paths.
- [ ] F3. Remove legacy destination execution orchestration paths.
- [ ] F4. Remove legacy credential refresh orchestration paths.
- [ ] F5. Remove legacy sync lifecycle orchestration paths.
- [ ] F6. Remove legacy source provisioning orchestration paths.
- [ ] F7. Remove deprecated helpers replaced by machine adapters.
- [ ] F8. Remove dead tests tied to deleted legacy behavior.
- [ ] F9. Remove dead feature flags no longer needed post-cutover.
- [ ] F10. Verify build graph has no imports from deleted paths.

## Phase G — Validation and Operational Readiness

- [ ] G1. Run package-level lint/types/tests for each touched package.
- [ ] G2. Run full repository test suite.
- [ ] G3. Dry-run cron startup to validate job loading and recovery startup paths.
- [ ] G4. Dry-run worker startup to validate recovery startup paths.
- [ ] G5. Validate machine metrics/logging cardinality remains bounded.
- [ ] G6. Validate no memory growth from per-calendar machine field accumulation.
- [ ] G7. Update `docs/StateMachineCleanCutoverChecklist.md` completion status.
- [ ] G8. Publish final architecture + flow docs for handoff.

## Immediate Execution Queue

- [ ] Q1. Execute Phase A task set A1–A4 in first patch.
- [x] Q2. Execute Phase A task set A5–A8 in second patch.
- [x] Q3. Execute Phase B task set B1–B4 in third patch.
- [x] Q4. Execute Phase C task set C1–C4 in fourth patch.
