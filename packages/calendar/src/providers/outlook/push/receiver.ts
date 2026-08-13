import { graphNotificationCollectionSchema } from "@keeper.sh/data-schemas";
import type { GraphNotification } from "@keeper.sh/data-schemas";
import type { PushClaimKind } from "../../../core/source/push-channel";
import type {
  PushClaim,
  PushHttpRequest,
  PushParseResult,
} from "../../../core/source/push-notification";

const VALIDATION_TOKEN_PARAM = "validationToken";

const resolveClaimKind = (notification: GraphNotification): PushClaimKind => {
  if (notification.lifecycleEvent) {
    return "lifecycle";
  }
  return "change";
};

const toClaim = (notification: GraphNotification): PushClaim => ({
  channelKey: notification.subscriptionId,
  deliveryId: notification.id ?? null,
  kind: resolveClaimKind(notification),
  lifecycleEvent: notification.lifecycleEvent ?? null,
  presentedResourceId: null,
  presentedSecret: notification.clientState ?? "",
});

const readGraphValidationToken = (url: URL): string | null =>
  url.searchParams.get(VALIDATION_TOKEN_PARAM);

const parseOutlookPushNotification = (request: PushHttpRequest): PushParseResult => {
  const validationToken = readGraphValidationToken(request.url);
  if (validationToken !== null) {
    return { kind: "validation", ok: true, token: validationToken };
  }

  if (!graphNotificationCollectionSchema.allows(request.body)) {
    return { ok: false, reason: "malformed_body" };
  }

  return {
    claims: request.body.value.map((notification) => toClaim(notification)),
    kind: "notification",
    ok: true,
  };
};

export { parseOutlookPushNotification, readGraphValidationToken };
