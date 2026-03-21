# 0010 — Machine-First Architecture Handoff

Status: `active`
Mode: `clean-break`

## Purpose

This document defines the authoritative backend runtime model after the state-machine cutover.

## Authoritative Runtime Boundary

- Transition authority lives in `packages/state-machines/src/*`.
- Orchestration/runtime authority lives in `packages/machine-orchestration/src/*`.
- Service packages (`services/api`, `services/cron`, `services/worker`) are IO/adaptation layers that:
  - create envelopes,
  - call machine runtimes/orchestrators,
  - execute side effects from commands,
  - emit wide events.

## End-to-End Flow: Source Ingestion

1. Cron selects source rows.
2. Cron builds source-ingestion runtime (`createSourceIngestionLifecycleRuntime`).
3. Runtime dispatches machine events (`SOURCE_SELECTED` → `FETCHER_RESOLVED` → terminal event).
4. Machine emits deterministic outputs:
   - `INGEST_COMPLETED`
   - `INGEST_FAILED` with `ErrorPolicy` + `SourceIngestionFailureType`.
5. Cron resolves failure policy from machine output and applies retry/terminal behavior.
6. Runtime wide fields are emitted through machine widelog sink (`machine.source_ingestion_lifecycle.*`).

## End-to-End Flow: Destination Push

1. Worker receives `push-sync` job.
2. Worker delegates to `runKeeperSyncRuntimeForUser` from machine orchestration.
3. For each calendar unit:
   - machine runtime events are processed,
   - per-calendar machine fields are collected and consumed once,
   - one `push-sync-calendar` wide event is emitted with isolated fields.
4. Worker emits one `push-sync` summary wide event for job-level rollup.

## Concurrency + Recovery Guarantees

- Per-aggregate serialization in runtime driver avoids blind transition races.
- CAS conflicts are first-class (`CONFLICT_DETECTED`) outcomes.
- Durable outbox persists command execution progress.
- Recovery paths drain pending outbox work idempotently.

## Logging Contract

- Runtime machine sink writes a fixed bounded key set:
  - `processed_total`, `duplicate_total`, `conflict_total`,
  - `commands_total`, `outputs_total`,
  - `last_envelope_id`, `last_event_type`, `last_state`, `last_version`,
  - `aggregate_id`.
- `calendar_sync.id` is deterministic per calendar unit-of-work.
- Per-calendar field collector lifecycle clears per-calendar state after emit.

## Remaining Environment-Gated Work

- Re-run cron startup dry-run with live DB/Redis.
- Re-run worker startup dry-run with live DB/Redis.
- Perform production smoke verification for credential refresh loop during rollout window.
