import { googleWatchHeadersSchema } from "@keeper.sh/data-schemas";
import type { PushClaimKind } from "../../../core/source/push-channel";
import type {
  PushClaim,
  PushHttpRequest,
  PushParseResult,
} from "../../../core/source/push-notification";

const GOOGLE_SYNC_RESOURCE_STATE = "sync";

const resolveClaimKind = (resourceState: string | null): PushClaimKind => {
  if (resourceState === GOOGLE_SYNC_RESOURCE_STATE) {
    return "sync";
  }
  return "change";
};

const parseGooglePushNotification = (request: PushHttpRequest): PushParseResult => {
  const channelId = request.headers.get("x-goog-channel-id");
  const token = request.headers.get("x-goog-channel-token");
  const messageNumber = request.headers.get("x-goog-message-number");
  const resourceId = request.headers.get("x-goog-resource-id");
  const resourceState = request.headers.get("x-goog-resource-state");

  const candidate = {
    channelId,
    token,
    ...(messageNumber !== null && { messageNumber }),
    ...(resourceId !== null && { resourceId }),
    ...(resourceState !== null && { resourceState }),
  };

  if (!googleWatchHeadersSchema.allows(candidate)) {
    if (channelId === null) {
      return { ok: false, reason: "missing_channel_id" };
    }
    return { ok: false, reason: "missing_channel_token" };
  }

  const claim: PushClaim = {
    channelKey: candidate.channelId,
    deliveryId: messageNumber,
    kind: resolveClaimKind(resourceState),
    lifecycleEvent: null,
    presentedResourceId: resourceId,
    presentedSecret: candidate.token,
  };

  return { claims: [claim], kind: "notification", ok: true };
};

export { parseGooglePushNotification };
