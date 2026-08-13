import { MICROSOFT_GRAPH_API } from "../shared/api";
import {
  clampToProviderLifetime,
  GRAPH_SUBSCRIPTION_MAX_LIFETIME_MS,
} from "../../../core/source/push-provider-profile";
import type {
  ListedPushChannel,
  PushChannelRegistration,
  PushChannelScope,
  RegistrarContext,
  StoredPushChannel,
} from "../../../core/source/push-channel";

const GRAPH_CHANGE_TYPES = "created,updated,deleted";
const CONFLICT_STATUS = 409;
const NOT_FOUND_STATUS = 404;
const GONE_STATUS = 410;
const SUBSCRIPTIONS_URL = `${MICROSOFT_GRAPH_API}/subscriptions`;
const CHANNEL_GONE_STATUSES = new Set([GONE_STATUS, NOT_FOUND_STATUS]);

class GraphSubscriptionError extends Error {
  readonly channelGone: boolean;
  readonly duplicate: boolean;
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "GraphSubscriptionError";
    this.channelGone = CHANNEL_GONE_STATUSES.has(status);
    this.duplicate = status === CONFLICT_STATUS;
    this.status = status;
  }
}

interface GraphSubscriptionResponse {
  expirationDateTime?: string;
  id?: string;
  notificationUrl?: string;
  resource?: string;
}

const buildCalendarResourcePath = (
  providerAccountId: string,
  externalCalendarId: string,
): string => `/users/${providerAccountId}/calendars/${externalCalendarId}/events`;

const buildExpirationDateTime = (registrarContext: RegistrarContext): string =>
  clampToProviderLifetime(
    registrarContext.requestedExpiresAt,
    registrarContext.now,
    GRAPH_SUBSCRIPTION_MAX_LIFETIME_MS,
  ).toISOString();

const readSubscriptionResponse = async (
  response: Response,
  operation: string,
): Promise<GraphSubscriptionResponse> => {
  if (!response.ok) {
    throw new GraphSubscriptionError(
      `Microsoft Graph ${operation} failed with status ${response.status}`,
      response.status,
    );
  }
  return await response.json() as GraphSubscriptionResponse;
};

const toRegistration = (
  payload: GraphSubscriptionResponse,
  fallbackResourcePath: string,
): PushChannelRegistration => {
  if (!payload.id) {
    throw new GraphSubscriptionError("Graph subscription response carried no id", 0);
  }
  if (!payload.expirationDateTime) {
    throw new GraphSubscriptionError("Graph subscription response carried no expiry", 0);
  }

  const expiresAt = new Date(payload.expirationDateTime);
  if (Number.isNaN(expiresAt.getTime())) {
    throw new GraphSubscriptionError(
      `Graph subscription response carried an unparseable expiry: ${payload.expirationDateTime}`,
      0,
    );
  }

  return {
    expiresAt,
    providerChannelId: payload.id,
    providerResourceId: null,
    resourcePath: payload.resource ?? fallbackResourcePath,
  };
};

const graphHeaders = (registrarContext: RegistrarContext): Record<string, string> => ({
  authorization: `Bearer ${registrarContext.accessToken}`,
  "content-type": "application/json",
});

const registerOutlookSubscription = async (
  scope: PushChannelScope,
  secret: string,
  registrarContext: RegistrarContext,
): Promise<PushChannelRegistration> => {
  if (scope.kind !== "calendar") {
    throw new GraphSubscriptionError(
      `Outlook push registration requires a calendar scope, received ${scope.kind}`,
      0,
    );
  }

  const resourcePath = buildCalendarResourcePath(
    scope.providerAccountId,
    scope.externalCalendarId,
  );

  await registrarContext.rateLimiter?.acquire();

  const response = await registrarContext.fetchImpl(SUBSCRIPTIONS_URL, {
    body: JSON.stringify({
      changeType: GRAPH_CHANGE_TYPES,
      clientState: secret,
      expirationDateTime: buildExpirationDateTime(registrarContext),
      lifecycleNotificationUrl: registrarContext.notificationUrl,
      notificationUrl: registrarContext.notificationUrl,
      resource: resourcePath,
    }),
    headers: graphHeaders(registrarContext),
    method: "POST",
    signal: registrarContext.signal,
  });

  return toRegistration(
    await readSubscriptionResponse(response, "subscription create"),
    resourcePath,
  );
};

const renewOutlookSubscription = async (
  channel: StoredPushChannel,
  _secret: string | null,
  registrarContext: RegistrarContext,
): Promise<PushChannelRegistration> => {
  if (!channel.providerChannelId) {
    throw new GraphSubscriptionError(
      "Outlook push renewal requires the recorded subscription id",
      0,
    );
  }

  await registrarContext.rateLimiter?.acquire();

  const response = await registrarContext.fetchImpl(
    `${SUBSCRIPTIONS_URL}/${channel.providerChannelId}`,
    {
      body: JSON.stringify({ expirationDateTime: buildExpirationDateTime(registrarContext) }),
      headers: graphHeaders(registrarContext),
      method: "PATCH",
      signal: registrarContext.signal,
    },
  );

  return toRegistration(
    await readSubscriptionResponse(response, "subscription renew"),
    channel.resourcePath ?? "",
  );
};

const deregisterOutlookSubscription = async (
  channel: StoredPushChannel,
  registrarContext: RegistrarContext,
): Promise<void> => {
  if (!channel.providerChannelId) {
    throw new GraphSubscriptionError(
      "Outlook push deregistration requires the recorded subscription id",
      0,
    );
  }

  await registrarContext.rateLimiter?.acquire();

  const response = await registrarContext.fetchImpl(
    `${SUBSCRIPTIONS_URL}/${channel.providerChannelId}`,
    {
      headers: graphHeaders(registrarContext),
      method: "DELETE",
      signal: registrarContext.signal,
    },
  );

  if (!response.ok && response.status !== NOT_FOUND_STATUS) {
    throw new GraphSubscriptionError(
      `Microsoft Graph subscription delete failed with status ${response.status}`,
      response.status,
    );
  }
};

const listOutlookSubscriptions = async (
  _accountId: string,
  registrarContext: RegistrarContext,
): Promise<ListedPushChannel[]> => {
  await registrarContext.rateLimiter?.acquire();

  const response = await registrarContext.fetchImpl(SUBSCRIPTIONS_URL, {
    headers: graphHeaders(registrarContext),
    method: "GET",
    signal: registrarContext.signal,
  });

  if (!response.ok) {
    throw new GraphSubscriptionError(
      `Microsoft Graph subscription list failed with status ${response.status}`,
      response.status,
    );
  }

  const payload = await response.json() as { value?: GraphSubscriptionResponse[] };
  return (payload.value ?? []).map((subscription) => ({
    ...toRegistration(subscription, subscription.resource ?? ""),
    notificationUrl: subscription.notificationUrl ?? "",
  }));
};

export {
  buildCalendarResourcePath,
  deregisterOutlookSubscription,
  GraphSubscriptionError,
  listOutlookSubscriptions,
  registerOutlookSubscription,
  renewOutlookSubscription,
};
