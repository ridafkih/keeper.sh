import { StateMachine } from "./core/state-machine";
import type { MachineSnapshot, MachineTransitionResult } from "./core/state-machine";
import type { EventEnvelope } from "./core/event-envelope";
import type { TransitionPolicy } from "./core/transition-policy";

const PushJobArbitrationEventType = {
  JOB_ACTIVATED: "JOB_ACTIVATED",
  JOB_CANCELLED: "JOB_CANCELLED",
  JOB_COMPLETED: "JOB_COMPLETED",
  JOB_FAILED: "JOB_FAILED",
} as const;

const PushJobArbitrationCommandType = {
  CANCEL_JOB: "CANCEL_JOB",
  HOLD_SYNCING: "HOLD_SYNCING",
  RELEASE_SYNCING: "RELEASE_SYNCING",
} as const;

type PushJobArbitrationState = "idle" | "active";

interface PushJobArbitrationContext {
  activeJobId?: string;
}

type PushJobArbitrationEvent =
  | { type: typeof PushJobArbitrationEventType.JOB_ACTIVATED; jobId: string }
  | { type: typeof PushJobArbitrationEventType.JOB_COMPLETED; jobId: string }
  | { type: typeof PushJobArbitrationEventType.JOB_FAILED; jobId: string }
  | { type: typeof PushJobArbitrationEventType.JOB_CANCELLED; jobId: string };

type PushJobArbitrationCommand =
  | { type: typeof PushJobArbitrationCommandType.HOLD_SYNCING }
  | { type: typeof PushJobArbitrationCommandType.RELEASE_SYNCING }
  | { type: typeof PushJobArbitrationCommandType.CANCEL_JOB; jobId: string };

type PushJobArbitrationOutput = never;

type PushJobArbitrationSnapshot = MachineSnapshot<
  PushJobArbitrationState,
  PushJobArbitrationContext
>;
type PushJobArbitrationTransitionResult = MachineTransitionResult<
  PushJobArbitrationState,
  PushJobArbitrationContext,
  PushJobArbitrationCommand,
  PushJobArbitrationOutput
>;

interface PushJobArbitrationMachine {
  getSnapshot: () => PushJobArbitrationSnapshot;
  dispatch: (
    envelope: EventEnvelope<PushJobArbitrationEvent>,
  ) => PushJobArbitrationTransitionResult;
}

class PushJobArbitrationStateMachine
  extends StateMachine<
    PushJobArbitrationState,
    PushJobArbitrationContext,
    PushJobArbitrationEvent,
    PushJobArbitrationCommand,
    PushJobArbitrationOutput
  >
  implements PushJobArbitrationMachine
{
  private readonly invariants: ((snapshot: PushJobArbitrationSnapshot) => void)[] = [
    ({ state, context }) => {
      if (state === "active" && !context.activeJobId) {
        throw new Error("Invariant violated: active state requires activeJobId");
      }
    },
    ({ state, context }) => {
      if (state === "idle" && context.activeJobId) {
        throw new Error("Invariant violated: idle state cannot retain activeJobId");
      }
    },
  ];

  constructor(options: { transitionPolicy: TransitionPolicy }) {
    super("idle", {}, { transitionPolicy: options.transitionPolicy });
  }

  protected isTransitionAllowed(event: PushJobArbitrationEvent): boolean {
    switch (event.type) {
      case PushJobArbitrationEventType.JOB_ACTIVATED: {
        return true;
      }
      default: {
        return this.state === "active" && this.context.activeJobId === event.jobId;
      }
    }
  }

  protected getInvariants(): ((snapshot: PushJobArbitrationSnapshot) => void)[] {
    return this.invariants;
  }

  private activate(jobId: string): PushJobArbitrationTransitionResult {
    if (this.state === "idle") {
      this.state = "active";
      this.context = { activeJobId: jobId };
      return this.result([{ type: PushJobArbitrationCommandType.HOLD_SYNCING }]);
    }

    if (this.context.activeJobId === jobId) {
      return this.result();
    }

    const previousJobId = this.context.activeJobId;
    if (!previousJobId) {
      throw new Error("Invariant violated: active transition requires previous active job");
    }
    this.context = { activeJobId: jobId };
    this.state = "active";
    return this.result([
      { jobId: previousJobId, type: PushJobArbitrationCommandType.CANCEL_JOB },
      { type: PushJobArbitrationCommandType.HOLD_SYNCING },
    ]);
  }

  private settle(): PushJobArbitrationTransitionResult {
    this.state = "idle";
    this.context = {};
    return this.result([{ type: PushJobArbitrationCommandType.RELEASE_SYNCING }]);
  }

  protected transition(event: PushJobArbitrationEvent): PushJobArbitrationTransitionResult {
    switch (event.type) {
      case PushJobArbitrationEventType.JOB_ACTIVATED: {
        return this.activate(event.jobId);
      }
      case PushJobArbitrationEventType.JOB_COMPLETED:
      case PushJobArbitrationEventType.JOB_FAILED:
      case PushJobArbitrationEventType.JOB_CANCELLED: {
        return this.settle();
      }
      default: {
        return this.result();
      }
    }
  }
}

export {
  PushJobArbitrationCommandType,
  PushJobArbitrationEventType,
  PushJobArbitrationStateMachine,
};
export type {
  PushJobArbitrationCommand,
  PushJobArbitrationContext,
  PushJobArbitrationEvent,
  PushJobArbitrationMachine,
  PushJobArbitrationOutput,
  PushJobArbitrationSnapshot,
  PushJobArbitrationState,
  PushJobArbitrationTransitionResult,
};
