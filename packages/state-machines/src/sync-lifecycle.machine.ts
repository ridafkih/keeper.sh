import { StateMachine } from "./core/state-machine";
import type { MachineSnapshot, MachineTransitionResult } from "./core/state-machine";
import type { EventEnvelope } from "./core/event-envelope";
import { TransitionPolicy } from "./core/transition-policy";
import { ErrorPolicy } from "./errors/error-policy";

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
): SyncLifecycleContext => {
  const pendingReasons = new Set(context.pendingReasons);
  pendingReasons.add(reason);
  return { ...context, pendingReasons };
};

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
  constructor(options?: { transitionPolicy?: TransitionPolicy }) {
    super(
      "idle",
      { pendingReasons: new Set() },
      { transitionPolicy: options?.transitionPolicy },
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

  protected getInvariants(): Array<(snapshot: SyncLifecycleSnapshot) => void> {
    return [
      ({ state, context }) => {
        if (state === "running" && !context.activeJobId) {
          throw new Error("Invariant violated: running state requires activeJobId");
        }
      },
    ];
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
    this.context = {
      ...this.context,
      activeJobId: undefined,
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
    this.context = {
      ...this.context,
      activeJobId: undefined,
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
