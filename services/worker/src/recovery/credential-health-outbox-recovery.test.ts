import { describe, expect, it } from "bun:test";
import { InMemoryCommandOutboxStore } from "@keeper.sh/machine-orchestration";
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
});
