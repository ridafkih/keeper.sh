import { afterEach, describe, expect, it, vi } from "vitest";
import type { SyncableEvent } from "../../../../src/core/types";
import { createOutlookSyncProvider } from "../../../../src/providers/outlook/destination/provider";

const createProvider = (signal?: AbortSignal) =>
  createOutlookSyncProvider({
    accessToken: "test-token",
    refreshToken: "test-refresh",
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
    externalCalendarId: "external-cal-1",
    calendarId: "cal-1",
    userId: "user-1",
    signal,
  });

const createEvent = (): SyncableEvent => ({
  calendarId: "source-calendar-id",
  calendarName: "Source",
  calendarUrl: null,
  endTime: new Date("2026-07-17T19:00:00.000Z"),
  id: "event-state-id-1",
  sourceEventUid: "source-event-uid-1",
  startTime: new Date("2026-07-17T18:00:00.000Z"),
  summary: "Meeting",
});

const installAbortableFetch = (): void => {
  vi.stubGlobal("fetch", vi.fn((_input: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
    })));
};

describe("createOutlookSyncProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a provider with pushEvents, deleteEvents, and listRemoteEvents", () => {
    const provider = createProvider();

    expect(typeof provider.pushEvents).toBe("function");
    expect(typeof provider.deleteEvents).toBe("function");
    expect(typeof provider.listRemoteEvents).toBe("function");
  });

  it("aborts a pending Graph event creation", async () => {
    installAbortableFetch();
    const controller = new AbortController();
    const provider = createProvider(controller.signal);
    const abortError = new Error("job deadline exceeded");

    const pending = provider.pushEvents([createEvent()]);
    await vi.waitFor(() => { expect(fetch).toHaveBeenCalledOnce(); });
    controller.abort(abortError);

    await expect(pending).rejects.toBe(abortError);
  });

  it("aborts a pending Graph event deletion", async () => {
    installAbortableFetch();
    const controller = new AbortController();
    const provider = createProvider(controller.signal);
    const abortError = new Error("job deadline exceeded");

    const pending = provider.deleteEvents(["outlook-event-id"]);
    await vi.waitFor(() => { expect(fetch).toHaveBeenCalledOnce(); });
    controller.abort(abortError);

    await expect(pending).rejects.toBe(abortError);
  });

  it("aborts a pending Graph event listing request", async () => {
    installAbortableFetch();
    const controller = new AbortController();
    const provider = createProvider(controller.signal);
    const abortError = new Error("job deadline exceeded");

    const pending = provider.listRemoteEvents();
    await vi.waitFor(() => { expect(fetch).toHaveBeenCalledOnce(); });
    controller.abort(abortError);

    await expect(pending).rejects.toBe(abortError);
  });

  it("requests plain-text bodies when listing events for content reconciliation", async () => {
    const fetchMock = vi.fn((_input: string | URL | Request, _init?: RequestInit) =>
      Promise.resolve(Response.json({ value: [] })));
    vi.stubGlobal("fetch", fetchMock);

    await createProvider().listRemoteEvents();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: {
        Prefer: `outlook.body-content-type="text"`,
      },
    });
    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestUrl.searchParams.get("$filter")).toContain("end/dateTime ge");
    expect(requestUrl.searchParams.get("$filter")).not.toContain("start/dateTime ge");
  });
});
