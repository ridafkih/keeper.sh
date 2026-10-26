import { afterEach, describe, expect, it, vi } from "vitest";
import { GoogleProjectBudgetExhaustedError } from "@keeper.sh/calendar";
import { createGoogleEvent, deleteGoogleEvent } from "../../../src/mutations/providers/google";

const exhaustedLimiter = {
  acquire: () => Promise.reject(new GoogleProjectBudgetExhaustedError()),
};

const eventInput = {
  calendarId: "calendar-1",
  endTime: "2026-10-27T11:00:00Z",
  startTime: "2026-10-27T10:00:00Z",
  title: "Planning",
};

describe("Google event mutations on a spent project budget", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports the quota instead of calling Google", async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(Response.json({})));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await createGoogleEvent("access-token", "calendar-1", eventInput, exhaustedLimiter);

    expect(result).toEqual({
      error: new GoogleProjectBudgetExhaustedError().message,
      success: false,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("charges the budget for each request a mutation makes", async () => {
    vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => {
      if (new URL(String(input)).searchParams.has("iCalUID")) {
        return Promise.resolve(Response.json({ items: [{ iCalUID: "uid-1", id: "event-1" }] }));
      }
      return Promise.resolve(new Response(null, { status: 204 }));
    }));
    const rateLimiter = { acquire: vi.fn(() => Promise.resolve()) };

    const result = await deleteGoogleEvent("access-token", "calendar-1", "uid-1", rateLimiter);

    expect(result).toEqual({ success: true });
    expect(rateLimiter.acquire).toHaveBeenCalledTimes(2);
  });
});
