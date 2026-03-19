import { StateMachine } from "./core/state-machine";
import type { MachineSnapshot, MachineTransitionResult } from "./core/state-machine";
import type { EventEnvelope } from "./core/event-envelope";
import type { TransitionPolicy } from "./core/transition-policy";

type PushJobArbitrationState = "idle" | "active";

interface PushJobArbitrationContext {
  activeJobId?: string;
}

type PushJobArbitrationEvent =
  | { type: "JOB_ACTIVATED"; jobId: string }
  | { type: "JOB_COMPLETED"; jobId: string }
  | { type: "JOB_FAILED"; jobId: string }
  | { type: "JOB_CANCELLED"; jobId: string };

type PushJobArbitrationCommand =
  | { type: "HOLD_SYNCING" }
  | { type: "RELEASE_SYNCING" }
  | { type: "CANCEL_JOB"; jobId: string };

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
    if (event.type === "JOB_ACTIVATED") {
      return true;
    }
    return this.state === "active" && this.context.activeJobId === event.jobId;
  }

  protected getInvariants(): ((snapshot: PushJobArbitrationSnapshot) => void)[] {
    return this.invariants;
  }

  private activate(jobId: string): PushJobArbitrationTransitionResult {
    if (this.state === "idle") {
      this.state = "active";
      this.context = { activeJobId: jobId };
      return this.result([{ type: "HOLD_SYNCING" }]);
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
      { jobId: previousJobId, type: "CANCEL_JOB" },
      { type: "HOLD_SYNCING" },
    ]);
  }

  private settle(): PushJobArbitrationTransitionResult {
    this.state = "idle";
    this.context = {};
    return this.result([{ type: "RELEASE_SYNCING" }]);
  }

  protected transition(event: PushJobArbitrationEvent): PushJobArbitrationTransitionResult {
    switch (event.type) {
      case "JOB_ACTIVATED": {
        return this.activate(event.jobId);
      }
      case "JOB_COMPLETED":
      case "JOB_FAILED":
      case "JOB_CANCELLED": {
        return this.settle();
      }
      default: {
        return this.result();
      }
    }
  }
}

export { PushJobArbitrationStateMachine };
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
