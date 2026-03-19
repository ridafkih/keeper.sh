# AFR 0001: Machine-First Backend Architecture

- **Status:** Accepted
- **Date:** 2026-03-19

## Context
The backend currently contains sprawled orchestration logic across routes, jobs, and service utilities, with repeated checks and duplicated control flow.

We are beginning a major backend rearchitecture focused on:
- consolidation of orchestration logic,
- explicit and testable transition semantics,
- stronger reliability and maintainability.

## Decision
We adopt a machine-first architecture based on class-driven EFSMs (extended finite state machines), implemented in `@keeper.sh/state-machines`.

### Core decisions
1. **Class-first machine API**
   - Instantiate machines directly (`new ...StateMachine(...)`).
   - Avoid pass-through factory wrappers.

2. **Strict event envelopes**
   - All machine input flows through `dispatch(envelope)`.
   - Envelope includes:
     - `id`
     - `event`
     - `actor`
     - `occurredAt`
     - optional `causationId`
     - optional `correlationId`

3. **Transition policy**
   - `TransitionPolicy.IGNORE`: disallowed transitions are no-op.
   - `TransitionPolicy.REJECT`: disallowed transitions throw.

4. **Invariant enforcement**
   - Machines declare invariants.
   - Invariants are asserted after every accepted transition.

5. **Application service owns orchestration effects**
   - Machines emit commands/outputs only.
   - Consumers (application services) own queue/broadcast/job coordination.
   - `SyncLifecycleApplicationService` is the canonical pattern.

6. **Error policy as first-class model**
   - Canonical enum (`retryable`, `terminal`, `requires_reauth`) used in machine context.

7. **Subscribable machine runtime**
   - Transition notifications support observability hooks and wide logging integration.

## Initial Machine Set
- `SyncLifecycleStateMachine`
- `IngestionStateMachine`
- `SourceProvisioningStateMachine`

## Consequences
### Positive
- Transition semantics become explicit, centralized, and testable.
- Duplicated orchestration checks can be systematically removed.
- Envelope metadata enables robust causal tracing and logging context enrichment.
- Strict mode (`REJECT`) allows safer refactors and earlier failure detection.

### Tradeoffs
- Requires event-producer adaptation across existing code paths.
- Introduces discipline around machine boundaries and side-effect ownership.
- Temporary dual-path complexity during migration.

## Migration Guidance
1. Route route/cron/worker lifecycle signals into machine events (envelopes).
2. Move side effects behind application services that consume machine commands.
3. Remove duplicated branch/check logic once a flow is machine-owned.
4. Use `REJECT` policy selectively in high-confidence areas to harden behavior.

## Related Docs
- `/Users/ridafkih/keeper.sh/docs/StateMachineCore.md`
- `/Users/ridafkih/keeper.sh/docs/SyncLifecycleMachine.md`
- `/Users/ridafkih/keeper.sh/docs/IngestionMachine.md`
- `/Users/ridafkih/keeper.sh/docs/SourceProvisioningMachine.md`
