import { afterEach, describe, expect, it, vi } from "vitest";
import type { MaterializedSyncableEvent } from "../../../../src/core/types";
import { createOutlookSyncProvider } from "../../../../src/providers/outlook/destination/provider";
import { KEEPER_CATEGORY } from "@keeper.sh/constants";

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

const createEvent = (): MaterializedSyncableEvent => ({
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

    const pending = provider.listRemoteEvents({
      timeMin: new Date("2026-07-10T00:00:00.000Z"),
    });
    await vi.waitFor(() => { expect(fetch).toHaveBeenCalledOnce(); });
    controller.abort(abortError);

    await expect(pending).rejects.toBe(abortError);
  });

  it("requests plain-text bodies when listing events for content reconciliation", async () => {
    const fetchMock = vi.fn((_input: string | URL | Request, _init?: RequestInit) =>
      Promise.resolve(Response.json({ value: [] })));
    vi.stubGlobal("fetch", fetchMock);

    await createProvider().listRemoteEvents({
      timeMin: new Date("2026-07-10T00:00:00.000Z"),
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: {
        Prefer: `outlook.body-content-type="text"`,
      },
    });
    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestUrl.searchParams.get("$filter")).toContain("end/dateTime ge");
    expect(requestUrl.searchParams.get("$filter")).not.toContain("start/dateTime le");
  });

  it("pages through far-future Keeper events without a future cutoff", async () => {
    const timeMin = new Date("2026-07-10T00:00:00.000Z");
    const nextLink = "https://graph.microsoft.com/v1.0/me/events?$skiptoken=page-2";
    const eventTime = {
      end: { dateTime: "2040-03-15T10:00:00.000Z", timeZone: "UTC" },
      start: { dateTime: "2040-03-15T09:00:00.000Z", timeZone: "UTC" },
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({
        "@odata.nextLink": nextLink,
        value: [{
          ...eventTime,
          categories: [KEEPER_CATEGORY],
          iCalUId: "canonical-uid",
          id: "canonical-id",
        }],
      }))
      .mockResolvedValueOnce(Response.json({
        value: [{
          ...eventTime,
          categories: [KEEPER_CATEGORY],
          iCalUId: "duplicate-uid",
          id: "duplicate-id",
        }, {
          ...eventTime,
          categories: [],
          iCalUId: "mapped-but-untagged-uid",
          id: "mapped-but-untagged-id",
        }],
      }));
    vi.stubGlobal("fetch", fetchMock);

    const remoteEvents = await createProvider().listRemoteEvents({ timeMin });

    expect(remoteEvents.map((event) => ({
      deleteId: event.deleteId,
      isKeeperEvent: event.isKeeperEvent,
    }))).toEqual([
      { deleteId: "canonical-id", isKeeperEvent: true },
      { deleteId: "duplicate-id", isKeeperEvent: true },
      { deleteId: "mapped-but-untagged-id", isKeeperEvent: false },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const initialUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    const filter = initialUrl.searchParams.get("$filter") ?? "";
    expect(filter).not.toContain("categories");
    expect(filter).toContain(`end/dateTime ge '${timeMin.toISOString()}'`);
    expect(filter).not.toContain("start/dateTime le");
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(nextLink);
  });

  it("canonicalizes named-timezone all-day responses to date-only UTC instants", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({
      value: [{
        categories: [KEEPER_CATEGORY],
        end: { dateTime: "2026-03-09T00:00:00.0000000", timeZone: "Mountain Standard Time" },
        iCalUId: "all-day-uid",
        id: "all-day-id",
        isAllDay: true,
        start: { dateTime: "2026-03-08T00:00:00.0000000", timeZone: "Mountain Standard Time" },
      }],
    }));
    vi.stubGlobal("fetch", fetchMock);

    const [event] = await createProvider().listRemoteEvents({
      timeMin: new Date("2026-03-01T00:00:00.000Z"),
    });

    expect(event).toMatchObject({
      endTime: new Date("2026-03-09T00:00:00.000Z"),
      startTime: new Date("2026-03-08T00:00:00.000Z"),
    });
  });
});
