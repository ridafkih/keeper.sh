import {
  type CommandOutboxStore,
  MachineConflictDetectedError,
  type RuntimeProcessEvent,
  type RuntimeMachine,
  InMemoryEnvelopeStore,
  InMemorySnapshotStore,
  MachineRuntimeDriver,
} from "@keeper.sh/machine-orchestration";
import type { OAuthRefreshResult } from "@keeper.sh/calendar";
import {
  CredentialHealthCommandType,
  CredentialHealthEventType,
  CredentialHealthStateMachine,
  TransitionPolicy,
} from "@keeper.sh/state-machines";
import type {
  CredentialHealthCommand,
  CredentialHealthContext,
  CredentialHealthEvent,
  CredentialHealthOutput,
  CredentialHealthState,
  CredentialHealthTransitionResult,
  EventEnvelope,
  MachineSnapshot,
} from "@keeper.sh/state-machines";

interface CredentialHealthRuntimeInput {
  oauthCredentialId: string;
  calendarAccountId: string;
  accessTokenExpiresAt: Date;
  refreshAccessToken: (refreshToken: string) => Promise<OAuthRefreshResult>;
  outboxStore: CommandOutboxStore<CredentialHealthCommand>;
  persistRefreshedCredentials: (input: {
    accessToken: string;
    expiresAt: Date;
    refreshToken: string;
  }) => Promise<void>;
  markNeedsReauthentication: () => Promise<void>;
  isReauthRequiredError: (error: unknown) => boolean;
  onRuntimeEvent: (
    event: RuntimeProcessEvent<
      CredentialHealthState,
      CredentialHealthContext,
      CredentialHealthEvent,
      CredentialHealthCommand,
      CredentialHealthOutput
    >,
  ) => Promise<void> | void;
}

interface CredentialHealthRuntime {
  refresh: (refreshToken: string) => Promise<OAuthRefreshResult>;
  getSnapshot: () => Promise<MachineSnapshot<CredentialHealthState, CredentialHealthContext>>;
}

type CredentialHealthRuntimeEvent = RuntimeProcessEvent<
  CredentialHealthState,
  CredentialHealthContext,
  CredentialHealthEvent,
  CredentialHealthCommand,
  CredentialHealthOutput
>;

const MS_PER_SECOND = 1000;

class RestorableCredentialHealthStateMachine
  extends CredentialHealthStateMachine
  implements RuntimeMachine<
    CredentialHealthState,
    CredentialHealthContext,
    CredentialHealthEvent,
    CredentialHealthCommand,
    CredentialHealthOutput
  >
{
  restore(snapshot: MachineSnapshot<CredentialHealthState, CredentialHealthContext>): void {
    this.state = snapshot.state;
    this.context = snapshot.context;
  }
}

const resolveErrorCode = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message.slice(0, 120);
  }
  return String(error).slice(0, 120);
};

const createCredentialHealthRuntime = (
  input: CredentialHealthRuntimeInput,
): CredentialHealthRuntime => {
  let envelopeSequence = 0;
  const snapshotStore = new InMemorySnapshotStore<
    CredentialHealthState,
    CredentialHealthContext
  >();
  const envelopeStore = new InMemoryEnvelopeStore();
  const machine = new RestorableCredentialHealthStateMachine(
    {
      accessTokenExpiresAt: input.accessTokenExpiresAt.toISOString(),
      calendarAccountId: input.calendarAccountId,
      oauthCredentialId: input.oauthCredentialId,
    },
    { transitionPolicy: TransitionPolicy.IGNORE },
  );
  const driver = new MachineRuntimeDriver<
    CredentialHealthState,
    CredentialHealthContext,
    CredentialHealthEvent,
    CredentialHealthCommand,
    CredentialHealthOutput
  >({
    aggregateId: input.oauthCredentialId,
    commandBus: {
      execute: async (command) => {
        switch (command.type) {
          case CredentialHealthCommandType.REFRESH_TOKEN: {
            return;
          }
          case CredentialHealthCommandType.MARK_ACCOUNT_REAUTH_REQUIRED: {
            await input.markNeedsReauthentication();
            return;
          }
          case CredentialHealthCommandType.PERSIST_REFRESHED_CREDENTIALS: {
            return;
          }
          default: {
            throw new Error("Unhandled credential health command");
          }
        }
      },
    },
    envelopeStore,
    outboxStore: input.outboxStore,
    eventSink: {
      onProcessed: (event) => input.onRuntimeEvent(event),
    },
    machine,
    snapshotStore,
  });

  const dispatch = async (
    event: CredentialHealthEvent,
  ): Promise<CredentialHealthTransitionResult> => {
    const initialSnapshot: MachineSnapshot<CredentialHealthState, CredentialHealthContext> = {
      context: {
        accessTokenExpiresAt: input.accessTokenExpiresAt.toISOString(),
        calendarAccountId: input.calendarAccountId,
        oauthCredentialId: input.oauthCredentialId,
        refreshAttempts: 0,
      },
      state: "token_valid",
    };
    await snapshotStore.initializeIfMissing(input.oauthCredentialId, initialSnapshot);

    envelopeSequence += 1;
    const envelope: EventEnvelope<CredentialHealthEvent> = {
      actor: { id: "sync-refresh", type: "system" },
      event,
      id: `${input.oauthCredentialId}:${envelopeSequence}:${event.type}`,
      occurredAt: new Date().toISOString(),
    };

    const result = await driver.process(envelope);
    if (result.outcome === "CONFLICT_DETECTED") {
      throw new MachineConflictDetectedError(input.oauthCredentialId, envelope.id);
    }
    if (!result.transition) {
      throw new Error("Invariant violated: credential health transition missing");
    }
    await driver.drainOutbox();
    return result.transition;
  };

  const refresh = async (refreshToken: string): Promise<OAuthRefreshResult> => {
    const expiryTransition = await dispatch({ type: CredentialHealthEventType.TOKEN_EXPIRY_DETECTED });
    const shouldRefresh = expiryTransition.commands.some(
      (command) => command.type === CredentialHealthCommandType.REFRESH_TOKEN,
    );
    if (!shouldRefresh) {
      throw new Error("Invariant violated: expected REFRESH_TOKEN command");
    }

    await dispatch({ type: CredentialHealthEventType.REFRESH_STARTED });

    try {
      const refreshed = await input.refreshAccessToken(refreshToken);
      const newExpiresAt = new Date(Date.now() + refreshed.expires_in * MS_PER_SECOND);

      await dispatch({
        type: CredentialHealthEventType.REFRESH_SUCCEEDED,
        newExpiresAt: newExpiresAt.toISOString(),
      });
      await input.persistRefreshedCredentials({
        accessToken: refreshed.access_token,
        expiresAt: newExpiresAt,
        refreshToken: refreshed.refresh_token ?? refreshToken,
      });
      return refreshed;
    } catch (error) {
      const code = resolveErrorCode(error);
      if (input.isReauthRequiredError(error)) {
        await dispatch({ code, type: CredentialHealthEventType.REFRESH_REAUTH_REQUIRED });
        throw error;
      }
      await dispatch({ code, type: CredentialHealthEventType.REFRESH_RETRYABLE_FAILED });
      throw error;
    }
  };

  const getSnapshot = async (): Promise<MachineSnapshot<CredentialHealthState, CredentialHealthContext>> => {
    const record = await snapshotStore.read(input.oauthCredentialId);
    if (!record) {
      throw new Error("Credential health snapshot missing");
    }
    return record.snapshot;
  };

  return {
    getSnapshot,
    refresh,
  };
};

export { createCredentialHealthRuntime };
export type {
  CredentialHealthRuntime,
  CredentialHealthRuntimeEvent,
  CredentialHealthRuntimeInput,
  OAuthRefreshResult,
};
