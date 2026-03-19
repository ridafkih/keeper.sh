# IngestionMachine

## Goal
Provide one normalized ingestion state machine for OAuth, CalDAV, and ICS sources.

This machine unifies duplicated ingestion flow logic and error transitions while keeping provider-specific fetch behavior in adapters.

## Scope
**In scope**
- Per-source ingest lifecycle.
- Canonical error classification and transitions.
- Change detection outputs (`source_changed`, `no_change`).
- Account/calendar remediation outputs (`needsReauth`, `disabled`).

**Out of scope**
- User-level queue orchestration and websocket lifecycle (`SyncLifecycleMachine`).
- Source/account creation/import (`SourceProvisioningMachine`).

## State Model
State is tracked per `sourceCalendarId`.

```ts
type IngestionState =
  | "ready"
  | "fetching"
  | "diffing"
  | "applying"
  | "completed"
  | "auth_blocked"
  | "not_found_disabled"
  | "transient_error";
```

### Extended State (Context)
- `provider: "google" | "outlook" | "caldav" | "ical"`
- `userId: string`
- `accountId: string`
- `attempt: number`
- `eventsAdded: number`
- `eventsRemoved: number`
- `lastError?: { code: string; retriable: boolean }`
- `durationMs?: number`

## Events
- `START`
- `FETCH_OK`
- `FETCH_AUTH_ERROR`
- `FETCH_NOT_FOUND`
- `FETCH_TRANSIENT_ERROR`
- `DIFF_OK`
- `APPLY_OK`
- `APPLY_ERROR`
- `TIMEOUT`
- `RETRY_SCHEDULED`

## Transition Summary
- `ready` + `START` -> `fetching`
- `fetching` + `FETCH_OK` -> `diffing`
- `diffing` + `DIFF_OK` -> `applying`
- `applying` + `APPLY_OK` -> `completed`
- `fetching|applying` + auth error -> `auth_blocked`
- `fetching|applying` + 404/not-found -> `not_found_disabled`
- `fetching|applying|diffing` + retryable failure/timeout -> `transient_error`

## Side Effects
On transition, effect handlers can:
- refresh tokens (OAuth providers),
- fetch source events via provider adapter,
- compute and apply ingestion changes in DB,
- mark account `needsReauthentication`,
- disable missing calendars,
- emit structured ingest events and metrics.

## Provider Adapter Contract
Each provider adapter should expose:
- `prepare(context)` (optional token/credentials setup),
- `fetchEvents()`,
- `classifyError(error)` -> canonical code,
- optional provider metadata enrichment.

Machine logic only consumes canonical result/error types, never raw provider-specific branching.

## Outputs to Other Machines
- `SOURCE_CHANGED` (if `eventsAdded > 0 || eventsRemoved > 0`)
- `SOURCE_UNCHANGED`
- `SOURCE_AUTH_BLOCKED`
- `SOURCE_DISABLED_NOT_FOUND`

These outputs are consumed by `SyncLifecycleMachine`.

## Reliability Requirements
- Per-source execution idempotency.
- Safe retry for transient states.
- Deterministic error classification.
- Uniform logging fields across providers.

## Migration Plan
1. Extract shared ingest reducer and effect handlers.
2. Wrap current OAuth/CalDAV/ICS paths with provider adapters.
3. Emit canonical outputs to `SyncLifecycleMachine`.
4. Delete duplicated provider-branch control flow.

