# AFR 0002: Isolated State-Machine Implementation Plan

- **Status:** Proposed
- **Date:** 2026-03-19
- **Owners:** Backend Platform

## Purpose
Define a reviewable plan for implementing machine-first backend orchestration in full isolation first, with strict TDD, then cutting over in deliberate slices.

## Scope
This AFR covers:
- isolated build-out of machine-facing application services,
- interface contracts between existing services and the machine package,
- migration sequencing and acceptance criteria.

This AFR does **not** define final endpoint-by-endpoint migration details.

## Principles
1. **Isolation first**
   - Build new orchestration paths in dedicated modules without mutating legacy flow internals first.
   - Prioritize clean interfaces over compatibility shims.

2. **Machine purity**
   - Machines hold transition semantics and invariant checks.
   - Machines emit commands/outputs; machines do not perform side effects directly.

3. **Service-owned orchestration**
   - Application services execute side effects (enqueue, cancel, broadcast, persistence updates).
   - Services stay idempotent and deterministic with respect to machine results.

4. **TDD required**
   - Failing test first for each behavior and failure path.
   - Implement minimal code to pass, then refactor.

5. **Clean-code boundaries**
   - Small, named methods for transition branches and orchestration decisions.
   - No pass-through wrappers that add no behavior.
   - Use enums for canonical policies and machine-level semantics.

## Target Architecture
1. **Machine package (`@keeper.sh/state-machines`)**
   - Core runtime (`dispatch`, policy, invariants, subscription hooks).
   - Domain machines (`SyncLifecycle`, `Ingestion`, `SourceProvisioning`).

2. **Machine application layer (isolated)**
   - New service adapters that:
     - accept strict envelopes/events,
     - dispatch to machines,
     - execute machine commands via injected ports.

3. **Ports / interfaces**
   - Queue orchestration port (idempotent enqueue, supersede, cancellation).
   - Broadcast/notification port.
   - Persistence/state projection port.

4. **Mapping layer**
   - Explicit mapping helpers from existing domain signals to machine events.
   - Explicit mapping from machine outputs to follow-up events/commands.

## Delivery Slices
### Slice A: Sync lifecycle vertical
- Implement isolated sync lifecycle application service + adapters.
- Cover supersede/cancel/idempotent enqueue behavior with tests.
- Add stuck-state prevention tests (no terminal dead-end without exit event).

### Slice B: Ingestion vertical
- Route ingestion outcomes through `IngestionStateMachine`.
- Canonicalize failure policy handling (`ErrorPolicy` enum only).
- Verify output-to-sync mapping behavior under retry/terminal/reauth paths.

### Slice C: Source provisioning vertical
- Route provisioning decision flow through `SourceProvisioningStateMachine`.
- Emit bootstrap/sync requests only from machine outputs.
- Remove duplicated validation/quota/dedupe branching from orchestration code.

## Test Strategy (Required)
1. **Machine unit tests**
   - happy path transitions,
   - invalid transitions under `IGNORE` and `REJECT`,
   - invariant violations,
   - stale/cross-job event rejection.

2. **Application service tests**
   - command execution correctness,
   - idempotency guarantees,
   - no duplicate side effects on re-dispatch.

3. **Gap-closure tests**
   - regression tests for currently duplicated checks,
   - stuck-state prevention scenarios,
   - cancellation/supersede race ordering.

## Definition of Done
- New isolated path exists for each slice with passing tests.
- Legacy branch logic is removable for completed slice.
- No known stuck states in covered scenarios.
- Lint/tests pass for `packages/state-machines` and new isolated adapters.
- Review sign-off from backend maintainers.

## Risks and Mitigations
- **Risk:** Hidden coupling in legacy orchestration.
  - **Mitigation:** Add seam-level tests before cutover and use explicit port interfaces.

- **Risk:** Event shape drift across producers.
  - **Mitigation:** Enforce strict envelope + typed event mapping helpers.

- **Risk:** Partial migration complexity.
  - **Mitigation:** Migrate by vertical slice; remove old logic immediately after each slice is stable.

## Review Checklist
- Are ports sufficient for queue/broadcast/persistence responsibilities?
- Are machine outputs expressive enough to avoid service-level branching sprawl?
- Does each slice include concrete stuck-state prevention cases?
- Are error policies fully canonicalized to enums?
- Is there any remaining wrapper/adapter code with no behavior?

## Related Docs
- `/Users/ridafkih/keeper.sh/docs/afr/0001-machine-first-backend-architecture.md`
- `/Users/ridafkih/keeper.sh/docs/StateMachineCore.md`
- `/Users/ridafkih/keeper.sh/docs/SyncLifecycleMachine.md`
- `/Users/ridafkih/keeper.sh/docs/IngestionMachine.md`
- `/Users/ridafkih/keeper.sh/docs/SourceProvisioningMachine.md`
