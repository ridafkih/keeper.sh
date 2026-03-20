import { MachineRuntimeDriver } from "@keeper.sh/machine-orchestration";
import type { RecoverableCommandOutboxStore } from "@keeper.sh/machine-orchestration";
import {
  SourceIngestionLifecycleCommandType,
  type SourceIngestionLifecycleCommand,
} from "@keeper.sh/state-machines";

interface SourceIngestionOutboxRecoveryDependencies {
  outboxStore: RecoverableCommandOutboxStore<SourceIngestionLifecycleCommand>;
  disableSource: (calendarId: string) => Promise<void>;
  markNeedsReauth: (calendarId: string) => Promise<void>;
  persistSyncToken: (calendarId: string, syncToken: string) => Promise<void>;
}

const recoverSourceIngestionOutbox = async (
  dependencies: SourceIngestionOutboxRecoveryDependencies,
): Promise<void> => {
  const calendarIds = await dependencies.outboxStore.listAggregates();
  for (const calendarId of calendarIds) {
    await MachineRuntimeDriver.drainAggregateOutbox({
      aggregateId: calendarId,
      commandBus: {
        execute: async (command) => {
          switch (command.type) {
            case SourceIngestionLifecycleCommandType.DISABLE_SOURCE: {
              await dependencies.disableSource(calendarId);
              return;
            }
            case SourceIngestionLifecycleCommandType.MARK_NEEDS_REAUTH: {
              await dependencies.markNeedsReauth(calendarId);
              return;
            }
            case SourceIngestionLifecycleCommandType.PERSIST_SYNC_TOKEN: {
              await dependencies.persistSyncToken(calendarId, command.syncToken);
              return;
            }
            default: {
              throw new Error("Unhandled source ingestion recovery command");
            }
          }
        },
      },
      outboxStore: dependencies.outboxStore,
    });
  }
};

export { recoverSourceIngestionOutbox };
export type { SourceIngestionOutboxRecoveryDependencies };
