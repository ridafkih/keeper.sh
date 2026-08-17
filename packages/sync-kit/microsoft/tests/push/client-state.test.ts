import { describe, expect, test } from "vitest";
import { decodeGraphPush } from "../../src/push/receiver";
import { verifyClientState } from "../../src/push/secret";
import { conformanceHash } from "@keeper.sh/sync-conformance";
import { clientStateHash } from "../../src/push/secret";

const batchSpanningTwoSubscriptions = JSON.stringify({
  value: [
    { subscriptionId: "subscription-one", clientState: "good-secret", changeType: "updated" },
    { subscriptionId: "subscription-two", clientState: "bad-secret", changeType: "updated" },
    {
      subscriptionId: "subscription-three",
      clientState: "good-secret",
      lifecycleEvent: "missed",
    },
  ],
});

describe("one bad secret rejects one claim, never the batch", () => {
  test("MS-P5: one bad client state rejects its own claim and not the batch", () => {
    const stored = clientStateHash("good-secret", conformanceHash);

    const signal = decodeGraphPush({
      url: "https://keeper.sh/webhook/outlook",
      method: "POST",
      body: batchSpanningTwoSubscriptions,
    });

    if (signal.kind !== "notification") {
      throw new Error(`a batch decoded as "${signal.kind}"`);
    }
    expect(signal.claims).toHaveLength(3);
    expect(
      signal.claims.map((claim) =>
        verifyClientState(claim.presentedClientState ?? "", stored, conformanceHash),
      ),
    ).toEqual([true, false, true]);
  });

  test("MS-P5: a lifecycle entry is a claim whose secret is verified like any other", () => {
    const signal = decodeGraphPush({
      url: "https://keeper.sh/webhook/outlook",
      method: "POST",
      body: batchSpanningTwoSubscriptions,
    });

    if (signal.kind !== "notification") {
      throw new Error(`a batch decoded as "${signal.kind}"`);
    }
    expect(signal.claims.at(2)?.lifecycle).toBe("missed");
    expect(signal.claims.at(2)?.presentedClientState).toBe("good-secret");
  });
});
