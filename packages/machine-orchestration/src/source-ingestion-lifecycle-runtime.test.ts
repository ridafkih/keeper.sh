import { describe, expect, it } from "bun:test";
import {
  InMemoryCommandOutboxStore,
  RuntimeInvariantViolationError,
} from "./machine-runtime-driver";
import type { SourceIngestionLifecycleCommand } from "@keeper.sh/state-machines";
import { SourceIngestionLifecycleEventType } from "@keeper.sh/state-machines";
import type {
  EventEnvelope,
  SourceIngestionLifecycleEvent,
} from "@keeper.sh/state-machines";
import { createSourceIngestionLifecycleRuntime } from "./source-ingestion-lifecycle-runtime";

const createEnvelopeFactory = (
  sourceId: string,
): ((event: SourceIngestionLifecycleEvent) => EventEnvelope<SourceIngestionLifecycleEvent>) => {
  let sequence = 0;
  return (event) => {
    sequence += 1;
    return {
      actor: { id: "test-cron-ingest", type: "system" },
      event,
      id: `${sourceId}:${sequence}:${event.type}`,
      occurredAt: `2026-03-20T00:00:${String(sequence).padStart(2, "0")}.000Z`,
    };
  };
};

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
      createEnvelope: createEnvelopeFactory("src-1"),
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
      createEnvelope: createEnvelopeFactory("src-2"),
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
      createEnvelope: createEnvelopeFactory("src-3"),
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

  it("fails fast when envelope metadata is invalid", async () => {
    const runtime = createSourceIngestionLifecycleRuntime({
      createEnvelope: (event) => ({
        actor: { id: "test-cron-ingest", type: "system" },
        event,
        id: "",
        occurredAt: "invalid-time",
      }),
      handlers: {
        disableSource: () => Promise.resolve(),
        markNeedsReauth: () => Promise.resolve(),
        persistSyncToken: () => Promise.resolve(),
      },
      outboxStore: new InMemoryCommandOutboxStore<SourceIngestionLifecycleCommand>(),
      onRuntimeEvent: () => Promise.resolve(),
      provider: "google",
      sourceId: "src-invalid",
    });

    await expect(
      runtime.dispatch({ type: SourceIngestionLifecycleEventType.SOURCE_SELECTED }),
    ).rejects.toBeInstanceOf(RuntimeInvariantViolationError);
    await expect(
      runtime.dispatch({ type: SourceIngestionLifecycleEventType.SOURCE_SELECTED }),
    ).rejects.toMatchObject({
      code: "SOURCE_INGESTION_ENVELOPE_ID_REQUIRED",
      surface: "source-ingestion-lifecycle-runtime",
    });
  });

  it("ignores duplicate replayed events without side effects", async () => {
    const persistedTokens: string[] = [];
    const runtime = createSourceIngestionLifecycleRuntime({
      createEnvelope: (event) => ({
        actor: { id: "test-cron-ingest", type: "system" },
        event,
        id: `src-dup:${event.type}`,
        occurredAt: "2026-03-20T00:00:00.000Z",
      }),
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
      sourceId: "src-dup",
    });

    await runtime.dispatch({ type: SourceIngestionLifecycleEventType.SOURCE_SELECTED });
    await runtime.dispatch({ type: SourceIngestionLifecycleEventType.SOURCE_SELECTED });
    await runtime.dispatch({ type: SourceIngestionLifecycleEventType.FETCHER_RESOLVED });
    await runtime.dispatch({ type: SourceIngestionLifecycleEventType.FETCH_SUCCEEDED });
    await runtime.dispatch({
      eventsAdded: 1,
      eventsRemoved: 0,
      nextSyncToken: "dup-token",
      type: SourceIngestionLifecycleEventType.INGEST_SUCCEEDED,
    });
    await runtime.dispatch({
      eventsAdded: 1,
      eventsRemoved: 0,
      nextSyncToken: "dup-token",
      type: SourceIngestionLifecycleEventType.INGEST_SUCCEEDED,
    });

    expect(persistedTokens).toEqual(["dup-token"]);
  });

  it("ignores stale terminal event after completion", async () => {
    let markNeedsReauthCalls = 0;
    let disableCalls = 0;
    const persistedTokens: string[] = [];
    const runtime = createSourceIngestionLifecycleRuntime({
      handlers: {
        disableSource: () => {
          disableCalls += 1;
          return Promise.resolve();
        },
        markNeedsReauth: () => {
          markNeedsReauthCalls += 1;
          return Promise.resolve();
        },
        persistSyncToken: (token) => {
          persistedTokens.push(token);
          return Promise.resolve();
        },
      },
      createEnvelope: createEnvelopeFactory("src-stale"),
      outboxStore: new InMemoryCommandOutboxStore<SourceIngestionLifecycleCommand>(),
      onRuntimeEvent: () => Promise.resolve(),
      provider: "google",
      sourceId: "src-stale",
    });

    await runtime.dispatch({ type: SourceIngestionLifecycleEventType.SOURCE_SELECTED });
    await runtime.dispatch({ type: SourceIngestionLifecycleEventType.FETCHER_RESOLVED });
    await runtime.dispatch({ type: SourceIngestionLifecycleEventType.FETCH_SUCCEEDED });
    await runtime.dispatch({
      eventsAdded: 2,
      eventsRemoved: 0,
      nextSyncToken: "fresh-token",
      type: SourceIngestionLifecycleEventType.INGEST_SUCCEEDED,
    });
    const stale = await runtime.dispatch({
      code: "auth_required",
      type: SourceIngestionLifecycleEventType.AUTH_FAILURE,
    });

    expect(stale.state).toBe("completed");
    expect(stale.commands).toEqual([]);
    expect(stale.outputs).toEqual([]);
    expect(persistedTokens).toEqual(["fresh-token"]);
    expect(markNeedsReauthCalls).toBe(0);
    expect(disableCalls).toBe(0);
  });
});
