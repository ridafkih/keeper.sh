# 0009 — Runtime Concurrency Hardening (D1–D7)

Status: `active`
Scope: Phase D (`D1`–`D7`)

## Objective

Harden runtime behavior under adversarial parallel dispatch/replay so machine side effects remain single-application and deterministic.

## Findings

- `MachineRuntimeDriver` already enforces correctness with snapshot compare-and-set, envelope dedup, and explicit `CONFLICT_DETECTED` outcomes.
- `destination-execution-runtime` already surfaced conflict/duplicate outcomes.
- `source-ingestion-lifecycle-runtime` and `credential-health-runtime` previously treated `DUPLICATE_IGNORED` as missing transition, which could raise false invariant errors during replay.
- `credential-health-runtime` also allowed concurrent refresh calls to race.

## Implemented

- Added duplicate-safe no-op transition handling:
  - `services/cron/src/lib/source-ingestion-lifecycle-runtime.ts`
  - `packages/sync/src/credential-health-runtime.ts`
- Added refresh coalescing in credential runtime:
  - concurrent `refresh()` calls now share one in-flight operation per runtime instance.
- Added adversarial runtime tests:
  - parallel terminal dispatch does not duplicate side effects:
    - `packages/sync/src/destination-execution-runtime.test.ts`
  - parallel refresh coalesces to one external refresh call:
    - `packages/sync/src/credential-health-runtime.test.ts`
  - duplicate replay is ignored without repeated side effects:
    - `services/cron/src/lib/source-ingestion-lifecycle-runtime.test.ts`
- Added explicit duplicate-replay tests for runtime adapters:
  - `packages/sync/src/destination-execution-runtime.test.ts`
  - `services/cron/src/lib/source-ingestion-lifecycle-runtime.test.ts`
  - `services/worker/src/push-job-arbitration-runtime.test.ts`
- Added stale terminal-event tests:
  - `packages/sync/src/destination-execution-runtime.test.ts`
  - `services/cron/src/lib/source-ingestion-lifecycle-runtime.test.ts`
- Added conflict-policy tests:
  - extracted and covered destination conflict policy behavior in
    `packages/sync/src/dispatch-conflict-policy.ts`
    with tests in `packages/sync/src/dispatch-conflict-policy.test.ts`
  - covered conflict event accounting in widelog sinks:
    - `services/worker/src/utils/machine-runtime-widelog.test.ts`
    - `services/cron/src/utils/machine-runtime-widelog.test.ts`
- Added outbox corruption coverage for all active runtime namespaces:
  - `machine:outbox:destination-execution`
  - `machine:outbox:credential-health`
  - `machine:outbox:source-ingestion-lifecycle`
  - `machine:outbox:push-arbitration`
  - implemented in
    `packages/machine-orchestration/src/machine-runtime-driver.test.ts`
- Added startup+interval recovery idempotency coverage:
  - worker credential-health recovery drains once even when recovery runs twice:
    - `services/worker/src/recovery/credential-health-outbox-recovery.test.ts`
  - cron source-ingestion recovery drains once even when recovery runs twice:
    - `services/cron/src/recovery/source-ingestion-outbox-recovery.test.ts`
  - worker push-arbitration pending recovery drains once across repeated runs:
    - `services/worker/src/push-job-arbitration-runtime.test.ts`

## Validation

- `bun test packages/sync/src/destination-execution-runtime.test.ts packages/sync/src/credential-health-runtime.test.ts services/cron/src/lib/source-ingestion-lifecycle-runtime.test.ts`
- `bunx turbo run lint types --filter=./packages/sync --filter=./services/cron`
- `bun test` (repo root)
- `bun test packages/sync/src/dispatch-conflict-policy.test.ts services/worker/src/utils/machine-runtime-widelog.test.ts services/cron/src/utils/machine-runtime-widelog.test.ts`
- `bunx turbo run lint types --filter=./packages/sync --filter=./services/cron --filter=./services/worker`
- `bun test packages/machine-orchestration/src/machine-runtime-driver.test.ts`
- `bunx turbo run lint types --filter=./packages/machine-orchestration`
- `bun test services/worker/src/recovery/credential-health-outbox-recovery.test.ts services/cron/src/recovery/source-ingestion-outbox-recovery.test.ts services/worker/src/push-job-arbitration-runtime.test.ts`
- `bun test` (repo root)
