import { MachineRuntimeDriver } from "@keeper.sh/machine-orchestration";
import type { RecoverableCommandOutboxStore } from "@keeper.sh/machine-orchestration";
import {
  CredentialHealthCommandType,
  type CredentialHealthCommand,
} from "@keeper.sh/state-machines";

interface CredentialHealthOutboxRecoveryDependencies {
  outboxStore: RecoverableCommandOutboxStore<CredentialHealthCommand>;
  markNeedsReauthentication: (oauthCredentialId: string) => Promise<void>;
}

const recoverCredentialHealthOutbox = async (
  dependencies: CredentialHealthOutboxRecoveryDependencies,
): Promise<void> => {
  const oauthCredentialIds = await dependencies.outboxStore.listAggregates();
  for (const oauthCredentialId of oauthCredentialIds) {
    await MachineRuntimeDriver.drainAggregateOutbox({
      aggregateId: oauthCredentialId,
      commandBus: {
        execute: async (command) => {
          switch (command.type) {
            case CredentialHealthCommandType.REFRESH_TOKEN: {
              return;
            }
            case CredentialHealthCommandType.PERSIST_REFRESHED_CREDENTIALS: {
              return;
            }
            case CredentialHealthCommandType.MARK_ACCOUNT_REAUTH_REQUIRED: {
              await dependencies.markNeedsReauthentication(oauthCredentialId);
              return;
            }
            default: {
              throw new Error("Unhandled credential health recovery command");
            }
          }
        },
      },
      outboxStore: dependencies.outboxStore,
    });
  }
};

export { recoverCredentialHealthOutbox };
export type { CredentialHealthOutboxRecoveryDependencies };
