# State Machine Core

## Goal
Define formal machine semantics shared by all backend machines.

## Core Components
- `StateMachine` base class
- `EventEnvelope` + actor/causation/correlation metadata
- `TransitionPolicy` (`IGNORE` / `REJECT`)
- Transition subscribers for observability hooks

## Dispatch Contract
All machines process events via:
- `dispatch(envelope)` where envelope includes:
  - `id`
  - `event`
  - `actor`
  - `occurredAt`
  - optional `causationId`
  - optional `correlationId`
- Envelope metadata is explicit and caller-provided (`id`, `occurredAt`); no runtime defaults.

## Policy Contract
- `IGNORE`: disallowed transition returns no-op result.
- `REJECT`: disallowed transition throws.

## Invariant Contract
- Machines can define invariant functions.
- Invariants run after each accepted transition.
- Violations throw immediately.

## Observability Contract
- Machines are subscribable via `subscribe(listener)`.
- Listener receives:
  - envelope
  - from-state
  - to-state
  - transition result

This is designed for wide logging and future durable transition streams.

## API Style
- Class-first instantiation (`new ...StateMachine(...)`).
- No factory wrappers that only instantiate/pass-through.
