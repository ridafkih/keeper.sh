# 0010 — Widelog Contract (Per-Calendar + Per-Job)

Status: `active`
Scope: Phase E (`E1`–`E10`)

## Purpose

Define one canonical contract for wide events so each unit-of-work is self-contained and replay/debug correlation is deterministic.

## Unit-of-Work Model

- **Per-calendar unit (`operation.name`)**
  - Worker push: `push-sync-calendar`
  - Cron ingest: `ingest-source`
- **Per-job summary unit (`operation.name`)**
  - Worker job: `push-sync`
  - Cron job: `ingest-sources`

## Required Per-Calendar Fields

- `operation.name` (calendar unit operation)
- `operation.type` (`job`)
- `calendar_sync.id` (deterministic calendar unit id)
- `provider.calendar_id`
- `provider.name`
- `outcome`
- `duration_ms`
- sync deltas:
  - worker: `sync.events_added`, `sync.events_removed`, `sync.events_failed`
  - cron: `sync.events_added`, `sync.events_removed`
- machine counters/state snapshot (when machine runtime emits):
  - `machine.*.processed_total`
  - `machine.*.duplicate_total`
  - `machine.*.conflict_total`
  - `machine.*.commands_total`
  - `machine.*.outputs_total`
  - `machine.*.last_envelope_id`
  - `machine.*.last_event_type`
  - `machine.*.last_state`
  - `machine.*.last_version`
  - `machine.*.aggregate_id`

## Required Per-Job Summary Fields

- `operation.name` (job summary operation)
- `operation.type` (`job`)
- `outcome`
- `duration_ms`
- identity/correlation:
  - worker: `job.id`, `job.name`, `correlation.id`, `user.id`, `user.plan`
  - cron: `operation.name` + batch/result fields from job callback
- aggregate sync totals for summary outcome

## Isolation Rules

- Calendar-wide events and job summary events must flush in separate contexts.
- Job summary event must not include per-calendar fields:
  - `calendar_sync.id`
  - `provider.calendar_id`
  - `machine.*`
- Per-calendar machine fields must not leak across calendars.

## Deterministic `calendar_sync.id` Rules

- Worker push calendar unit: `${job.id}:${calendarId}`
- Cron ingest calendar unit: `${provider}:${calendarId}`
- No fallback ids; required inputs must be present before emitting.

## Current Validation

- Worker per-calendar + summary contract:
  - `services/worker/src/processor.widelog-contract.test.ts`
- Cron per-calendar isolation + deterministic id:
  - `services/cron/src/lib/source-ingestion-runner.widelog-contract.test.ts`
