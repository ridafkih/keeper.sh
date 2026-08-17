import type { EventUid, RemoteEventId } from "@keeper.sh/sync-protocol";
import { describe, expectTypeOf, test } from "vitest";

describe("a resource path and a UID are different things", () => {
  test("DAV-H6: RemoteEventId and EventUid are not interchangeable", () => {
    expectTypeOf<RemoteEventId>().not.toMatchTypeOf<EventUid>();
    expectTypeOf<EventUid>().not.toMatchTypeOf<RemoteEventId>();
    expectTypeOf<RemoteEventId["kind"]>().toEqualTypeOf<"remoteEventId">();
    expectTypeOf<EventUid["kind"]>().toEqualTypeOf<"eventUid">();
  });
});
