import type { AccountId } from "@keeper.sh/sync-protocol";
import { describe, expectTypeOf, test } from "vitest";
import { caldavAccountId } from "../../src/identity/account";

describe("a CalDAV account identity needs no address", () => {
  test("DAV-H7: AccountId is derivable with no address available", () => {
    expectTypeOf(caldavAccountId).toBeCallableWith(
      "https://dav.synology.example",
      "/principals/users/alice/",
    );
    expectTypeOf(caldavAccountId).returns.toEqualTypeOf<AccountId>();
    expectTypeOf<Parameters<typeof caldavAccountId>>().toEqualTypeOf<[string, string]>();
  });
});
