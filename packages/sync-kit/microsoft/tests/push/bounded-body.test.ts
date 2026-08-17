import { describe, expect, test } from "vitest";
import { decodeGraphPush } from "../../src/push/receiver";
import { microsoftLimits } from "../../src/limits";

const oversizedBody = (): string =>
  JSON.stringify({ value: [{ subscriptionId: "x".repeat(microsoftLimits.pushBodyMaxBytes) }] });

describe("a hostile payload is refused before it is parsed", () => {
  test("MS-L22: an oversized notification body is refused before parsing", () => {
    const signal = decodeGraphPush({
      url: "https://keeper.sh/webhook/outlook",
      method: "POST",
      body: oversizedBody(),
    });

    expect(signal).toEqual({ kind: "rejected", reason: "oversizedBody" });
  });

  test("MS-L22: a body that is not JSON at all is rejected, never thrown out of", () => {
    expect(
      decodeGraphPush({
        url: "https://keeper.sh/webhook/outlook",
        method: "POST",
        body: "not json at all",
      }),
    ).toEqual({ kind: "rejected", reason: "unreadableBody" });
  });

  test("MS-L22: a GET with no validation token is not a notification", () => {
    expect(
      decodeGraphPush({ url: "https://keeper.sh/webhook/outlook", method: "GET", body: null }),
    ).toEqual({ kind: "rejected", reason: "unsupportedMethod" });
  });
});
