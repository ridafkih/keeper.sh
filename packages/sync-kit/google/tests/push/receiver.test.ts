import { describe, expect, test } from "vitest";
import { decodePushSignal } from "../../src/push/receiver";
import type { KnownChannel } from "../../src/push/receiver";

const hash = (input: string): string => `hashed:${input}`;

const registered: KnownChannel = {
  channelId: "channel-1",
  resourceId: "resource-1",
  tokenHash: hash("the-real-token"),
};

const lookup = (channelId: string): KnownChannel | null => {
  if (channelId !== registered.channelId) {
    return null;
  }
  return registered;
};

const delivered = (entries: Readonly<Record<string, string>>) =>
  decodePushSignal({ headers: new Headers(entries), lookup, hash });

const authenticHeaders = (state: string): Readonly<Record<string, string>> => ({
  "X-Goog-Channel-ID": "channel-1",
  "X-Goog-Resource-ID": "resource-1",
  "X-Goog-Resource-State": state,
  "X-Goog-Channel-Token": "the-real-token",
});

describe("a push notification is decoded totally, never trusted", () => {
  test("GOOG-P1: the first delivery is a handshake and never triggers an ingest", () => {
    expect(delivered({ ...authenticHeaders("sync"), "X-Goog-Message-Number": "1" })).toEqual({
      kind: "handshake",
    });
  });

  test("GOOG-P1: an exists notification names the channel and the resource", () => {
    expect(delivered({ ...authenticHeaders("exists"), "X-Goog-Message-Number": "2" })).toEqual({
      kind: "changed",
      channelId: "channel-1",
      resourceId: "resource-1",
    });
  });

  test("GOOG-P1: headers from the open internet decode rather than throw", () => {
    expect(delivered({})).toEqual({ kind: "unrecognised", reason: "missingHeaders" });
    expect(delivered(authenticHeaders("somethingGoogleNeverSent"))).toEqual({
      kind: "unrecognised",
      reason: "unknownState",
    });
  });

  test("GOOG-P1: a notification carries no events, so it can never be coverage", () => {
    expect(Object.keys(delivered(authenticHeaders("exists")))).toEqual([
      "kind",
      "channelId",
      "resourceId",
    ]);
  });

  test("GOOG-P1: a changed signal is unconstructible without a token the channel recognises", () => {
    expect(
      delivered({ ...authenticHeaders("exists"), "X-Goog-Channel-Token": "guessed" }),
    ).toEqual({ kind: "unrecognised", reason: "badToken" });
    const { "X-Goog-Channel-Token": _omitted, ...untokened } = authenticHeaders("exists");
    expect(delivered(untokened)).toEqual({ kind: "unrecognised", reason: "badToken" });
  });

  test("GOOG-P1: a notification for a channel nobody registered is refused before its state is read", () => {
    expect(
      delivered({ ...authenticHeaders("exists"), "X-Goog-Channel-ID": "channel-nobody-owns" }),
    ).toEqual({ kind: "unrecognised", reason: "unknownChannel" });
    expect(
      delivered({ ...authenticHeaders("exists"), "X-Goog-Resource-ID": "another-resource" }),
    ).toEqual({ kind: "unrecognised", reason: "unknownChannel" });
  });
});
