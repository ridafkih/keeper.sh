import type { WriteIntent } from "@keeper.sh/sync-protocol";
import { describe, expectTypeOf, test } from "vitest";
import { microsoftWritableCalendar } from "../support/harness";
import { normalizedOf, timedContent } from "../support/intents";

describe("an unconditional update is not expressible", () => {
  test("MS-O26: an update without a precondition does not typecheck", () => {
    expectTypeOf<{
      readonly kind: "update";
      readonly calendar: typeof microsoftWritableCalendar;
      readonly target: { readonly kind: "remoteEventId"; readonly value: string };
      readonly content: ReturnType<typeof normalizedOf>;
    }>().not.toMatchTypeOf<WriteIntent<"microsoft">>();

    expectTypeOf({
      kind: "update",
      calendar: microsoftWritableCalendar,
      target: { kind: "remoteEventId", value: "id-one" },
      content: normalizedOf(timedContent()),
      precondition: { kind: "matchesVersion", version: { kind: "remoteVersion", value: "ck-1" } },
    } as const).toMatchTypeOf<WriteIntent<"microsoft">>();
  });
});
