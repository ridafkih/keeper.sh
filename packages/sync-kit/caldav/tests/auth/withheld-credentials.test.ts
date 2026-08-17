import { describe, expect, test } from "vitest";
import { classifyCalDAVFailure } from "../../src/errors/classify";
import { failureKindOf } from "../support/expect";
import { createHarness, decadeWindow, operationContext, scopeOver } from "../support/harness";

describe("credentials withheld across a redirect is its own outcome", () => {
  test("DAV-O53: a 401 after a cross-site redirect is never reauthRequired", async () => {
    const harness = createHarness({
      fake: { redirectsTo: "https://elsewhere.example.net/calendars/" },
    });

    const listed = await harness.provider.listChanges(
      { scope: scopeOver(decadeWindow), resume: null },
      operationContext(harness.environment, { deadlineMs: 2000 }),
    );

    expect(failureKindOf(listed)).not.toBe("reauthRequired");
    expect(failureKindOf(listed)).toBe("transport");
  }, 30_000);

  test("DAV-O53: a withheld-credentials 401 classifies apart from a denied one", () => {
    const withheld = classifyCalDAVFailure({
      status: 401,
      precondition: null,
      operation: "listChanges",
      retryAfter: null,
      credentialsWithheld: true,
    });
    const denied = classifyCalDAVFailure({
      status: 401,
      precondition: null,
      operation: "listChanges",
      retryAfter: null,
      credentialsWithheld: false,
    });

    expect(withheld).toEqual({ kind: "credentialsWithheld" });
    expect(denied).toEqual({ kind: "denied", operation: "listChanges" });
  }, 30_000);
});
