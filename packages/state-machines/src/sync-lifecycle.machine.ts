import { StateMachine } from "./core/state-machine";
import type { MachineSnapshot, MachineTransitionResult } from "./core/state-machine";
import type { EventEnvelope } from "./core/event-envelope";
import type { TransitionPolicy } from "./core/transition-policy";
import type { ErrorPolicy } from "./errors/error-policy";

type PendingReason =
  | "ingest_changed"
  | "mappings_changed"
  | "settings_dirty"
  | "manual";

type SyncLifecycleState = "idle" | "pending" | "running" | "degraded";

interface SyncLifecycleContext {
  pendingReasons: Set<PendingReason>;
  activeJobId?: string;
  lastError?: { code: string; at: string; policy: ErrorPolicy };
}

type SyncLifecycleEvent =
  | { type: "INGEST_CHANGED" }
  | { type: "MAPPINGS_CHANGED" }
  | { type: "SETTINGS_DIRTY" }
  | { type: "SETTINGS_CLEAN" }
  | { type: "MANUAL_SYNC_REQUESTED" }
  | { type: "JOB_STARTED"; jobId: string }
  | { type: "JOB_COMPLETED"; jobId: string }
  | { type: "JOB_FAILED"; jobId: string; code: string; policy: ErrorPolicy };

type SyncLifecycleCommand =
  | { type: "REQUEST_PUSH_SYNC_ENQUEUE" }
  | { type: "BROADCAST_AGGREGATE" };

type SyncLifecycleOutput = never;

type SyncLifecycleSnapshot = MachineSnapshot<SyncLifecycleState, SyncLifecycleContext>;
type SyncLifecycleTransitionResult = MachineTransitionResult<
  SyncLifecycleState,
  SyncLifecycleContext,
  SyncLifecycleCommand,
  SyncLifecycleOutput
>;

interface SyncLifecycleMachine {
  getSnapshot: () => SyncLifecycleSnapshot;
  dispatch: (envelope: EventEnvelope<SyncLifecycleEvent>) => SyncLifecycleTransitionResult;
}

const addReason = (
  context: SyncLifecycleContext,
  reason: PendingReason,
): SyncLifecycleContext => ({ ...context, pendingReasons: new Set([...context.pendingReasons, reason]) });

const clearSettingsReason = (context: SyncLifecycleContext): SyncLifecycleContext => {
  const pendingReasons = new Set(context.pendingReasons);
  pendingReasons.delete("settings_dirty");
  return { ...context, pendingReasons };
};

class SyncLifecycleStateMachine
  extends StateMachine<
    SyncLifecycleState,
    SyncLifecycleContext,
    SyncLifecycleEvent,
    SyncLifecycleCommand,
    SyncLifecycleOutput
  >
  implements SyncLifecycleMachine
{
  private readonly invariants: ((snapshot: SyncLifecycleSnapshot) => void)[] = [
    ({ state, context }) => {
      if (state === "running" && !context.activeJobId) {
        throw new Error("Invariant violated: running state requires activeJobId");
      }
    },
    ({ state, context }) => {
      if (state === "degraded" && !context.lastError) {
        throw new Error("Invariant violated: degraded state requires lastError");
      }
    },
    ({ state, context }) => {
      if (state === "pending" && context.pendingReasons.size === 0) {
        throw new Error("Invariant violated: pending state requires pending reasons");
      }
    },
  ];

  constructor(options: { transitionPolicy: TransitionPolicy }) {
    super(
      "idle",
      { pendingReasons: new Set() },
      { transitionPolicy: options.transitionPolicy },
    );
  }

  protected isTransitionAllowed(event: SyncLifecycleEvent): boolean {
    if (event.type === "JOB_STARTED") {
      return this.state === "idle" || this.state === "pending" || this.state === "degraded";
    }
    if (event.type === "JOB_COMPLETED" || event.type === "JOB_FAILED") {
      return this.state === "running" && this.context.activeJobId === event.jobId;
    }
    return true;
  }

  protected getInvariants(): ((snapshot: SyncLifecycleSnapshot) => void)[] {
    return this.invariants;
  }

  private transitionToPending(
    reason: PendingReason,
    commands: SyncLifecycleCommand[],
  ): SyncLifecycleTransitionResult {
    this.context = addReason(this.context, reason);
    if (this.state !== "running") {
      this.state = "pending";
    }
    commands.push({ type: "REQUEST_PUSH_SYNC_ENQUEUE" });
    return this.result(commands);
  }

  private transitionToIdle(commands: SyncLifecycleCommand[]): SyncLifecycleTransitionResult {
    const rest = { ...this.context };
    delete rest.activeJobId;
    this.context = {
      ...rest,
      pendingReasons: new Set(),
    };
    this.state = "idle";
    commands.push({ type: "BROADCAST_AGGREGATE" });
    return this.result(commands);
  }

  private transitionToDegraded(
    code: string,
    policy: ErrorPolicy,
    commands: SyncLifecycleCommand[],
  ): SyncLifecycleTransitionResult {
    const rest = { ...this.context };
    delete rest.activeJobId;
    this.context = {
      ...rest,
      lastError: {
        code,
        at: new Date().toISOString(),
        policy,
      },
    };
    this.state = "degraded";
    commands.push({ type: "BROADCAST_AGGREGATE" });
    return this.result(commands);
  }

  protected transition(event: SyncLifecycleEvent): SyncLifecycleTransitionResult {
    const commands: SyncLifecycleCommand[] = [];

    switch (event.type) {
      case "INGEST_CHANGED": {
        return this.transitionToPending("ingest_changed", commands);
      }

      case "MAPPINGS_CHANGED": {
        return this.transitionToPending("mappings_changed", commands);
      }

      case "SETTINGS_DIRTY": {
        return this.transitionToPending("settings_dirty", commands);
      }

      case "SETTINGS_CLEAN": {
        this.context = clearSettingsReason(this.context);
        if (this.state === "pending" && this.context.pendingReasons.size === 0) {
          this.state = "idle";
        }
        return this.result(commands);
      }

      case "MANUAL_SYNC_REQUESTED": {
        return this.transitionToPending("manual", commands);
      }

      case "JOB_STARTED": {
        this.context = { ...this.context, activeJobId: event.jobId };
        this.state = "running";
        return this.result(commands);
      }

      case "JOB_COMPLETED": {
        return this.transitionToIdle(commands);
      }

      case "JOB_FAILED": {
        return this.transitionToDegraded(event.code, event.policy, commands);
      }
      default: {
        return this.result(commands);
      }
    }
  }
}
export { SyncLifecycleStateMachine };
export type {
  PendingReason,
  SyncLifecycleCommand,
  SyncLifecycleContext,
  SyncLifecycleEvent,
  SyncLifecycleMachine,
  SyncLifecycleOutput,
  SyncLifecycleSnapshot,
  SyncLifecycleState,
  SyncLifecycleTransitionResult,
};
