import { describe, expect, it } from "vitest";
import { invalidateAccountsAndSources, isEventsKey } from "../../src/lib/swr";

describe("isEventsKey", () => {
  it("matches every cached page of events, including the infinite list", () => {
    expect(isEventsKey("/api/events?from=a&to=b")).toBe(true);
    expect(isEventsKey("$inf$/api/events?from=a&to=b")).toBe(true);
    expect(isEventsKey("/api/events/count")).toBe(true);
  });

  it("leaves other caches alone", () => {
    expect(isEventsKey("/api/sources")).toBe(false);
    expect(isEventsKey(["/api/sync/copies", "1"])).toBe(false);
  });
});

describe("invalidateAccountsAndSources", () => {
  it("revalidates accounts, sources and the events they bring", async () => {
    const calls: unknown[] = [];
    const mutate = ((key: unknown) => {
      calls.push(typeof key === "function" ? "events" : key);
      return Promise.resolve();
    }) as Parameters<typeof invalidateAccountsAndSources>[0];

    await invalidateAccountsAndSources(mutate);

    expect(calls).toEqual(["/api/accounts", "/api/sources", "events"]);
  });
});
