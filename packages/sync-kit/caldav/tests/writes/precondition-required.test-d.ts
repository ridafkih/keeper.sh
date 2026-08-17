import type { WriteIntent } from "@keeper.sh/sync-protocol";
import { describe, expectTypeOf, test } from "vitest";
import { caldavWritableCalendar } from "../support/harness";
import { normalizedOf, timedContent } from "../support/intents";

describe("an unconditional update or delete is not expressible", () => {
  test("DAV-O38: an update without a precondition does not typecheck", () => {
    expectTypeOf<{
      readonly kind: "update";
      readonly calendar: typeof caldavWritableCalendar;
      readonly target: { readonly kind: "remoteEventId"; readonly value: string };
      readonly content: ReturnType<typeof normalizedOf>;
    }>().not.toMatchTypeOf<WriteIntent<"caldav">>();

    expectTypeOf<{
      readonly kind: "update";
      readonly calendar: typeof caldavWritableCalendar;
      readonly target: { readonly kind: "remoteEventId"; readonly value: string };
      readonly content: ReturnType<typeof normalizedOf>;
      readonly precondition: undefined;
    }>().not.toMatchTypeOf<WriteIntent<"caldav">>();

    expectTypeOf<{
      readonly kind: "delete";
      readonly calendar: typeof caldavWritableCalendar;
      readonly target: { readonly kind: "deleteHandle"; readonly value: string };
      readonly reason: "sourceDeleted";
    }>().not.toMatchTypeOf<WriteIntent<"caldav">>();

    expectTypeOf({
      kind: "update",
      calendar: caldavWritableCalendar,
      target: { kind: "remoteEventId", value: "/calendars/alice/personal/one.ics" },
      content: normalizedOf(timedContent()),
      precondition: { kind: "matchesVersion", version: { kind: "remoteVersion", value: '"etag-1"' } },
    } as const).toMatchTypeOf<WriteIntent<"caldav">>();
  });
});
