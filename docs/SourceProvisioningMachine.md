# SourceProvisioningMachine

## Goal
Standardize source/account onboarding and import flows across ICS, OAuth, and CalDAV.

This machine consolidates repeated logic for validation, quota checks, dedupe checks, account resolution, source creation, and bootstrap sync handoff.

## Scope
**In scope**
- Create source (single) and import sources (bulk) orchestration.
- Account reuse vs account creation decisions.
- Quota enforcement and duplicate prevention.
- Bootstrap trigger (`ingest/sync`) after successful provisioning.

**Out of scope**
- Long-running ingestion internals (`IngestionMachine`).
- User sync scheduling/status (`SyncLifecycleMachine`).

## State Model
State is tracked per provisioning request (`requestId`).

```ts
type SourceProvisioningState =
  | "validating"
  | "quota_check"
  | "dedupe_check"
  | "account_resolve"
  | "source_create"
  | "bootstrap_sync"
  | "done"
  | "rejected";
```

### Extended State (Context)
- `userId: string`
- `provider: "ics" | "google" | "outlook" | "caldav"`
- `mode: "create_single" | "import_bulk"`
- `candidateCount: number`
- `createdAccountId?: string`
- `createdSourceIds: string[]`
- `rejectionReason?: "limit" | "duplicate" | "invalid_source" | "ownership" | "provider_mismatch"`

## Events
- `REQUEST_RECEIVED`
- `VALIDATION_PASSED`
- `VALIDATION_FAILED`
- `QUOTA_ALLOWED`
- `QUOTA_DENIED`
- `DEDUPLICATION_PASSED`
- `DUPLICATE_DETECTED`
- `ACCOUNT_REUSED`
- `ACCOUNT_CREATED`
- `SOURCE_CREATED`
- `SOURCES_IMPORTED`
- `BOOTSTRAP_SYNC_TRIGGERED`
- `FAILED`

## Transition Summary
- `validating` + pass -> `quota_check`
- `quota_check` + allowed -> `dedupe_check`
- `dedupe_check` + pass -> `account_resolve`
- `account_resolve` -> `source_create`
- `source_create` + success -> `bootstrap_sync`
- `bootstrap_sync` + trigger success -> `done`
- Any failed/denied validation path -> `rejected`

## Side Effects
On transitions, effect handlers can:
- acquire user advisory lock,
- validate source URL/credentials/provider ownership,
- read account counts and enforce plan limits,
- query for duplicates and existing account reuse,
- create account/credentials/source rows,
- schedule bootstrap ingestion/sync work.

## Handoff Contracts
After provisioning success:
- emit `SOURCE_PROVISIONED` (single or bulk metadata),
- emit `BOOTSTRAP_REQUESTED`,
- dispatch to `IngestionMachine` (if ingest first) and/or directly signal `SyncLifecycleMachine` intent.

## Error Policy
- Domain errors are typed and stable (`LimitExceeded`, `DuplicateSource`, etc.).
- Machine-level rejection reason maps 1:1 to API response class.
- Retry only for infra/transient failures; domain rejections are terminal.

## Concurrency & Idempotency
- User-scoped advisory lock guards account/source races.
- Request-level idempotency key prevents duplicate source creation on retries.
- Bulk import should be chunked and checkpointed for partial success safety.

## Migration Plan
1. Introduce provisioning reducer and typed domain errors.
2. Move ICS/OAuth/CalDAV create/import flows behind machine entrypoints.
3. Standardize bootstrap sync trigger contract.
4. Remove duplicated lock/quota/dedupe logic in provider-specific utilities.

