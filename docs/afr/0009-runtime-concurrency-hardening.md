# 0009 — Runtime Concurrency Hardening (D1–D2)

Status: `active`
Scope: Phase D (`D1`–`D2`)

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

## Validation

- `bun test packages/sync/src/destination-execution-runtime.test.ts packages/sync/src/credential-health-runtime.test.ts services/cron/src/lib/source-ingestion-lifecycle-runtime.test.ts`
- `bunx turbo run lint types --filter=./packages/sync --filter=./services/cron`
- `bun test` (repo root)
