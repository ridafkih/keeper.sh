import {
  SyncTokenStrategyStateMachine,
  TransitionPolicy,
} from "@keeper.sh/state-machines";
import type {
  SyncTokenStrategyCommand,
  SyncTokenStrategyEvent,
  SyncTokenStrategyTransitionResult,
} from "@keeper.sh/state-machines";

interface SyncTokenResolutionInput {
  requiredWindowVersion: number;
  loadedWindowVersion?: number;
  token: string | null;
}

interface SyncTokenResolutionOutput {
  resolvedToken: string | null;
  requiresBackfill: boolean;
}

interface SourceSyncTokenActionInput {
  isDeltaSync: boolean | undefined;
  nextSyncToken: string | undefined;
}

interface SourceSyncTokenActionOutput {
  nextSyncTokenToPersist?: string;
  shouldResetSyncToken: boolean;
}

const createEnvelope = <TEvent>(event: TEvent, sequence: number) => ({
  actor: { id: "sync-token-runtime", type: "system" as const },
  event,
  id: `sync-token:${sequence}`,
  occurredAt: "2026-03-19T00:00:00.000Z",
});

const hasCommand = (
  commands: SyncTokenStrategyCommand[],
  commandType: SyncTokenStrategyCommand["type"],
): boolean => commands.some((command) => command.type === commandType);

const resolvePersistedTokenFromCommands = (
  commands: SyncTokenStrategyCommand[],
): string | undefined =>
  commands.find((command) => command.type === "PERSIST_SYNC_TOKEN")?.token;

const resolveSyncTokenFromMachine = (
  input: SyncTokenResolutionInput,
): SyncTokenResolutionOutput => {
  const machine = new SyncTokenStrategyStateMachine(
    { requiredWindowVersion: input.requiredWindowVersion },
    { transitionPolicy: TransitionPolicy.IGNORE },
  );

  const loaded = machine.dispatch(
    createEnvelope(
      {
        type: "TOKEN_LOADED" as const,
        token: input.token,
        loadedWindowVersion: input.loadedWindowVersion,
      },
      1,
    ),
  );

  return {
    requiresBackfill: hasCommand(loaded.commands, "REQUEST_FULL_SYNC"),
    resolvedToken: loaded.context.syncToken ?? null,
  };
};

const resolveSourceSyncTokenActionFromMachine = (
  input: SourceSyncTokenActionInput,
): SourceSyncTokenActionOutput => {
  const machine = new SyncTokenStrategyStateMachine(
    { requiredWindowVersion: 1 },
    { transitionPolicy: TransitionPolicy.IGNORE },
  );

  const dispatch = (event: SyncTokenStrategyEvent, sequence: number): SyncTokenStrategyTransitionResult =>
    machine.dispatch(createEnvelope(event, sequence));

  const loadedEvent = (): SyncTokenStrategyEvent => {
    if (input.isDeltaSync) {
      return {
        loadedWindowVersion: 1,
        token: "delta-token",
        type: "TOKEN_LOADED",
      };
    }
    return {
      loadedWindowVersion: 1,
      token: null,
      type: "TOKEN_LOADED",
    };
  };

  dispatch(loadedEvent(), 1);

  if (input.isDeltaSync) {
    dispatch({ type: "DELTA_SYNC_REQUESTED" }, 2);
  }

  const resolveTransitionCommands = (): SyncTokenStrategyCommand[] => {
    if (!input.nextSyncToken && !input.isDeltaSync) {
      return [];
    }

    if (input.nextSyncToken) {
      if (input.isDeltaSync) {
        return dispatch({
          token: input.nextSyncToken,
          type: "NEXT_TOKEN_RECEIVED",
        }, 3).commands;
      }
      return dispatch({
        token: input.nextSyncToken,
        type: "NEXT_TOKEN_RECEIVED",
      }, 2).commands;
    }

    return dispatch({ type: "TOKEN_INVALIDATED" }, 3).commands;
  };

  const commands = resolveTransitionCommands();
  return {
    nextSyncTokenToPersist: resolvePersistedTokenFromCommands(commands),
    shouldResetSyncToken: hasCommand(commands, "CLEAR_SYNC_TOKEN"),
  };
};

export {
  resolveSourceSyncTokenActionFromMachine,
  resolveSyncTokenFromMachine,
};
export type {
  SourceSyncTokenActionInput,
  SourceSyncTokenActionOutput,
  SyncTokenResolutionInput,
  SyncTokenResolutionOutput,
};
