import { StateMachine } from "./core/state-machine";
import type { MachineSnapshot, MachineTransitionResult } from "./core/state-machine";
import type { EventEnvelope } from "./core/event-envelope";
import type { TransitionPolicy } from "./core/transition-policy";

type SyncTokenStrategyState =
  | "token_missing"
  | "token_valid"
  | "delta_sync"
  | "full_sync_required"
  | "token_reset_required"
  | "token_persist_pending";

interface SyncTokenStrategyContext {
  syncToken?: string;
  requiredWindowVersion: number;
  loadedWindowVersion?: number;
}

type SyncTokenStrategyEvent =
  | { type: "TOKEN_LOADED"; token: string | null; loadedWindowVersion?: number }
  | { type: "DELTA_SYNC_REQUESTED" }
  | { type: "FULL_SYNC_REQUIRED" }
  | { type: "TOKEN_INVALIDATED" }
  | { type: "NEXT_TOKEN_RECEIVED"; token: string };

type SyncTokenStrategyCommand =
  | { type: "CLEAR_SYNC_TOKEN" }
  | { type: "REQUEST_FULL_SYNC" }
  | { type: "PERSIST_SYNC_TOKEN"; token: string };

type SyncTokenStrategyOutput =
  | { type: "TOKEN_READY_FOR_DELTA_SYNC" }
  | { type: "TOKEN_RESET_FOR_FULL_SYNC" };

type SyncTokenStrategySnapshot = MachineSnapshot<SyncTokenStrategyState, SyncTokenStrategyContext>;
type SyncTokenStrategyTransitionResult = MachineTransitionResult<
  SyncTokenStrategyState,
  SyncTokenStrategyContext,
  SyncTokenStrategyCommand,
  SyncTokenStrategyOutput
>;

interface SyncTokenStrategyMachine {
  getSnapshot: () => SyncTokenStrategySnapshot;
  dispatch: (envelope: EventEnvelope<SyncTokenStrategyEvent>) => SyncTokenStrategyTransitionResult;
}

class SyncTokenStrategyStateMachine
  extends StateMachine<
    SyncTokenStrategyState,
    SyncTokenStrategyContext,
    SyncTokenStrategyEvent,
    SyncTokenStrategyCommand,
    SyncTokenStrategyOutput
  >
  implements SyncTokenStrategyMachine
{
  private readonly invariants: ((snapshot: SyncTokenStrategySnapshot) => void)[] = [
    ({ state, context }) => {
      if ((state === "token_valid" || state === "delta_sync" || state === "token_persist_pending") && !context.syncToken) {
        throw new Error("Invariant violated: token states require syncToken");
      }
    },
  ];

  constructor(input: { requiredWindowVersion: number }, options: { transitionPolicy: TransitionPolicy }) {
    super(
      "token_missing",
      {
        requiredWindowVersion: input.requiredWindowVersion,
      },
      { transitionPolicy: options.transitionPolicy },
    );
  }

  protected isTransitionAllowed(event: SyncTokenStrategyEvent): boolean {
    if (event.type === "TOKEN_LOADED") {
      return this.state === "token_missing";
    }
    if (event.type === "DELTA_SYNC_REQUESTED") {
      return this.state === "token_valid";
    }
    if (event.type === "FULL_SYNC_REQUIRED") {
      return this.state === "token_valid" || this.state === "delta_sync";
    }
    if (event.type === "TOKEN_INVALIDATED") {
      return this.state !== "token_missing";
    }
    if (event.type === "NEXT_TOKEN_RECEIVED") {
      return this.state === "delta_sync" || this.state === "full_sync_required" || this.state === "token_reset_required";
    }
    return false;
  }

  protected getInvariants(): ((snapshot: SyncTokenStrategySnapshot) => void)[] {
    return this.invariants;
  }

  protected transition(event: SyncTokenStrategyEvent): SyncTokenStrategyTransitionResult {
    switch (event.type) {
      case "TOKEN_LOADED": {
        const loadedContext = {
          ...this.context,
          loadedWindowVersion: event.loadedWindowVersion,
        };

        if (event.token) {
          this.context = { ...loadedContext, syncToken: event.token };
        } else {
          const nextContext = { ...loadedContext };
          delete nextContext.syncToken;
          this.context = nextContext;
        }

        if (!event.token) {
          this.state = "token_missing";
          return this.result();
        }

        if (
          typeof event.loadedWindowVersion === "number"
          && event.loadedWindowVersion < this.context.requiredWindowVersion
        ) {
          this.state = "token_reset_required";
          const nextContext = { ...this.context };
          delete nextContext.syncToken;
          this.context = nextContext;
          return this.result(
            [{ type: "CLEAR_SYNC_TOKEN" }, { type: "REQUEST_FULL_SYNC" }],
            [{ type: "TOKEN_RESET_FOR_FULL_SYNC" }],
          );
        }

        this.state = "token_valid";
        return this.result([], [{ type: "TOKEN_READY_FOR_DELTA_SYNC" }]);
      }
      case "DELTA_SYNC_REQUESTED": {
        this.state = "delta_sync";
        return this.result();
      }
      case "FULL_SYNC_REQUIRED": {
        this.state = "full_sync_required";
        return this.result([{ type: "REQUEST_FULL_SYNC" }]);
      }
      case "TOKEN_INVALIDATED": {
        this.state = "token_reset_required";
        const nextContext = { ...this.context };
        delete nextContext.syncToken;
        this.context = nextContext;
        return this.result([{ type: "CLEAR_SYNC_TOKEN" }], [{ type: "TOKEN_RESET_FOR_FULL_SYNC" }]);
      }
      case "NEXT_TOKEN_RECEIVED": {
        this.state = "token_persist_pending";
        this.context = { ...this.context, syncToken: event.token };
        return this.result([{ token: event.token, type: "PERSIST_SYNC_TOKEN" }]);
      }
      default: {
        return this.result();
      }
    }
  }
}

export { SyncTokenStrategyStateMachine };
export type {
  SyncTokenStrategyCommand,
  SyncTokenStrategyContext,
  SyncTokenStrategyEvent,
  SyncTokenStrategyMachine,
  SyncTokenStrategyOutput,
  SyncTokenStrategySnapshot,
  SyncTokenStrategyState,
  SyncTokenStrategyTransitionResult,
};
