import { describe, expect, test } from "vitest";
import { readRichHint } from "../../src/push/resource-data";

describe("a rich notification's payload is a hint to re-read, never an event", () => {
  test("MS-P4: a rich notification's resource cannot be converted into a RemoteEvent", () => {
    const hint = readRichHint({
      changeType: "updated",
      resource: "Users/mailbox-one/Events/id-one",
      resourceData: {
        id: "id-one",
        subject: "a subject Graph should never be believed about",
        start: { dateTime: "2026-03-21T09:00:00.0000000", timeZone: "UTC" },
      },
    });

    expect(hint).toEqual({ kind: "richHint", changeType: "updated", hasResourceData: true });
    expect(Object.keys(hint ?? {})).toEqual(["kind", "changeType", "hasResourceData"]);
  });

  test("MS-P4: a basic notification carries a hint with no resource data", () => {
    expect(readRichHint({ changeType: "created", resource: "Users/mailbox-one/Events" })).toEqual({
      kind: "richHint",
      changeType: "created",
      hasResourceData: false,
    });
  });
});
