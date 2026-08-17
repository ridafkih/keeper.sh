import type { CalendarId } from "@keeper.sh/sync-protocol";
import { describe, expectTypeOf, test } from "vitest";
import type { SubscriptionScope } from "../../src/push/subscription";

describe("a subscription against /me is unspellable", () => {
  test("MS-P16: a subscription scope without a provider account id does not typecheck", () => {
    expectTypeOf<{
      readonly kind: "subscriptionScope";
      readonly calendar: CalendarId;
    }>().not.toMatchTypeOf<SubscriptionScope>();

    expectTypeOf<SubscriptionScope>().toHaveProperty("account");
    expectTypeOf<SubscriptionScope["account"]>().toEqualTypeOf<{
      readonly kind: "providerAccountId";
      readonly value: string;
    }>();
  });
});
