# IngestionMachine

## Goal
Normalize source ingestion behavior across providers with one explicit machine.

## Current Implementation
- Class: `IngestionStateMachine`
- Dispatch model: envelope-based `dispatch(envelope)`
- Transition policy: configurable (`IGNORE` or `REJECT`)
- Error policy modeled as first-class enum: `ErrorPolicy`

## States
- `ready`
- `fetching`
- `diffing`
- `applying`
- `completed`
- `auth_blocked`
- `not_found_disabled`
- `transient_error`

## Context
- `provider: "google" | "outlook" | "caldav" | "ical"`
- `userId: string`
- `accountId: string`
- `sourceCalendarId: string`
- `eventsAdded: number`
- `eventsRemoved: number`
- `lastError?: { code: string; policy: ErrorPolicy }`

## Events
- `START`
- `FETCH_OK`
- `DIFF_OK`
- `APPLY_OK`
- `FETCH_AUTH_ERROR`
- `FETCH_NOT_FOUND`
- `FETCH_TRANSIENT_ERROR`
- `TIMEOUT`

## Outputs
- `SOURCE_CHANGED`
- `SOURCE_UNCHANGED`
- `SOURCE_AUTH_BLOCKED`
- `SOURCE_DISABLED_NOT_FOUND`
- `SOURCE_TRANSIENT_ERROR`

## Error Semantics
- Auth failures map to `ErrorPolicy.REQUIRES_REAUTH`.
- Not-found failures map to `ErrorPolicy.TERMINAL`.
- Transient/timeouts map to `ErrorPolicy.RETRYABLE`.

## Ownership Boundary
**Machine owns**
- transition semantics,
- canonical output generation,
- error policy classification persistence in context.

**Consumers own**
- provider adapter execution,
- retries and scheduling strategy,
- DB writes and account/calendar remediation effects.

## Migration Direction
1. Feed provider fetch/apply results as envelope events.
2. Consume machine outputs as orchestration facts.
3. Remove duplicated provider-specific state branching.
