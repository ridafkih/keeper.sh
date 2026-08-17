import { microsoftLimits } from "../limits";
import type { GraphLifecycleEvent } from "./lifecycle";
import { readLifecycleEvent } from "./lifecycle";
import type { RichHint } from "./resource-data";
import { readRichHint } from "./resource-data";

const pushRejections = [
  "oversizedBody",
  "unreadableBody",
  "unsupportedMethod",
  "noClaims",
] as const;

type PushRejection = (typeof pushRejections)[number];

interface GraphPushClaim {
  readonly subscriptionId: string;
  readonly presentedClientState: string | null;
  readonly lifecycle: GraphLifecycleEvent | null;
  readonly hint: RichHint | null;
}

type GraphPushSignal =
  | { readonly kind: "validation"; readonly token: string }
  | { readonly kind: "notification"; readonly claims: readonly GraphPushClaim[] }
  | { readonly kind: "rejected"; readonly reason: PushRejection };

interface GraphPushRequest {
  readonly url: string;
  readonly method: string;
  readonly body: string | null;
}

const notificationMethod = "POST";

const rejected = (reason: PushRejection): GraphPushSignal => ({ kind: "rejected", reason });

const readProperty = (value: unknown, name: string): unknown => {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  return Reflect.get(value, name);
};

const textAt = (value: unknown, name: string): string | null => {
  const held = readProperty(value, name);
  if (typeof held !== "string" || held.length === 0) {
    return null;
  }
  return held;
};

const validationTokenOf = (url: string): string | null => {
  try {
    const token = new URL(url).searchParams.get("validationToken");
    if (token === null || token.length === 0) {
      return null;
    }
    if (token.length > microsoftLimits.validationTokenMaxLength) {
      return null;
    }
    return token;
  } catch {
    return null;
  }
};

type ParsedBody = { readonly kind: "parsed"; readonly value: unknown } | { readonly kind: "unreadable" };

const parsedBody = (body: string): ParsedBody => {
  try {
    return { kind: "parsed", value: JSON.parse(body) };
  } catch {
    return { kind: "unreadable" };
  }
};

const claimOf = (entry: unknown): GraphPushClaim | null => {
  const subscriptionId = textAt(entry, "subscriptionId");
  if (subscriptionId === null) {
    return null;
  }
  return {
    subscriptionId,
    presentedClientState: textAt(entry, "clientState"),
    lifecycle: readLifecycleEvent(readProperty(entry, "lifecycleEvent")),
    hint: readRichHint(entry),
  };
};

const claimsOf = (body: unknown): readonly GraphPushClaim[] => {
  const held = readProperty(body, "value");
  if (!Array.isArray(held)) {
    return [];
  }
  return held.flatMap((entry) => {
    const claim = claimOf(entry);
    if (claim === null) {
      return [];
    }
    return [claim];
  });
};

const decodeGraphPush = (request: GraphPushRequest): GraphPushSignal => {
  const token = validationTokenOf(request.url);
  if (token !== null) {
    return { kind: "validation", token };
  }
  if (request.method !== notificationMethod) {
    return rejected("unsupportedMethod");
  }
  const { body } = request;
  if (body === null) {
    return rejected("unreadableBody");
  }
  if (Buffer.byteLength(body, "utf8") > microsoftLimits.pushBodyMaxBytes) {
    return rejected("oversizedBody");
  }
  const parsed = parsedBody(body);
  if (parsed.kind === "unreadable") {
    return rejected("unreadableBody");
  }
  const claims = claimsOf(parsed.value);
  if (claims.length === 0) {
    return rejected("noClaims");
  }
  return { kind: "notification", claims };
};

export { decodeGraphPush, pushRejections };
export type { GraphPushClaim, GraphPushRequest, GraphPushSignal, PushRejection };
