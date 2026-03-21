import { describe, expect, it } from "bun:test";
import { InMemoryCommandOutboxStore } from "@keeper.sh/machine-orchestration";
import {
  SourceIngestionLifecycleCommandType,
  type SourceIngestionLifecycleCommand,
} from "@keeper.sh/state-machines";
import { recoverSourceIngestionOutbox } from "./source-ingestion-outbox-recovery";

describe("recoverSourceIngestionOutbox", () => {
  it("drains pending source-ingestion commands", async () => {
    const marked: string[] = [];
    const disabled: string[] = [];
    const tokens: { calendarId: string; token: string }[] = [];
    const outboxStore = new InMemoryCommandOutboxStore<SourceIngestionLifecycleCommand>();
    await outboxStore.enqueue({
      aggregateId: "cal-1",
      commands: [
        { type: SourceIngestionLifecycleCommandType.MARK_NEEDS_REAUTH },
        { type: SourceIngestionLifecycleCommandType.PERSIST_SYNC_TOKEN, syncToken: "token-1" },
      ],
      envelopeId: "env-1",
      nextCommandIndex: 0,
    });
    await outboxStore.enqueue({
      aggregateId: "cal-2",
      commands: [{ type: SourceIngestionLifecycleCommandType.DISABLE_SOURCE }],
      envelopeId: "env-2",
      nextCommandIndex: 0,
    });

    await recoverSourceIngestionOutbox({
      outboxStore,
      disableSource: (calendarId) => {
        disabled.push(calendarId);
        return Promise.resolve();
      },
      markNeedsReauth: (calendarId) => {
        marked.push(calendarId);
        return Promise.resolve();
      },
      persistSyncToken: (calendarId, syncToken) => {
        tokens.push({ calendarId, token: syncToken });
        return Promise.resolve();
      },
    });

    expect(marked).toEqual(["cal-1"]);
    expect(disabled).toEqual(["cal-2"]);
    expect(tokens).toEqual([{ calendarId: "cal-1", token: "token-1" }]);
    expect(await outboxStore.listAggregates()).toEqual([]);
  });

  it("is idempotent across startup and interval recovery runs", async () => {
    const marked: string[] = [];
    const disabled: string[] = [];
    const tokens: { calendarId: string; token: string }[] = [];
    const outboxStore = new InMemoryCommandOutboxStore<SourceIngestionLifecycleCommand>();
    await outboxStore.enqueue({
      aggregateId: "cal-3",
      commands: [
        { type: SourceIngestionLifecycleCommandType.MARK_NEEDS_REAUTH },
        { type: SourceIngestionLifecycleCommandType.PERSIST_SYNC_TOKEN, syncToken: "token-3" },
      ],
      envelopeId: "env-3",
      nextCommandIndex: 0,
    });
    await outboxStore.enqueue({
      aggregateId: "cal-4",
      commands: [{ type: SourceIngestionLifecycleCommandType.DISABLE_SOURCE }],
      envelopeId: "env-4",
      nextCommandIndex: 0,
    });

    await recoverSourceIngestionOutbox({
      outboxStore,
      disableSource: (calendarId) => {
        disabled.push(calendarId);
        return Promise.resolve();
      },
      markNeedsReauth: (calendarId) => {
        marked.push(calendarId);
        return Promise.resolve();
      },
      persistSyncToken: (calendarId, syncToken) => {
        tokens.push({ calendarId, token: syncToken });
        return Promise.resolve();
      },
    });

    await recoverSourceIngestionOutbox({
      outboxStore,
      disableSource: (calendarId) => {
        disabled.push(calendarId);
        return Promise.resolve();
      },
      markNeedsReauth: (calendarId) => {
        marked.push(calendarId);
        return Promise.resolve();
      },
      persistSyncToken: (calendarId, syncToken) => {
        tokens.push({ calendarId, token: syncToken });
        return Promise.resolve();
      },
    });

    expect(marked).toEqual(["cal-3"]);
    expect(disabled).toEqual(["cal-4"]);
    expect(tokens).toEqual([{ calendarId: "cal-3", token: "token-3" }]);
    expect(await outboxStore.listAggregates()).toEqual([]);
  });
});
