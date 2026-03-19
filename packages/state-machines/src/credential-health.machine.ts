import { StateMachine } from "./core/state-machine";
import type { MachineSnapshot, MachineTransitionResult } from "./core/state-machine";
import type { EventEnvelope } from "./core/event-envelope";
import type { TransitionPolicy } from "./core/transition-policy";

type CredentialHealthState =
  | "token_valid"
  | "refresh_required"
  | "refreshing"
  | "reauth_required"
  | "refresh_failed_retryable";

interface CredentialHealthContext {
  oauthCredentialId: string;
  calendarAccountId: string;
  accessTokenExpiresAt: string;
  refreshAttempts: number;
  lastErrorCode?: string;
}

type CredentialHealthEvent =
  | { type: "TOKEN_EXPIRY_DETECTED" }
  | { type: "REFRESH_STARTED" }
  | { type: "REFRESH_SUCCEEDED"; newExpiresAt: string }
  | { type: "REFRESH_REAUTH_REQUIRED"; code: string }
  | { type: "REFRESH_RETRYABLE_FAILED"; code: string };

type CredentialHealthCommand =
  | { type: "REFRESH_TOKEN" }
  | { type: "MARK_ACCOUNT_REAUTH_REQUIRED" }
  | { type: "PERSIST_REFRESHED_CREDENTIALS"; expiresAt: string };

type CredentialHealthOutput =
  | { type: "CREDENTIALS_HEALTHY" }
  | { type: "CREDENTIALS_REAUTH_REQUIRED"; code: string }
  | { type: "CREDENTIALS_REFRESH_RETRYABLE_FAILURE"; code: string };

type CredentialHealthSnapshot = MachineSnapshot<CredentialHealthState, CredentialHealthContext>;
type CredentialHealthTransitionResult = MachineTransitionResult<
  CredentialHealthState,
  CredentialHealthContext,
  CredentialHealthCommand,
  CredentialHealthOutput
>;

interface CredentialHealthMachine {
  getSnapshot: () => CredentialHealthSnapshot;
  dispatch: (envelope: EventEnvelope<CredentialHealthEvent>) => CredentialHealthTransitionResult;
}

class CredentialHealthStateMachine
  extends StateMachine<
    CredentialHealthState,
    CredentialHealthContext,
    CredentialHealthEvent,
    CredentialHealthCommand,
    CredentialHealthOutput
  >
  implements CredentialHealthMachine
{
  private readonly invariants: ((snapshot: CredentialHealthSnapshot) => void)[] = [
    ({ state, context }) => {
      if (state === "reauth_required" && !context.lastErrorCode) {
        throw new Error("Invariant violated: reauth_required needs lastErrorCode");
      }
    },
    ({ state, context }) => {
      if (state === "refreshing" && context.refreshAttempts < 1) {
        throw new Error("Invariant violated: refreshing requires refreshAttempts >= 1");
      }
    },
  ];

  constructor(
    input: { oauthCredentialId: string; calendarAccountId: string; accessTokenExpiresAt: string },
    options: { transitionPolicy: TransitionPolicy },
  ) {
    super(
      "token_valid",
      {
        accessTokenExpiresAt: input.accessTokenExpiresAt,
        calendarAccountId: input.calendarAccountId,
        oauthCredentialId: input.oauthCredentialId,
        refreshAttempts: 0,
      },
      { transitionPolicy: options.transitionPolicy },
    );
  }

  protected isTransitionAllowed(event: CredentialHealthEvent): boolean {
    if (event.type === "TOKEN_EXPIRY_DETECTED") {
      return this.state === "token_valid";
    }
    if (event.type === "REFRESH_STARTED") {
      return this.state === "refresh_required";
    }
    if (
      event.type === "REFRESH_SUCCEEDED"
      || event.type === "REFRESH_REAUTH_REQUIRED"
      || event.type === "REFRESH_RETRYABLE_FAILED"
    ) {
      return this.state === "refreshing";
    }
    return false;
  }

  protected getInvariants(): ((snapshot: CredentialHealthSnapshot) => void)[] {
    return this.invariants;
  }

  protected transition(event: CredentialHealthEvent): CredentialHealthTransitionResult {
    switch (event.type) {
      case "TOKEN_EXPIRY_DETECTED": {
        this.state = "refresh_required";
        return this.result([{ type: "REFRESH_TOKEN" }]);
      }
      case "REFRESH_STARTED": {
        this.state = "refreshing";
        this.context = { ...this.context, refreshAttempts: this.context.refreshAttempts + 1 };
        return this.result();
      }
      case "REFRESH_SUCCEEDED": {
        this.state = "token_valid";
        this.context = {
          ...this.context,
          accessTokenExpiresAt: event.newExpiresAt,
        };
        return this.result(
          [{ expiresAt: event.newExpiresAt, type: "PERSIST_REFRESHED_CREDENTIALS" }],
          [{ type: "CREDENTIALS_HEALTHY" }],
        );
      }
      case "REFRESH_REAUTH_REQUIRED": {
        this.state = "reauth_required";
        this.context = { ...this.context, lastErrorCode: event.code };
        return this.result(
          [{ type: "MARK_ACCOUNT_REAUTH_REQUIRED" }],
          [{ code: event.code, type: "CREDENTIALS_REAUTH_REQUIRED" }],
        );
      }
      case "REFRESH_RETRYABLE_FAILED": {
        this.state = "refresh_failed_retryable";
        this.context = { ...this.context, lastErrorCode: event.code };
        return this.result([], [{ code: event.code, type: "CREDENTIALS_REFRESH_RETRYABLE_FAILURE" }]);
      }
      default: {
        return this.result();
      }
    }
  }
}

export { CredentialHealthStateMachine };
export type {
  CredentialHealthCommand,
  CredentialHealthContext,
  CredentialHealthEvent,
  CredentialHealthMachine,
  CredentialHealthOutput,
  CredentialHealthSnapshot,
  CredentialHealthState,
  CredentialHealthTransitionResult,
};
