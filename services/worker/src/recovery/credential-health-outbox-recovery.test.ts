import { describe, expect, it } from "bun:test";
import {
  InMemoryCommandOutboxStore,
  MachineRuntimeDriver,
} from "@keeper.sh/machine-orchestration";
import {
  CredentialHealthCommandType,
  type CredentialHealthCommand,
} from "@keeper.sh/state-machines";
import { recoverCredentialHealthOutbox } from "./credential-health-outbox-recovery";

describe("recoverCredentialHealthOutbox", () => {
  it("drains reauth commands for pending credential aggregates", async () => {
    const marked: string[] = [];
    const outboxStore = new InMemoryCommandOutboxStore<CredentialHealthCommand>();
    await outboxStore.enqueue({
      aggregateId: "oauth-1",
      commands: [{ type: CredentialHealthCommandType.MARK_ACCOUNT_REAUTH_REQUIRED }],
      envelopeId: "env-1",
      nextCommandIndex: 0,
    });

    await recoverCredentialHealthOutbox({
      outboxStore,
      markNeedsReauthentication: (oauthCredentialId) => {
        marked.push(oauthCredentialId);
        return Promise.resolve();
      },
    });

    expect(marked).toEqual(["oauth-1"]);
    expect(await outboxStore.listAggregates()).toEqual([]);
  });

  it("is idempotent across startup and interval recovery runs", async () => {
    const marked: string[] = [];
    const outboxStore = new InMemoryCommandOutboxStore<CredentialHealthCommand>();
    await outboxStore.enqueue({
      aggregateId: "oauth-2",
      commands: [{ type: CredentialHealthCommandType.MARK_ACCOUNT_REAUTH_REQUIRED }],
      envelopeId: "env-2",
      nextCommandIndex: 0,
    });

    await recoverCredentialHealthOutbox({
      outboxStore,
      markNeedsReauthentication: (oauthCredentialId) => {
        marked.push(oauthCredentialId);
        return Promise.resolve();
      },
    });

    await recoverCredentialHealthOutbox({
      outboxStore,
      markNeedsReauthentication: (oauthCredentialId) => {
        marked.push(oauthCredentialId);
        return Promise.resolve();
      },
    });

    expect(marked).toEqual(["oauth-2"]);
    expect(await outboxStore.listAggregates()).toEqual([]);
  });

  it("does not double-execute when recovery overlaps live aggregate drain", async () => {
    const marked: string[] = [];
    const outboxStore = new InMemoryCommandOutboxStore<CredentialHealthCommand>();
    await outboxStore.enqueue({
      aggregateId: "oauth-3",
      commands: [{ type: CredentialHealthCommandType.MARK_ACCOUNT_REAUTH_REQUIRED }],
      envelopeId: "env-3",
      nextCommandIndex: 0,
    });

    await Promise.all([
      recoverCredentialHealthOutbox({
        outboxStore,
        markNeedsReauthentication: (oauthCredentialId) => {
          marked.push(oauthCredentialId);
          return Promise.resolve();
        },
      }),
      MachineRuntimeDriver.drainAggregateOutbox({
        aggregateId: "oauth-3",
        commandBus: {
          execute: (command) => {
            if (command.type !== CredentialHealthCommandType.MARK_ACCOUNT_REAUTH_REQUIRED) {
              throw new Error("Unexpected credential-health command during overlap test");
            }
            marked.push("oauth-3");
            return Promise.resolve();
          },
        },
        outboxStore,
      }),
    ]);

    expect(marked).toEqual(["oauth-3"]);
    expect(await outboxStore.listAggregates()).toEqual([]);
  });

  it("resumes partially drained records without losing remaining commands", async () => {
    const marked: string[] = [];
    const outboxStore = new InMemoryCommandOutboxStore<CredentialHealthCommand>();
    await outboxStore.enqueue({
      aggregateId: "oauth-4",
      commands: [
        { type: CredentialHealthCommandType.REFRESH_TOKEN },
        { type: CredentialHealthCommandType.MARK_ACCOUNT_REAUTH_REQUIRED },
      ],
      envelopeId: "env-4",
      nextCommandIndex: 1,
    });

    await recoverCredentialHealthOutbox({
      outboxStore,
      markNeedsReauthentication: (oauthCredentialId) => {
        marked.push(oauthCredentialId);
        return Promise.resolve();
      },
    });

    expect(marked).toEqual(["oauth-4"]);
    expect(await outboxStore.listAggregates()).toEqual([]);
  });
});
