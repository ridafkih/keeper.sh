import { describe, expect, test } from "vitest";
import { releaseResponseBody } from "../../src/client/response-body";
import { createHarness, decadeWindow, operationContext, scopeOver } from "../support/harness";
import {
  createIntent,
  deleteIntent,
  normalizedOf,
  timedContent,
  versionOf,
} from "../support/intents";
import { singleEventResource } from "../support/resources";

const countingResponse = (
  status: number,
): { readonly response: Response; readonly cancelled: () => number } => {
  let cancelled = 0;
  const body = new ReadableStream<Uint8Array>({
    start: (controller) => {
      controller.enqueue(new TextEncoder().encode("<d:multistatus/>"));
      controller.close();
    },
    cancel: () => {
      cancelled += 1;
    },
  });
  return { response: new Response(body, { status }), cancelled: () => cancelled };
};

describe("no response body is left holding a socket", () => {
  test("DAV-L19: a 412, a 401 retry and a 204 each release their body exactly once", async () => {
    const harness = createHarness({
      fake: { offersDigestOnly: true },
      resources: [singleEventResource("one.ics")],
    });

    await harness.provider.write(
      createIntent("idem-one", normalizedOf(timedContent()), "caldav-tests"),
      operationContext(harness.environment, { deadlineMs: 2000 }),
    );
    await harness.provider.write(
      deleteIntent("/calendars/alice/personal/one.ics", versionOf('"etag-1"')),
      operationContext(harness.environment, { deadlineMs: 2000 }),
    );
    await harness.provider.listChanges(
      { scope: scopeOver(decadeWindow), resume: null },
      operationContext(harness.environment, { deadlineMs: 2000 }),
    );

    const bodies = harness.fake.bodies();
    expect(bodies.cancelled + bodies.consumed).toBe(bodies.issued);
  }, 30_000);

  test("DAV-L19: releasing a body twice cancels it once", async () => {
    const counting = countingResponse(412);

    await releaseResponseBody(counting.response);
    await releaseResponseBody(counting.response);

    expect(counting.cancelled()).toBe(1);
  }, 30_000);
});
