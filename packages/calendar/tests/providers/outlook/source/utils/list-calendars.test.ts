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

    await listUserCalendars("token", controller.signal);

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

    const pending = listUserCalendars("token", controller.signal);
    const timeoutError = new Error("deadline exceeded");
    controller.abort(timeoutError);

    await expect(pending).rejects.toBe(timeoutError);
  });
});
