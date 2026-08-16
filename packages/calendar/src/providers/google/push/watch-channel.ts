import { GOOGLE_CALENDAR_API } from "../shared/api";
import {
  clampToProviderLifetime,
  GOOGLE_WATCH_MAX_LIFETIME_MS,
} from "../../../core/source/push-provider-profile";
import { neverReachedProvider } from "../../../core/source/push-channel";
import type {
  PushChannelRegistration,
  PushChannelScope,
  RegistrarContext,
  StoredPushChannel,
} from "../../../core/source/push-channel";

const MS_PER_SECOND = 1000;
const MIN_TTL_SECONDS = 60;
const NOT_FOUND_STATUS = 404;
const GONE_STATUS = 410;
const CHANNEL_GONE_STATUSES = new Set([GONE_STATUS, NOT_FOUND_STATUS]);

class GoogleWatchChannelError extends Error {
  readonly channelGone: boolean;
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "GoogleWatchChannelError";
    this.channelGone = CHANNEL_GONE_STATUSES.has(status);
    this.status = status;
  }
}

const FAILURE_REASON_LIMIT = 300;

/*
 * Google answers a refused watch with a JSON error whose reason is the only thing that
 * separates "this calendar cannot be watched" from "this request was malformed". Keeping
 * only the status turns every one of them into the same unactionable line.
 */
const readFailureReason = async (response: Response): Promise<string> => {
  const body = await response.text().catch(() => "");
  if (body.length === 0) {
    return "no response body";
  }
  return body.slice(0, FAILURE_REASON_LIMIT);
};

interface GoogleWatchResponse {
  expiration?: string;
  id?: string;
  resourceId?: string;
  resourceUri?: string;
}

const buildWatchUrl = (resourcePath: string): string =>
  `${GOOGLE_CALENDAR_API}${resourcePath.replace(/^\//u, "")}/watch`;

const buildCalendarResourcePath = (externalCalendarId: string): string =>
  `/calendars/${encodeURIComponent(externalCalendarId)}/events`;

const resolveTtlSeconds = (registrarContext: RegistrarContext): number => {
  const expiresAt = clampToProviderLifetime(
    registrarContext.requestedExpiresAt,
    registrarContext.now,
    GOOGLE_WATCH_MAX_LIFETIME_MS,
  );
  const ttlSeconds = Math.floor(
    (expiresAt.getTime() - registrarContext.now.getTime()) / MS_PER_SECOND,
  );
  return Math.max(MIN_TTL_SECONDS, ttlSeconds);
};

const readWatchResponse = async (response: Response): Promise<GoogleWatchResponse> => {
  if (!response.ok) {
    const reason = await readFailureReason(response);
    throw new GoogleWatchChannelError(
      `Google watch request failed with status ${response.status}: ${reason}`,
      response.status,
    );
  }
  return await response.json() as GoogleWatchResponse;
};

const toRegistration = (
  payload: GoogleWatchResponse,
  resourcePath: string,
): PushChannelRegistration => {
  if (!payload.id) {
    throw new GoogleWatchChannelError("Google watch response carried no channel id", 0);
  }
  if (!payload.resourceId) {
    throw new GoogleWatchChannelError("Google watch response carried no resource id", 0);
  }
  if (!payload.expiration) {
    throw new GoogleWatchChannelError("Google watch response carried no expiration", 0);
  }

  const expiration = Number(payload.expiration);
  if (!Number.isFinite(expiration)) {
    throw new GoogleWatchChannelError(
      `Google watch response carried an unparseable expiration: ${payload.expiration}`,
      0,
    );
  }

  return {
    expiresAt: new Date(expiration),
    providerChannelId: payload.id,
    providerResourceId: payload.resourceId,
    resourcePath,
  };
};

const createWatchChannel = async (
  resourcePath: string,
  secret: string,
  registrarContext: RegistrarContext,
): Promise<PushChannelRegistration> => {
  if (!registrarContext.channelId) {
    throw new GoogleWatchChannelError(
      "Google watch registration requires a client-generated channel id",
      0,
    );
  }

  await registrarContext.rateLimiter?.acquire();

  const response = await registrarContext.fetchImpl(buildWatchUrl(resourcePath), {
    body: JSON.stringify({
      address: registrarContext.notificationUrl,
      id: registrarContext.channelId,
      params: { ttl: String(resolveTtlSeconds(registrarContext)) },
      token: secret,
      type: "web_hook",
    }),
    headers: {
      authorization: `Bearer ${registrarContext.accessToken}`,
      "content-type": "application/json",
    },
    method: "POST",
    signal: registrarContext.signal,
  });

  return toRegistration(await readWatchResponse(response), resourcePath);
};

const registerGoogleWatchChannel = (
  scope: PushChannelScope,
  secret: string,
  registrarContext: RegistrarContext,
): Promise<PushChannelRegistration> => {
  if (scope.kind !== "calendar") {
    return Promise.reject(new GoogleWatchChannelError(
      `Google push registration requires a calendar scope, received ${scope.kind}`,
      0,
    ));
  }

  return createWatchChannel(
    buildCalendarResourcePath(scope.externalCalendarId),
    secret,
    registrarContext,
  );
};

const renewGoogleWatchChannel = (
  channel: StoredPushChannel,
  secret: string | null,
  registrarContext: RegistrarContext,
): Promise<PushChannelRegistration> => {
  if (secret === null) {
    return Promise.reject(new GoogleWatchChannelError(
      "Google push renewal recreates the channel and requires a fresh secret",
      0,
    ));
  }
  if (!channel.resourcePath) {
    return Promise.reject(new GoogleWatchChannelError(
      "Google push renewal requires the recorded resource path",
      0,
    ));
  }

  return createWatchChannel(channel.resourcePath, secret, registrarContext);
};

const stopGoogleWatchChannel = async (
  channel: StoredPushChannel,
  registrarContext: RegistrarContext,
): Promise<void> => {
  if (!channel.providerChannelId || !channel.providerResourceId) {
    if (neverReachedProvider(channel)) {
      return;
    }
    throw new GoogleWatchChannelError(
      "Google push deregistration requires both a channel id and a resource id",
      0,
    );
  }

  await registrarContext.rateLimiter?.acquire();

  const response = await registrarContext.fetchImpl(`${GOOGLE_CALENDAR_API}channels/stop`, {
    body: JSON.stringify({
      id: channel.providerChannelId,
      resourceId: channel.providerResourceId,
    }),
    headers: {
      authorization: `Bearer ${registrarContext.accessToken}`,
      "content-type": "application/json",
    },
    method: "POST",
    signal: registrarContext.signal,
  });

  if (!response.ok && !CHANNEL_GONE_STATUSES.has(response.status)) {
    throw new GoogleWatchChannelError(
      `Google channel stop failed with status ${response.status}`,
      response.status,
    );
  }
};

export {
  buildCalendarResourcePath,
  GoogleWatchChannelError,
  registerGoogleWatchChannel,
  renewGoogleWatchChannel,
  stopGoogleWatchChannel,
};
