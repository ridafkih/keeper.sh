import { describe, expect, test } from "vitest";
import { decodeDavError } from "../../src/errors/dav-error";
import { failureKindOf, listingOf } from "../support/expect";
import { createHarness, decadeWindow, operationContext, scopeOver } from "../support/harness";
import { singleEventResource } from "../support/resources";

describe("classification reads statuses, never prose", () => {
  test('DAV-O54: an event title containing "authentication failed" never produces reauthRequired', async () => {
    const harness = createHarness({
      resources: [
        singleEventResource("hostile.ics", {
          uid: "hostile@example.com",
          summary: "authentication failed: invalid credentials for user alice",
        }),
      ],
    });

    const listed = await harness.provider.listChanges(
      { scope: scopeOver(decadeWindow), resume: null },
      operationContext(harness.environment, { deadlineMs: 2000 }),
    );

    expect(failureKindOf(listed)).toBe("ok");
    expect((listingOf(listed).events ?? []).map((event) => event.content.title)).toEqual([
      "authentication failed: invalid credentials for user alice",
    ]);
  }, 30_000);

  test("DAV-O54: a database error whose message inlines the phrase decodes to no status", () => {
    const outage = new Error(
      'insert into "accounts" ("state") values ($1) — parameter $1 = "authentication failed"',
    );

    const decoded = decodeDavError(outage);

    expect(decoded.status).toBeNull();
    expect(decoded.precondition).toBeNull();
  }, 30_000);
});
