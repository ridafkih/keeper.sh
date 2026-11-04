import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockSafeFetch } = vi.hoisted(() => ({
  mockSafeFetch: vi.fn<(...args: unknown[]) => Promise<Response>>(),
}));

vi.mock("../../../src/utils/safe-fetch", () => ({
  createSafeFetch: () => mockSafeFetch,
}));

const readFailureReason = async (response: Response): Promise<unknown> => {
  const { pullRemoteCalendar } = await import("../../../src/ics/utils/pull-remote-calendar");
  mockSafeFetch.mockResolvedValueOnce(response);
  try {
    await pullRemoteCalendar("json", "https://example.com/calendar.ics");
  } catch (error) {
    return error;
  }
  throw new Error("Expected the feed to be rejected");
};

describe("pullRemoteCalendar failure reasons", () => {
  beforeEach(() => {
    mockSafeFetch.mockReset();
  });

  it("names a feed behind a login as needing authentication", async () => {
    const error = await readFailureReason(new Response("", { status: 401 }));
    expect(error).toMatchObject({ authRequired: true, reason: "auth_required" });
  });

  it("names a missing feed as not found", async () => {
    const error = await readFailureReason(new Response("", { status: 404 }));
    expect(error).toMatchObject({ authRequired: false, reason: "not_found" });
  });

  it("names a web page as a feed with no calendar terminator", async () => {
    const error = await readFailureReason(new Response("<html><body>Hi</body></html>", { status: 200 }));
    expect(error).toMatchObject({ reason: "truncated" });
  });

  it("names a failing server as an HTTP error", async () => {
    const error = await readFailureReason(new Response("", { status: 503 }));
    expect(error).toMatchObject({ reason: "http_error" });
  });
});
