import type { PushClaimKind } from "./push-channel";

type PushParseFailureReason =
  | "malformed_body"
  | "missing_channel_id"
  | "missing_channel_token";

interface PushClaim {
  channelKey: string;
  deliveryId: string | null;
  kind: PushClaimKind;
  lifecycleEvent: string | null;
  presentedResourceId: string | null;
  presentedSecret: string;
}

interface PushHttpRequest {
  body: unknown;
  headers: Headers;
  url: URL;
}

type PushParseResult =
  | { claims: PushClaim[]; kind: "notification"; ok: true }
  | { kind: "validation"; ok: true; token: string }
  | { ok: false; reason: PushParseFailureReason };

export type { PushClaim, PushHttpRequest, PushParseFailureReason, PushParseResult };
