import { describe, expect, it } from "bun:test";
import { InMemoryCommandOutboxStore } from "@keeper.sh/machine-orchestration";
import type { SourceIngestionLifecycleCommand } from "@keeper.sh/state-machines";
import { SourceIngestionLifecycleEventType } from "@keeper.sh/state-machines";
import { createSourceIngestionLifecycleRuntime } from "./source-ingestion-lifecycle-runtime";

describe("source ingestion lifecycle runtime", () => {
  it("marks reauthentication required on auth failure", async () => {
    let markNeedsReauthCalls = 0;
    const runtime = createSourceIngestionLifecycleRuntime({
      handlers: {
        disableSource: () => Promise.resolve(),
        markNeedsReauth: () => {
          markNeedsReauthCalls += 1;
          return Promise.resolve();
        },
        persistSyncToken: () => Promise.resolve(),
      },
      outboxStore: new InMemoryCommandOutboxStore<SourceIngestionLifecycleCommand>(),
      onRuntimeEvent: () => Promise.resolve(),
      provider: "google",
      sourceId: "src-1",
    });

    await runtime.dispatch({ type: SourceIngestionLifecycleEventType.SOURCE_SELECTED });
    await runtime.dispatch({ type: SourceIngestionLifecycleEventType.FETCHER_RESOLVED });
    const transition = await runtime.dispatch({
      code: "auth_required",
      type: SourceIngestionLifecycleEventType.AUTH_FAILURE,
    });

    expect(transition.state).toBe("auth_blocked");
    expect(markNeedsReauthCalls).toBe(1);
  });

  it("disables source on not found failure", async () => {
    let disableCalls = 0;
    const runtime = createSourceIngestionLifecycleRuntime({
      handlers: {
        disableSource: () => {
          disableCalls += 1;
          return Promise.resolve();
        },
        markNeedsReauth: () => Promise.resolve(),
        persistSyncToken: () => Promise.resolve(),
      },
      outboxStore: new InMemoryCommandOutboxStore<SourceIngestionLifecycleCommand>(),
      onRuntimeEvent: () => Promise.resolve(),
      provider: "caldav",
      sourceId: "src-2",
    });

    await runtime.dispatch({ type: SourceIngestionLifecycleEventType.SOURCE_SELECTED });
    await runtime.dispatch({ type: SourceIngestionLifecycleEventType.FETCHER_RESOLVED });
    const transition = await runtime.dispatch({
      code: "not_found",
      type: SourceIngestionLifecycleEventType.NOT_FOUND,
    });

    expect(transition.state).toBe("not_found_disabled");
    expect(disableCalls).toBe(1);
  });

  it("persists sync token on successful ingest", async () => {
    const persistedTokens: string[] = [];
    const runtime = createSourceIngestionLifecycleRuntime({
      handlers: {
        disableSource: () => Promise.resolve(),
        markNeedsReauth: () => Promise.resolve(),
        persistSyncToken: (token) => {
          persistedTokens.push(token);
          return Promise.resolve();
        },
      },
      outboxStore: new InMemoryCommandOutboxStore<SourceIngestionLifecycleCommand>(),
      onRuntimeEvent: () => Promise.resolve(),
      provider: "google",
      sourceId: "src-3",
    });

    await runtime.dispatch({ type: SourceIngestionLifecycleEventType.SOURCE_SELECTED });
    await runtime.dispatch({ type: SourceIngestionLifecycleEventType.FETCHER_RESOLVED });
    await runtime.dispatch({ type: SourceIngestionLifecycleEventType.FETCH_SUCCEEDED });
    const transition = await runtime.dispatch({
      eventsAdded: 1,
      eventsRemoved: 0,
      nextSyncToken: "token-1",
      type: SourceIngestionLifecycleEventType.INGEST_SUCCEEDED,
    });

    expect(transition.state).toBe("completed");
    expect(persistedTokens).toEqual(["token-1"]);
  });
});
