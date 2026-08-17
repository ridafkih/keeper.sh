import type { CalendarProvider } from "@keeper.sh/sync-protocol";
import { describe, expectTypeOf, test } from "vitest";
import type { createCalDAVProvider } from "../../src/provider";

describe("poll-only is the absence of a method, not a boolean", () => {
  test("DAV-H22: the exported provider has no watch member and src declares no push capability boolean", () => {
    type Provider = ReturnType<typeof createCalDAVProvider>;

    expectTypeOf<Provider>().toEqualTypeOf<CalendarProvider<"caldav">>();
    expectTypeOf<keyof Provider>().toEqualTypeOf<
      "capabilities" | "listCalendars" | "listChanges" | "normalize" | "write"
    >();
    expectTypeOf<Provider>().not.toHaveProperty("watch");
    expectTypeOf<Provider["capabilities"]>().not.toHaveProperty("supportsPush");
  });
});
