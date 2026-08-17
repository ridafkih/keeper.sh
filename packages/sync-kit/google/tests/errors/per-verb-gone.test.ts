import { describe, expect, test } from "vitest";
import { classifyGoogleError } from "../../src/errors/classify";
import { stopWatchChannel } from "../../src/push/watch";
import { createRequestSeam } from "../../src/client/request";
import { createSemaphore } from "../../src/client/semaphore";
import { outcomeKindOf } from "../support/expect";
import {
  createHarness,
  googleCalendar,
  operationContext,
  suiteStart,
} from "../support/harness";
import { deleteIntent, versionOf } from "../support/intents";

const gone = { status: 410, reasons: ["deleted"], retryAfter: null };

describe("410 means a different thing on every verb", () => {
  test("GOOG-O26: a 410 on delete is alreadyAbsent and a 410 on list is cursorLost", async () => {
    const harness = createHarness();

    const removed = await harness.provider.write(
      deleteIntent("id-never-existed", versionOf("v1-never-existed")),
      operationContext(harness.environment),
    );

    expect(outcomeKindOf(removed)).toBe("alreadyAbsent");
    expect(classifyGoogleError({ ...gone, reasons: ["fullSyncRequired"] }, "listChanges").kind).toBe(
      "cursorLost",
    );
  });

  test("GOOG-O26: a 410 on channels.stop leaves the channel already gone, never a failure", async () => {
    const harness = createHarness();
    const surroundings = {
      dependencies: harness.dependencies,
      requests: createRequestSeam({
        dependencies: harness.dependencies,
        permits: createSemaphore(harness.dependencies.concurrency),
      }),
    };

    const stopped = await stopWatchChannel(
      {
        channelId: "channel-that-expired",
        resourceId: "resource-that-expired",
        calendar: googleCalendar,
        expiration: suiteStart,
      },
      operationContext(harness.environment),
      surroundings,
    );

    expect(stopped.ok).toBe(true);
  });

  test("GOOG-O26: there is no shared success predicate over status codes", () => {
    expect(classifyGoogleError(gone, "write").kind).toBe("resourceGone");
    expect(classifyGoogleError({ ...gone, reasons: ["fullSyncRequired"] }, "listChanges").kind).toBe(
      "cursorLost",
    );
  });
});
