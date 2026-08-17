import { describe, expect, test } from "vitest";
import { decodeGraphPush } from "../../src/push/receiver";

const hostileToken = "<script>alert('1')</script>&token=other";

describe("the validation handshake is answered verbatim and cannot be confused with a notification", () => {
  test("MS-P1: the validation token is decoded exactly once and returned verbatim for a hostile-looking token", () => {
    const signal = decodeGraphPush({
      url: `https://keeper.sh/webhook/outlook?validationToken=${encodeURIComponent(hostileToken)}`,
      method: "POST",
      body: null,
    });

    expect(signal).toEqual({ kind: "validation", token: hostileToken });
  });

  test("MS-P1: a token that is already decoded is not decoded a second time", () => {
    const doubled = encodeURIComponent(encodeURIComponent("a b+c"));

    const signal = decodeGraphPush({
      url: `https://keeper.sh/webhook/outlook?validationToken=${doubled}`,
      method: "GET",
      body: null,
    });

    expect(signal).toEqual({ kind: "validation", token: encodeURIComponent("a b+c") });
  });
});
