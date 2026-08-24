import { afterEach, describe, expect, it, vi } from "vitest";
import { listUserCalendars } from "../../../../../src/providers/outlook/source/utils/list-calendars";

const originalFetch = globalThis.fetch;

const calendarListBody = {
  value: [{ canEdit: true, id: "calendar-1", name: "Calendar" }],
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("listUserCalendars abort support", () => {
  it("forwards the abort signal to every calendar list request", async () => {
    const controller = new AbortController();
    const seen: (AbortSignal | null)[] = [];

    globalThis.fetch = vi.fn((_url: unknown, init?: RequestInit) => {
      seen.push(init?.signal ?? null);
      return Promise.resolve(Response.json(calendarListBody));
    }) as unknown as typeof fetch;

    await listUserCalendars("token", { signal: controller.signal });

    expect(seen).toEqual([controller.signal]);
  });

  it("rejects when the caller aborts a request that never settles", async () => {
    const controller = new AbortController();

    globalThis.fetch = vi.fn((_url: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(init.signal?.reason),
          { once: true },
        );
      })) as unknown as typeof fetch;

    const pending = listUserCalendars("token", { signal: controller.signal });
    const timeoutError = new Error("deadline exceeded");
    controller.abort(timeoutError);

    await expect(pending).rejects.toBe(timeoutError);
  });
});

const mockCalendarListResponse = (
  calendars: { id: string; name: string; owner?: { name?: string; address?: string } }[],
): void => {
  const mockFetch = (): Promise<Response> => Promise.resolve(Response.json({ value: calendars }));
  mockFetch.preconnect = originalFetch.preconnect;
  globalThis.fetch = mockFetch;
};

describe("listUserCalendars", () => {
  it("returns all calendars when no owner email is given", async () => {
    mockCalendarListResponse([
      { id: "cal-own", name: "Own calendar", owner: { address: "me@example.com" } },
      { id: "cal-shared", name: "Colleague calendar", owner: { address: "colleague@example.com" } },
    ]);

    const calendars = await listUserCalendars("test-token");

    expect(calendars.map((entry) => entry.id)).toEqual(["cal-own", "cal-shared"]);
  });

  it("excludes calendars owned by a different mailbox when an owner email is given", async () => {
    mockCalendarListResponse([
      { id: "cal-own", name: "Own calendar", owner: { address: "me@example.com" } },
      { id: "cal-shared", name: "Colleague calendar", owner: { address: "colleague@example.com" } },
    ]);

    const calendars = await listUserCalendars("test-token", { ownerEmail: "me@example.com" });

    expect(calendars.map((entry) => entry.id)).toEqual(["cal-own"]);
  });

  it("compares owner emails case-insensitively", async () => {
    mockCalendarListResponse([
      { id: "cal-own", name: "Own calendar", owner: { address: "Me@Example.com" } },
    ]);

    const calendars = await listUserCalendars("test-token", { ownerEmail: "me@example.com" });

    expect(calendars.map((entry) => entry.id)).toEqual(["cal-own"]);
  });

  it("keeps calendars with no owner info at all when filtering by owner email", async () => {
    mockCalendarListResponse([
      { id: "cal-no-owner", name: "Default calendar" },
    ]);

    const calendars = await listUserCalendars("test-token", { ownerEmail: "me@example.com" });

    expect(calendars.map((entry) => entry.id)).toEqual(["cal-no-owner"]);
  });
});
