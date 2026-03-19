# SourceProvisioningMachine

## Goal
Provide one machine for source/account onboarding and import lifecycle.

## Current Implementation
- Class: `SourceProvisioningStateMachine`
- Dispatch model: envelope-based `dispatch(envelope)`
- Transition policy: configurable (`IGNORE` or `REJECT`)
- Domain rejection reason is explicit in context

## States
- `validating`
- `quota_check`
- `dedupe_check`
- `account_resolve`
- `source_create`
- `bootstrap_sync`
- `done`
- `rejected`

## Context
- `userId: string`
- `provider: "ics" | "google" | "outlook" | "caldav"`
- `mode: "create_single" | "import_bulk"`
- `requestId: string`
- `createdAccountId?: string`
- `createdSourceIds: string[]`
- `rejectionReason?: "limit" | "duplicate" | "invalid_source" | "ownership" | "provider_mismatch"`

## Events
- `VALIDATION_PASSED`
- `VALIDATION_FAILED`
- `QUOTA_ALLOWED`
- `QUOTA_DENIED`
- `DEDUPLICATION_PASSED`
- `DUPLICATE_DETECTED`
- `ACCOUNT_REUSED`
- `ACCOUNT_CREATED`
- `SOURCE_CREATED`
- `BOOTSTRAP_SYNC_TRIGGERED`

## Outputs
- `SOURCE_PROVISIONED`
- `BOOTSTRAP_REQUESTED`

## Ownership Boundary
**Machine owns**
- onboarding transition semantics,
- domain rejection classification,
- output facts for downstream orchestration.

**Consumers own**
- lock acquisition,
- account/source persistence,
- bootstrap job scheduling and downstream sync dispatch.

## Migration Direction
1. Route all source create/import flows through this machine.
2. Convert existing checks to event producers.
3. Remove duplicated lock/quota/dedupe decision branches from service utilities.
