import { HTTP_STATUS } from "@keeper.sh/constants";
import type {
  PushClaim,
  PushHttpRequest,
  PushParseResult,
  StoredPushChannel,
} from "@keeper.sh/calendar";
import { ErrorResponse } from "@/utils/responses";

const PUSH_VALIDATION_TOKEN_MAX = 2048;
const PUSH_BODY_MAX_BYTES = 262_144;
const PUSH_UNKNOWN_CHANNEL_TTL_SECONDS = 30;
const PUSH_CHANNEL_KEY_MAX = 256;
const PAYLOAD_TOO_LARGE_STATUS = 413;
const ACCEPTED_STATUS = 202;

type PushRejectReason =
  | "admission_throttled"
  | "bad_channel_shape"
  | "body_too_large"
  | "malformed_body"
  | "resource_mismatch"
  | "secret_mismatch"
  | "unavailable"
  | "unknown_channel";

interface PushWebhookRouteContext {
  request: Request;
}

interface PushWebhookDependencies {
  claimDelivery: (deliveryKey: string) => Promise<boolean>;
  claimPushAdmission: (
    input: { channelKey: string | null; provider: string },
  ) => Promise<boolean>;
  findChannel: (provider: string, channelKey: string) => Promise<StoredPushChannel | null>;
  isUnknownChannelCached: (provider: string, channelKey: string) => Promise<boolean>;
  markChannelRemoved?: (channelId: string) => Promise<void>;
  markPendingIngest: (calendarIds: string[]) => Promise<void>;
  markReauthorizeRequested?: (channelId: string) => Promise<void>;
  observe: (fields: Record<string, unknown>) => void;
  recordError?: (error: unknown, slug: string) => void;
  recordNotificationReceived: (channelId: string) => void;
  recordVerified: (channelId: string) => Promise<void>;
  rememberUnknownChannel: (
    provider: string,
    channelKey: string,
    ttlSeconds: number,
  ) => Promise<void>;
  resolveAffectedCalendarIds: (channel: StoredPushChannel) => Promise<string[]>;
  verifySecret: (presented: string, storedHash: string) => boolean;
  webhookPublicUrl: string | null;
}

interface PushWebhookOptions {
  acceptedStatus: number;
  enforceResourceId: boolean;
  parse: (request: PushHttpRequest) => PushParseResult;
  provider: string;
  readValidationToken?: (url: URL) => string | null;
}

const handshakeResponse = (token: string): Response =>
  new Response(token, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
    status: HTTP_STATUS.OK,
  });

const readBody = (rawBody: string): unknown => {
  if (rawBody.length === 0) {
    return null;
  }
  try {
    return JSON.parse(rawBody);
  } catch {
    return rawBody;
  }
};

const exceedsDeclaredBodyLimit = (request: Request): boolean => {
  const declared = request.headers.get("content-length");
  if (declared === null) {
    return false;
  }
  const length = Number(declared);
  return Number.isFinite(length) && length > PUSH_BODY_MAX_BYTES;
};

const hasBoundedChannelKey = (channelKey: string): boolean =>
  channelKey.length > 0 && channelKey.length <= PUSH_CHANNEL_KEY_MAX;

const hasUsableChannelKey = (claim: PushClaim): boolean =>
  hasBoundedChannelKey(claim.channelKey) && claim.presentedSecret.length > 0;

const resolveAdmissionChannelKey = (claim: PushClaim | undefined): string | null => {
  if (!claim || !hasBoundedChannelKey(claim.channelKey)) {
    return null;
  }
  return claim.channelKey;
};

interface ChannelLookup {
  channel: StoredPushChannel | null;
  negativeCacheHit: boolean;
  rejectReason: PushRejectReason | null;
}

const lookupChannel = async (
  channelKey: string,
  dependencies: PushWebhookDependencies,
  options: PushWebhookOptions,
): Promise<ChannelLookup> => {
  if (await dependencies.isUnknownChannelCached(options.provider, channelKey)) {
    return { channel: null, negativeCacheHit: true, rejectReason: "unknown_channel" };
  }

  const channel = await dependencies.findChannel(options.provider, channelKey);
  if (!channel) {
    await dependencies.rememberUnknownChannel(
      options.provider,
      channelKey,
      PUSH_UNKNOWN_CHANNEL_TTL_SECONDS,
    );
    return { channel: null, negativeCacheHit: false, rejectReason: "unknown_channel" };
  }

  return { channel, negativeCacheHit: false, rejectReason: null };
};

interface ClaimContext {
  lookupChannel: (channelKey: string) => Promise<ChannelLookup>;
  recordNotificationReceived: (channelId: string) => void;
  recordVerified: (channelId: string) => Promise<void>;
  resolveCalendarIds: (channel: StoredPushChannel) => Promise<string[]>;
}

const createClaimContext = (
  dependencies: PushWebhookDependencies,
  options: PushWebhookOptions,
): ClaimContext => {
  const lookups = new Map<string, Promise<ChannelLookup>>();
  const calendarIds = new Map<string, Promise<string[]>>();
  const verifications = new Map<string, Promise<void>>();
  const liveness = new Set<string>();

  return {
    lookupChannel: (channelKey) => {
      const cached = lookups.get(channelKey);
      if (cached) {
        return cached;
      }
      const pending = lookupChannel(channelKey, dependencies, options);
      lookups.set(channelKey, pending);
      return pending;
    },
    recordNotificationReceived: (channelId) => {
      if (liveness.has(channelId)) {
        return;
      }
      liveness.add(channelId);
      dependencies.recordNotificationReceived(channelId);
    },
    recordVerified: (channelId) => {
      const cached = verifications.get(channelId);
      if (cached) {
        return cached;
      }
      const pending = dependencies.recordVerified(channelId);
      verifications.set(channelId, pending);
      return pending;
    },
    resolveCalendarIds: (channel) => {
      const cached = calendarIds.get(channel.id);
      if (cached) {
        return cached;
      }
      const pending = dependencies.resolveAffectedCalendarIds(channel);
      calendarIds.set(channel.id, pending);
      return pending;
    },
  };
};

const resolveClaimChannel = async (
  claim: PushClaim,
  dependencies: PushWebhookDependencies,
  options: PushWebhookOptions,
  claimContext: ClaimContext,
): Promise<ChannelLookup> => {
  if (!hasUsableChannelKey(claim)) {
    return { channel: null, negativeCacheHit: false, rejectReason: "bad_channel_shape" };
  }

  const lookup = await claimContext.lookupChannel(claim.channelKey);
  const { channel } = lookup;
  if (!channel) {
    return lookup;
  }

  if (!dependencies.verifySecret(claim.presentedSecret, channel.secretHash)) {
    return { channel: null, negativeCacheHit: false, rejectReason: "secret_mismatch" };
  }

  if (
    options.enforceResourceId
    && channel.providerResourceId !== null
    && claim.presentedResourceId !== channel.providerResourceId
  ) {
    return { channel: null, negativeCacheHit: false, rejectReason: "resource_mismatch" };
  }

  return { channel, negativeCacheHit: false, rejectReason: null };
};

const applyLifecycleClaim = async (
  claim: PushClaim,
  channel: StoredPushChannel,
  dependencies: PushWebhookDependencies,
  claimContext: ClaimContext,
): Promise<string[]> => {
  if (claim.lifecycleEvent === "reauthorizationRequired") {
    await dependencies.markReauthorizeRequested?.(channel.id);
    return [];
  }

  if (claim.lifecycleEvent === "subscriptionRemoved") {
    await dependencies.markChannelRemoved?.(channel.id);
    return claimContext.resolveCalendarIds(channel);
  }

  if (claim.lifecycleEvent === "missed") {
    return claimContext.resolveCalendarIds(channel);
  }

  return [];
};

const resolveClaimCalendarIds = (
  claim: PushClaim,
  channel: StoredPushChannel,
  dependencies: PushWebhookDependencies,
  claimContext: ClaimContext,
): Promise<string[]> => {
  if (claim.kind === "lifecycle") {
    return applyLifecycleClaim(claim, channel, dependencies, claimContext);
  }
  return claimContext.resolveCalendarIds(channel);
};

interface ClaimOutcome {
  calendarIds: string[];
  duplicate: boolean;
  negativeCacheHit: boolean;
  rejectReason: PushRejectReason | null;
}

const processClaim = async (
  claim: PushClaim,
  dependencies: PushWebhookDependencies,
  options: PushWebhookOptions,
  claimContext: ClaimContext,
): Promise<ClaimOutcome> => {
  const resolution = await resolveClaimChannel(claim, dependencies, options, claimContext);
  const { channel } = resolution;

  if (!channel) {
    return {
      calendarIds: [],
      duplicate: false,
      negativeCacheHit: resolution.negativeCacheHit,
      rejectReason: resolution.rejectReason,
    };
  }

  dependencies.observe({
    "calendar.id": channel.calendarId,
    "user.id": channel.userId,
    "webhook.channel_id": channel.id,
    "webhook.channel_state": channel.state,
  });

  if (claim.deliveryId !== null) {
    const claimed = await dependencies.claimDelivery(
      `${options.provider}:${claim.channelKey}:${claim.deliveryId}`,
    );
    if (!claimed) {
      return {
        calendarIds: [],
        duplicate: true,
        negativeCacheHit: false,
        rejectReason: null,
      };
    }
  }

  claimContext.recordNotificationReceived(channel.id);

  if (claim.kind === "sync" || channel.verifiedAt === null) {
    await claimContext.recordVerified(channel.id);
  }

  if (claim.kind === "sync") {
    return {
      calendarIds: [],
      duplicate: false,
      negativeCacheHit: false,
      rejectReason: null,
    };
  }

  return {
    calendarIds: await resolveClaimCalendarIds(claim, channel, dependencies, claimContext),
    duplicate: false,
    negativeCacheHit: false,
    rejectReason: null,
  };
};

interface BoundedBody {
  bytes: number;
  raw: string;
  withinLimit: boolean;
}

const readBoundedBody = async (request: Request): Promise<BoundedBody> => {
  const stream = request.body;
  if (!stream) {
    return { bytes: 0, raw: "", withinLimit: true };
  }

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    bytes += value.byteLength;
    if (bytes > PUSH_BODY_MAX_BYTES) {
      await reader.cancel();
      return { bytes, raw: "", withinLimit: false };
    }
    chunks.push(value);
  }

  return { bytes, raw: Buffer.concat(chunks).toString("utf8"), withinLimit: true };
};

const parseBody = (
  request: Request,
  body: BoundedBody,
  options: PushWebhookOptions,
): PushParseResult => options.parse({
  body: readBody(body.raw),
  headers: request.headers,
  url: new URL(request.url),
});

const resolveHandshakeResponse = (
  context: PushWebhookRouteContext,
  dependencies: PushWebhookDependencies,
  options: PushWebhookOptions,
): Response | null => {
  if (!options.readValidationToken) {
    return null;
  }

  const validationToken = options.readValidationToken(new URL(context.request.url));
  if (validationToken === null) {
    return null;
  }

  dependencies.observe({ "webhook.event_type": "handshake" });
  if (validationToken.length > PUSH_VALIDATION_TOKEN_MAX) {
    return ErrorResponse.badRequest().toResponse();
  }
  return handshakeResponse(validationToken);
};

const readAdmittedBody = async (
  context: PushWebhookRouteContext,
  dependencies: PushWebhookDependencies,
  options: PushWebhookOptions,
): Promise<{ body: BoundedBody } | { response: Response }> => {
  if (exceedsDeclaredBodyLimit(context.request)) {
    dependencies.observe({ "webhook.reject_reason": "body_too_large" });
    return { response: new Response(null, { status: PAYLOAD_TOO_LARGE_STATUS }) };
  }

  const admitted = await dependencies.claimPushAdmission({
    channelKey: null,
    provider: options.provider,
  });
  if (!admitted) {
    dependencies.observe({ "webhook.reject_reason": "admission_throttled" });
    return { response: new Response(null, { status: HTTP_STATUS.SERVICE_UNAVAILABLE }) };
  }

  const body = await readBoundedBody(context.request);
  dependencies.observe({ "webhook.body_bytes": body.bytes });
  if (!body.withinLimit) {
    dependencies.observe({ "webhook.reject_reason": "body_too_large" });
    return { response: new Response(null, { status: PAYLOAD_TOO_LARGE_STATUS }) };
  }

  return { body };
};

const processClaims = async (
  claims: PushClaim[],
  dependencies: PushWebhookDependencies,
  options: PushWebhookOptions,
): Promise<number> => {
  const claimContext = createClaimContext(dependencies, options);
  const pendingCalendarIds = new Set<string>();
  let rejectedCount = 0;
  let duplicateCount = 0;
  let negativeCacheHit = false;
  let lastRejectReason: PushRejectReason | null = null;

  for (const claim of claims) {
    const outcome = await processClaim(claim, dependencies, options, claimContext);
    for (const calendarId of outcome.calendarIds) {
      pendingCalendarIds.add(calendarId);
    }
    negativeCacheHit = negativeCacheHit || outcome.negativeCacheHit;
    if (outcome.duplicate) {
      duplicateCount += 1;
    }
    if (outcome.rejectReason) {
      rejectedCount += 1;
      lastRejectReason = outcome.rejectReason;
    }
    if (claim.lifecycleEvent) {
      dependencies.observe({ "webhook.lifecycle_event": claim.lifecycleEvent });
    }
  }

  if (pendingCalendarIds.size > 0) {
    await dependencies.markPendingIngest([...pendingCalendarIds]);
  }

  dependencies.observe({
    "webhook.calendars_marked": pendingCalendarIds.size,
    "webhook.duplicate": duplicateCount > 0,
    "webhook.negative_cache_hit": negativeCacheHit,
    "webhook.rejected_count": rejectedCount,
    ...(lastRejectReason !== null && { "webhook.reject_reason": lastRejectReason }),
  });

  return rejectedCount;
};

const runPushWebhook = async (
  context: PushWebhookRouteContext,
  dependencies: PushWebhookDependencies,
  options: PushWebhookOptions,
): Promise<Response> => {
  dependencies.observe({
    "operation.type": "webhook",
    "webhook.provider": options.provider,
  });

  const handshake = resolveHandshakeResponse(context, dependencies, options);
  if (handshake) {
    return handshake;
  }

  if (!dependencies.webhookPublicUrl) {
    return ErrorResponse.notImplemented().toResponse();
  }

  const admission = await readAdmittedBody(context, dependencies, options);
  if ("response" in admission) {
    return admission.response;
  }

  const result = parseBody(context.request, admission.body, options);

  if (!result.ok) {
    dependencies.observe({ "webhook.reject_reason": "malformed_body" });
    return ErrorResponse.badRequest().toResponse();
  }
  if (result.kind === "validation") {
    return handshakeResponse(result.token);
  }

  const { claims } = result;
  const [firstClaim] = claims;
  dependencies.observe({
    "webhook.event_type": firstClaim?.kind ?? "empty",
    "webhook.notification_count": claims.length,
  });

  const admissionChannelKey = resolveAdmissionChannelKey(firstClaim);
  if (admissionChannelKey !== null) {
    const admitted = await dependencies.claimPushAdmission({
      channelKey: admissionChannelKey,
      provider: options.provider,
    });
    if (!admitted) {
      dependencies.observe({ "webhook.reject_reason": "admission_throttled" });
      return new Response(null, { status: HTTP_STATUS.SERVICE_UNAVAILABLE });
    }
  }

  const rejectedCount = await processClaims(claims, dependencies, options);

  if (claims.length > 0 && rejectedCount === claims.length) {
    return ErrorResponse.unauthorized().toResponse();
  }

  return new Response(null, { status: options.acceptedStatus });
};

const handlePushWebhook = async (
  context: PushWebhookRouteContext,
  dependencies: PushWebhookDependencies,
  options: PushWebhookOptions,
): Promise<Response> => {
  try {
    return await runPushWebhook(context, dependencies, options);
  } catch (error) {
    dependencies.recordError?.(error, "webhook-delivery-failed");
    dependencies.observe({ "webhook.reject_reason": "unavailable" });
    return new Response(null, { status: HTTP_STATUS.SERVICE_UNAVAILABLE });
  }
};

export {
  ACCEPTED_STATUS,
  handlePushWebhook,
  PUSH_BODY_MAX_BYTES,
  PUSH_UNKNOWN_CHANNEL_TTL_SECONDS,
  PUSH_VALIDATION_TOKEN_MAX,
};
export type {
  PushRejectReason,
  PushWebhookDependencies,
  PushWebhookOptions,
  PushWebhookRouteContext,
};
