import { afterEach, describe, expect, it, vi } from "vitest";
import { createKeeperMcpToolset } from "../src/toolset";
import { testFeedbackOptions } from "./helpers/feedback-options";
import type { KeeperToolContext } from "../src/toolset";

const context: KeeperToolContext = {
  apiBaseUrl: "https://api.test",
  bearerToken: "token-123",
};

const stubCountFetch = (): string[] => {
  const urls: string[] = [];
  vi.stubGlobal("fetch", (url: string) => {
    urls.push(url);
    return Promise.resolve(Response.json({ count: 0 }));
  });
  return urls;
};

describe("get_event_count", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("forwards the viewer timezone to the events count route", async () => {
    const urls = stubCountFetch();

    await createKeeperMcpToolset({ feedback: testFeedbackOptions }).get_event_count.execute(context, {
      from: "2026-11-12T06:00:00Z",
      timezone: "America/Chicago",
      to: "2026-11-13T06:00:00Z",
    });

    const url = new URL(urls[0] ?? "");
    expect(url.pathname).toBe("/api/v1/events");
    expect(url.searchParams.get("count")).toBe("true");
    expect(url.searchParams.get("timezone")).toBe("America/Chicago");
  });
});
