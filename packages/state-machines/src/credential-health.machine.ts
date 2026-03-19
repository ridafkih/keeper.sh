import { StateMachine } from "./core/state-machine";
import type { MachineSnapshot, MachineTransitionResult } from "./core/state-machine";
import type { EventEnvelope } from "./core/event-envelope";
import type { TransitionPolicy } from "./core/transition-policy";

const CredentialHealthEventType = {
  REFRESH_REAUTH_REQUIRED: "REFRESH_REAUTH_REQUIRED",
  REFRESH_RETRYABLE_FAILED: "REFRESH_RETRYABLE_FAILED",
  REFRESH_STARTED: "REFRESH_STARTED",
  REFRESH_SUCCEEDED: "REFRESH_SUCCEEDED",
  TOKEN_EXPIRY_DETECTED: "TOKEN_EXPIRY_DETECTED",
} as const;

const CredentialHealthCommandType = {
  MARK_ACCOUNT_REAUTH_REQUIRED: "MARK_ACCOUNT_REAUTH_REQUIRED",
  PERSIST_REFRESHED_CREDENTIALS: "PERSIST_REFRESHED_CREDENTIALS",
  REFRESH_TOKEN: "REFRESH_TOKEN",
} as const;

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
  | { type: typeof CredentialHealthEventType.TOKEN_EXPIRY_DETECTED }
  | { type: typeof CredentialHealthEventType.REFRESH_STARTED }
  | { type: typeof CredentialHealthEventType.REFRESH_SUCCEEDED; newExpiresAt: string }
  | { type: typeof CredentialHealthEventType.REFRESH_REAUTH_REQUIRED; code: string }
  | { type: typeof CredentialHealthEventType.REFRESH_RETRYABLE_FAILED; code: string };

type CredentialHealthCommand =
  | { type: typeof CredentialHealthCommandType.REFRESH_TOKEN }
  | { type: typeof CredentialHealthCommandType.MARK_ACCOUNT_REAUTH_REQUIRED }
  | { type: typeof CredentialHealthCommandType.PERSIST_REFRESHED_CREDENTIALS; expiresAt: string };

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
    switch (event.type) {
      case CredentialHealthEventType.TOKEN_EXPIRY_DETECTED: {
        return this.state === "token_valid";
      }
      case CredentialHealthEventType.REFRESH_STARTED: {
        return this.state === "refresh_required";
      }
      case CredentialHealthEventType.REFRESH_SUCCEEDED:
      case CredentialHealthEventType.REFRESH_REAUTH_REQUIRED:
      case CredentialHealthEventType.REFRESH_RETRYABLE_FAILED: {
        return this.state === "refreshing";
      }
      default: {
        return false;
      }
    }
  }

  protected getInvariants(): ((snapshot: CredentialHealthSnapshot) => void)[] {
    return this.invariants;
  }

  protected transition(event: CredentialHealthEvent): CredentialHealthTransitionResult {
    switch (event.type) {
      case CredentialHealthEventType.TOKEN_EXPIRY_DETECTED: {
        this.state = "refresh_required";
        return this.result([{ type: CredentialHealthCommandType.REFRESH_TOKEN }]);
      }
      case CredentialHealthEventType.REFRESH_STARTED: {
        this.state = "refreshing";
        this.context = { ...this.context, refreshAttempts: this.context.refreshAttempts + 1 };
        return this.result();
      }
      case CredentialHealthEventType.REFRESH_SUCCEEDED: {
        this.state = "token_valid";
        this.context = {
          ...this.context,
          accessTokenExpiresAt: event.newExpiresAt,
        };
        return this.result(
          [{ expiresAt: event.newExpiresAt, type: CredentialHealthCommandType.PERSIST_REFRESHED_CREDENTIALS }],
          [{ type: "CREDENTIALS_HEALTHY" }],
        );
      }
      case CredentialHealthEventType.REFRESH_REAUTH_REQUIRED: {
        this.state = "reauth_required";
        this.context = { ...this.context, lastErrorCode: event.code };
        return this.result(
          [{ type: CredentialHealthCommandType.MARK_ACCOUNT_REAUTH_REQUIRED }],
          [{ code: event.code, type: "CREDENTIALS_REAUTH_REQUIRED" }],
        );
      }
      case CredentialHealthEventType.REFRESH_RETRYABLE_FAILED: {
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

export {
  CredentialHealthCommandType,
  CredentialHealthEventType,
  CredentialHealthStateMachine,
};
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
