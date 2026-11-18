import { afterEach, describe, expect, it } from "vitest";
import { withSpan } from "../src/tracing/spans";
import { startTracingHarness } from "./tracing-harness";

let harness: ReturnType<typeof startTracingHarness> | null = null;

afterEach(async () => {
  await harness?.stop();
  harness = null;
});

const ADDRESS = ["ada.lovelace", "example.com"].join("@");
const FAILURE = `CalDAV multiget failed for https://caldav.example.com/dav/calendars/user/${ADDRESS}/work/`;
const LOGGED_FAILURE = "CalDAV multiget failed for https://caldav.example.com/[path]";

describe("a span whose work failed", () => {
  it("records the failure by the logged form of its message and rethrows the error as thrown", async () => {
    harness = startTracingHarness({ sampleRatio: 1 });
    const thrown = new Error(FAILURE);

    const failure = await withSpan("ingest-source", {}, async () => {
      await Promise.resolve();
      throw thrown;
    }).catch((error: unknown) => error);

    expect(failure).toBe(thrown);
    expect(thrown.message).toBe(FAILURE);

    const [span] = await harness.exportedSpans();
    const [exception] = span?.events ?? [];
    expect(span?.status.message).toBe(LOGGED_FAILURE);
    expect(exception?.attributes?.["exception.message"]).toBe(LOGGED_FAILURE);
    expect(exception?.attributes?.["exception.type"]).toBe("Error");
    expect(JSON.stringify([span?.status, span?.events])).not.toContain(ADDRESS);
  });
});
