import { describe, expect, test } from "vitest";
import { decodeGraphPush } from "../../src/push/receiver";

describe("a handshake is answered before anything else is consulted", () => {
  test("MS-P2: a handshake is answered without consulting any stored channel", () => {
    const signal = decodeGraphPush({
      url: "https://keeper.sh/webhook/outlook?validationToken=plain-token",
      method: "POST",
      body: JSON.stringify({ value: [{ subscriptionId: "subscription-one" }] }),
    });

    expect(signal).toEqual({ kind: "validation", token: "plain-token" });
  });

  test("MS-P2: the lifecycle url is validated by the same rule", () => {
    const signal = decodeGraphPush({
      url: "https://keeper.sh/webhook/outlook/lifecycle?validationToken=lifecycle-token",
      method: "POST",
      body: null,
    });

    expect(signal).toEqual({ kind: "validation", token: "lifecycle-token" });
  });
});
