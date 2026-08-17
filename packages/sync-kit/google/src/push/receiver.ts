import { verifyChannelToken } from "./secret";

const pushRejections = ["unknownChannel", "badToken", "missingHeaders", "unknownState"] as const;
type PushRejection = (typeof pushRejections)[number];

type PushSignal =
  | { readonly kind: "handshake" }
  | { readonly kind: "changed"; readonly channelId: string; readonly resourceId: string }
  | { readonly kind: "unrecognised"; readonly reason: PushRejection };

interface KnownChannel {
  readonly channelId: string;
  readonly resourceId: string;
  readonly tokenHash: string;
}

interface ReceiverInputs {
  readonly headers: Headers;
  readonly lookup: (channelId: string) => KnownChannel | null;
  readonly hash: (input: string) => string;
}

const changedStates = new Set(["exists", "not_exists", "update"]);

const namedHeader = (headers: Headers, name: string): string | null => {
  const value = headers.get(name);
  if (value === null || value.length === 0) {
    return null;
  }
  return value;
};

const rejected = (reason: PushRejection): PushSignal => ({ kind: "unrecognised", reason });

const decodePushSignal = (inputs: ReceiverInputs): PushSignal => {
  const { headers } = inputs;
  const channelId = namedHeader(headers, "X-Goog-Channel-ID");
  const resourceId = namedHeader(headers, "X-Goog-Resource-ID");
  const state = namedHeader(headers, "X-Goog-Resource-State");
  if (channelId === null || resourceId === null || state === null) {
    return rejected("missingHeaders");
  }
  const known = inputs.lookup(channelId);
  if (known === null || known.resourceId !== resourceId) {
    return rejected("unknownChannel");
  }
  const presented = namedHeader(headers, "X-Goog-Channel-Token") ?? "";
  if (!verifyChannelToken(presented, known.tokenHash, inputs.hash)) {
    return rejected("badToken");
  }
  if (state === "sync") {
    return { kind: "handshake" };
  }
  if (!changedStates.has(state)) {
    return rejected("unknownState");
  }
  return { kind: "changed", channelId, resourceId };
};

export { decodePushSignal, pushRejections };
export type { KnownChannel, PushRejection, PushSignal, ReceiverInputs };
