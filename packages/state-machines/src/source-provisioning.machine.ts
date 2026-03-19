import { StateMachine } from "./core/state-machine";
import type { MachineSnapshot, MachineTransitionResult } from "./core/state-machine";
import type { EventEnvelope } from "./core/event-envelope";
import { TransitionPolicy } from "./core/transition-policy";

type SourceProvisioningProvider = "ics" | "google" | "outlook" | "caldav";
type SourceProvisioningMode = "create_single" | "import_bulk";

type SourceProvisioningState =
  | "validating"
  | "quota_check"
  | "dedupe_check"
  | "account_resolve"
  | "source_create"
  | "bootstrap_sync"
  | "done"
  | "rejected";

type SourceProvisioningRejectionReason =
  | "limit"
  | "duplicate"
  | "invalid_source"
  | "ownership"
  | "provider_mismatch";

interface SourceProvisioningInput {
  mode: SourceProvisioningMode;
  provider: SourceProvisioningProvider;
  requestId: string;
  userId: string;
}

interface SourceProvisioningContext extends SourceProvisioningInput {
  createdAccountId?: string;
  createdSourceIds: string[];
  rejectionReason?: SourceProvisioningRejectionReason;
}

type SourceProvisioningEvent =
  | { type: "VALIDATION_PASSED" }
  | { type: "VALIDATION_FAILED"; reason: Exclude<SourceProvisioningRejectionReason, "limit" | "duplicate"> }
  | { type: "QUOTA_ALLOWED" }
  | { type: "QUOTA_DENIED" }
  | { type: "DEDUPLICATION_PASSED" }
  | { type: "DUPLICATE_DETECTED" }
  | { type: "ACCOUNT_REUSED"; accountId: string }
  | { type: "ACCOUNT_CREATED"; accountId: string }
  | { type: "SOURCE_CREATED"; sourceIds: string[] }
  | { type: "BOOTSTRAP_SYNC_TRIGGERED"; mode: SourceProvisioningMode; sourceIds: string[] };

type SourceProvisioningCommand = never;
type SourceProvisioningOutput =
  | { type: "SOURCE_PROVISIONED"; mode: SourceProvisioningMode; sourceIds: string[] }
  | { type: "BOOTSTRAP_REQUESTED"; mode: SourceProvisioningMode; sourceIds: string[] };

type SourceProvisioningSnapshot = MachineSnapshot<
  SourceProvisioningState,
  SourceProvisioningContext
>;

type SourceProvisioningTransitionResult = MachineTransitionResult<
  SourceProvisioningState,
  SourceProvisioningContext,
  SourceProvisioningCommand,
  SourceProvisioningOutput
>;

interface SourceProvisioningMachine {
  getSnapshot: () => SourceProvisioningSnapshot;
  dispatch: (envelope: EventEnvelope<SourceProvisioningEvent>) => SourceProvisioningTransitionResult;
}

class SourceProvisioningStateMachine
  extends StateMachine<
    SourceProvisioningState,
    SourceProvisioningContext,
    SourceProvisioningEvent,
    SourceProvisioningCommand,
    SourceProvisioningOutput
  >
  implements SourceProvisioningMachine
{
  constructor(input: SourceProvisioningInput, options?: { transitionPolicy?: TransitionPolicy }) {
    super(
      "validating",
      {
        ...input,
        createdSourceIds: [],
      },
      { transitionPolicy: options?.transitionPolicy },
    );
  }

  protected isTransitionAllowed(event: SourceProvisioningEvent): boolean {
    if (event.type === "VALIDATION_PASSED" || event.type === "VALIDATION_FAILED") {
      return this.state === "validating";
    }
    if (event.type === "QUOTA_ALLOWED" || event.type === "QUOTA_DENIED") {
      return this.state === "quota_check";
    }
    if (event.type === "DEDUPLICATION_PASSED" || event.type === "DUPLICATE_DETECTED") {
      return this.state === "dedupe_check";
    }
    if (event.type === "ACCOUNT_REUSED" || event.type === "ACCOUNT_CREATED") {
      return this.state === "account_resolve";
    }
    if (event.type === "SOURCE_CREATED") {
      return this.state === "source_create";
    }
    if (event.type === "BOOTSTRAP_SYNC_TRIGGERED") {
      return this.state === "bootstrap_sync";
    }
    return false;
  }

  private transitionTo(state: SourceProvisioningState): SourceProvisioningTransitionResult {
    this.state = state;
    return this.result();
  }

  private reject(reason: SourceProvisioningRejectionReason): SourceProvisioningTransitionResult {
    this.state = "rejected";
    this.context = { ...this.context, rejectionReason: reason };
    return this.result();
  }

  private setAccount(accountId: string): SourceProvisioningTransitionResult {
    this.context = { ...this.context, createdAccountId: accountId };
    this.state = "source_create";
    return this.result();
  }

  private setSources(sourceIds: string[]): SourceProvisioningTransitionResult {
    this.context = { ...this.context, createdSourceIds: [...sourceIds] };
    this.state = "bootstrap_sync";
    return this.result();
  }

  private complete(
    mode: SourceProvisioningMode,
    sourceIds: string[],
  ): SourceProvisioningTransitionResult {
    this.state = "done";
    return this.result([], [
      {
        type: "SOURCE_PROVISIONED",
        mode,
        sourceIds: [...sourceIds],
      },
      {
        type: "BOOTSTRAP_REQUESTED",
        mode,
        sourceIds: [...sourceIds],
      },
    ]);
  }

  protected transition(event: SourceProvisioningEvent): SourceProvisioningTransitionResult {
    switch (event.type) {
      case "VALIDATION_PASSED": {
        if (this.state === "validating") {
          return this.transitionTo("quota_check");
        }
        return this.result();
      }

      case "VALIDATION_FAILED": {
        return this.reject(event.reason);
      }

      case "QUOTA_ALLOWED": {
        if (this.state === "quota_check") {
          return this.transitionTo("dedupe_check");
        }
        return this.result();
      }

      case "QUOTA_DENIED": {
        return this.reject("limit");
      }

      case "DEDUPLICATION_PASSED": {
        if (this.state === "dedupe_check") {
          return this.transitionTo("account_resolve");
        }
        return this.result();
      }

      case "DUPLICATE_DETECTED": {
        return this.reject("duplicate");
      }

      case "ACCOUNT_REUSED":
      case "ACCOUNT_CREATED": {
        if (this.state === "account_resolve") {
          return this.setAccount(event.accountId);
        }
        return this.result();
      }

      case "SOURCE_CREATED": {
        if (this.state === "source_create") {
          return this.setSources(event.sourceIds);
        }
        return this.result();
      }

      case "BOOTSTRAP_SYNC_TRIGGERED": {
        if (this.state === "bootstrap_sync") {
          return this.complete(event.mode, event.sourceIds);
        }
        return this.result();
      }
    }
  }
}

export { SourceProvisioningStateMachine };
export type {
  SourceProvisioningCommand,
  SourceProvisioningContext,
  SourceProvisioningEvent,
  SourceProvisioningInput,
  SourceProvisioningMachine,
  SourceProvisioningMode,
  SourceProvisioningOutput,
  SourceProvisioningProvider,
  SourceProvisioningRejectionReason,
  SourceProvisioningSnapshot,
  SourceProvisioningState,
  SourceProvisioningTransitionResult,
};
