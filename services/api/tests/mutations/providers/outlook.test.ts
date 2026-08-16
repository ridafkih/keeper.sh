import { afterEach, describe, expect, it, vi } from "vitest";

import { updateOutlookEvent } from "../../../src/mutations/providers/outlook";

const ACCESS_TOKEN = "outlook-access-token";

const readRequestUrl = (input: string | URL | Request): string => {
  if (input instanceof Request) {
    return input.url;
  }
  return String(input);
};

describe("updateOutlookEvent", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /*
   * Whoever invites the user picks the UID of the event that lands on their calendar, so
   * a quote in it would close the filter's literal and let the rest of the UID name a
   * different event for the update to land on.
   */
  it("keeps a quote in the uid inside the literal it is looking up", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => {
      urls.push(readRequestUrl(input));
      return Promise.resolve(Response.json({ value: [] }));
    }));

    await updateOutlookEvent(ACCESS_TOKEN, "abc' or startswith(subject,'A", {
      title: "Renamed",
    });

    expect(new URL(urls[0] ?? "").searchParams.get("$filter"))
      .toBe("iCalUId eq 'abc'' or startswith(subject,''A'");
  });
});
