import { pushChannelStateSchema } from "@keeper.sh/data-schemas";
import { getDeterministicRefreshOffset } from "../oauth/sync-window";
import {
  resolvePushProviderProfile,
  resolveRenewalLeadMs,
  resolveStaggerPeriodMs,
  type PushChannelRenewalMode,
} from "./push-provider-profile";

const FULL_POLL_INTERVAL_MS = 60_000;
const PUSH_HEALTHY_POLL_FLOOR_MS = 300_000;
const PUSH_NOTIFICATION_FRESHNESS_MS = 24 * 60 * 60 * 1000;
const STALE_REGISTERING_MS = 10 * 60 * 1000;
const PULL_CAPABILITY = "pull";

type PushChannelState = "active" | "degraded" | "failed" | "registering" | "removed";
type PushChannelActionType = "deregister" | "register" | "renew";
type PushClaimKind = "change" | "lifecycle" | "sync";

const LIVE_PUSH_CHANNEL_STATES = new Set<PushChannelState>([
  "active",
  "degraded",
  "registering",
]);

interface StoredPushChannel {
  accountId: string;
  calendarId: string | null;
  createdAt: Date;
  expiresAt: Date | null;
  failureCount: number;
  id: string;
  lastFailureAt: Date | null;
  lastNotificationAt: Date | null;
  nextAttemptAt: Date | null;
  provider: string;
  providerChannelId: string | null;
  providerResourceId: string | null;
  reauthorizeRequestedAt: Date | null;
  resourcePath: string | null;
  secretHash: string;
  state: PushChannelState;
  updatedAt: Date;
  userId: string;
  verifiedAt: Date | null;
}

interface EligibleSourceCalendar {
  accountId: string;
  calendarId: string;
  capabilities: string[];
  disabled: boolean;
  externalCalendarId: string | null;
  needsReauthentication: boolean;
  provider: string;
  providerAccountId: string | null;
  userId: string;
}

type PushChannelScope =
  | {
    accountId: string;
    calendarId: string;
    externalCalendarId: string;
    kind: "calendar";
    providerAccountId: string;
    userId: string;
  }
  | {
    accountId: string;
    kind: "account";
    providerAccountId: string;
    userId: string;
  }
  | {
    accountId: string;
    calendarId: string | null;
    kind: "channel";
    userId: string;
  };

interface PushChannelRegistration {
  expiresAt: Date;
  providerChannelId: string;
  providerResourceId: string | null;
  resourcePath: string;
}

interface ListedPushChannel extends PushChannelRegistration {
  notificationUrl: string;
}

interface PushRateLimiter {
  acquire: () => Promise<void>;
}

interface RegistrarContext {
  accessToken: string;
  channelId: string | null;
  fetchImpl: typeof fetch;
  notificationUrl: string;
  now: Date;
  rateLimiter?: PushRateLimiter;
  requestedExpiresAt: Date;
  signal?: AbortSignal;
}

interface AccountCalendarRow {
  capabilities: string[];
  disabled: boolean;
  id: string;
}

interface AffectedCalendarDependencies {
  listAccountCalendars: (accountId: string) => Promise<AccountCalendarRow[]>;
}

interface SourcePushRegistrar {
  deregister: (channel: StoredPushChannel, registrarContext: RegistrarContext) => Promise<void>;
  list?: (accountId: string, registrarContext: RegistrarContext) => Promise<ListedPushChannel[]>;
  readonly maxLifetimeMs: number;
  readonly provider: string;
  register: (
    scope: PushChannelScope,
    secret: string,
    registrarContext: RegistrarContext,
  ) => Promise<PushChannelRegistration>;
  renew: (
    channel: StoredPushChannel,
    secret: string | null,
    registrarContext: RegistrarContext,
  ) => Promise<PushChannelRegistration>;
  readonly renewalMode: PushChannelRenewalMode;
  resolveAffectedCalendarIds: (
    channel: StoredPushChannel,
    dependencies: AffectedCalendarDependencies,
  ) => Promise<string[]>;
  readonly scopeKind: PushChannelScope["kind"];
  readonly supportsList: boolean;
}

interface PushChannelAction {
  channel: StoredPushChannel | null;
  previousProviderChannelId: string | null;
  previousProviderResourceId: string | null;
  provider: string;
  renewalMode: PushChannelRenewalMode | null;
  requestedExpiresAt: Date;
  scope: PushChannelScope;
  type: PushChannelActionType;
}

interface PushChannelHealth {
  healthy: boolean;
  reason: string | null;
}

interface PlanPushChannelActionsInput {
  calendars: EligibleSourceCalendar[];
  channels: StoredPushChannel[];
  now: Date;
  onFreeCalendarSkipped?: (calendar: EligibleSourceCalendar) => void;
  onPlanError: (userId: string, error: unknown) => void;
  resolvePlan: (userId: string) => Promise<"free" | "pro">;
  webhookPublicUrl: string | null;
}

interface IngestPollFloorInput {
  channel: StoredPushChannel | null;
  needsReauthentication: boolean;
  now: Date;
  plan: "free" | "pro";
}

const toPushChannelState = (state: string): PushChannelState =>
  pushChannelStateSchema.assert(state);

const isPullCalendar = (calendar: EligibleSourceCalendar): boolean =>
  !calendar.disabled && calendar.capabilities.includes(PULL_CAPABILITY);

const resolvePushChannelHealth = (
  channel: StoredPushChannel,
  now: Date,
): PushChannelHealth => {
  const profile = resolvePushProviderProfile(channel.provider);
  if (!profile) {
    return { healthy: false, reason: "provider_unsupported" };
  }
  if (channel.state !== "active") {
    return { healthy: false, reason: "channel_not_active" };
  }
  if (channel.expiresAt === null) {
    return { healthy: false, reason: "expiry_unknown" };
  }
  if (
    channel.expiresAt.getTime() - now.getTime()
    < resolveRenewalLeadMs(profile.maxLifetimeMs)
  ) {
    return { healthy: false, reason: "expiry_imminent" };
  }
  if (channel.verifiedAt === null) {
    return { healthy: false, reason: "never_delivered" };
  }
  if (
    channel.lastNotificationAt === null
    || now.getTime() - channel.lastNotificationAt.getTime() > PUSH_NOTIFICATION_FRESHNESS_MS
  ) {
    return { healthy: false, reason: "delivery_stale" };
  }
  return { healthy: true, reason: null };
};

const resolveIngestPollFloorMs = (input: IngestPollFloorInput): number => {
  if (input.plan !== "pro" || input.needsReauthentication || input.channel === null) {
    return FULL_POLL_INTERVAL_MS;
  }
  if (input.channel.provider !== "google") {
    return FULL_POLL_INTERVAL_MS;
  }
  if (!resolvePushChannelHealth(input.channel, input.now).healthy) {
    return FULL_POLL_INTERVAL_MS;
  }
  return PUSH_HEALTHY_POLL_FLOOR_MS;
};

const resolveAffectedCalendarIds = async (
  channel: StoredPushChannel,
  dependencies: AffectedCalendarDependencies,
): Promise<string[]> => {
  if (channel.calendarId !== null) {
    return [channel.calendarId];
  }

  const calendars = await dependencies.listAccountCalendars(channel.accountId);
  return calendars
    .filter((calendar) => !calendar.disabled && calendar.capabilities.includes(PULL_CAPABILITY))
    .map((calendar) => calendar.id);
};

const resolveRequestedExpiresAt = (
  scopeKey: string,
  maxLifetimeMs: number,
  now: Date,
): Date => {
  const staggerPeriodMs = resolveStaggerPeriodMs(maxLifetimeMs);
  const stagger = getDeterministicRefreshOffset(scopeKey) % staggerPeriodMs;
  return new Date(now.getTime() + maxLifetimeMs - stagger);
};

const buildCalendarScope = (calendar: EligibleSourceCalendar): PushChannelScope | null => {
  if (calendar.externalCalendarId === null || calendar.providerAccountId === null) {
    return null;
  }
  return {
    accountId: calendar.accountId,
    calendarId: calendar.calendarId,
    externalCalendarId: calendar.externalCalendarId,
    kind: "calendar",
    providerAccountId: calendar.providerAccountId,
    userId: calendar.userId,
  };
};

const buildChannelScope = (channel: StoredPushChannel): PushChannelScope => ({
  accountId: channel.accountId,
  calendarId: channel.calendarId,
  kind: "channel",
  userId: channel.userId,
});

const isRegistrationEligible = (calendar: EligibleSourceCalendar): boolean =>
  isPullCalendar(calendar)
  && !calendar.needsReauthentication
  && calendar.externalCalendarId !== null
  && calendar.providerAccountId !== null
  && resolvePushProviderProfile(calendar.provider) !== null;

const isRenewalDue = (
  channel: StoredPushChannel,
  maxLifetimeMs: number,
  now: Date,
): boolean => {
  if (channel.nextAttemptAt !== null && channel.nextAttemptAt.getTime() > now.getTime()) {
    return false;
  }
  if (channel.reauthorizeRequestedAt !== null) {
    return true;
  }
  if (channel.expiresAt === null) {
    return true;
  }
  return channel.expiresAt.getTime() - now.getTime() < resolveRenewalLeadMs(maxLifetimeMs);
};

const isStaleRegistering = (channel: StoredPushChannel, now: Date): boolean =>
  now.getTime() - channel.updatedAt.getTime() >= STALE_REGISTERING_MS;

const hasNeverActivated = (channel: StoredPushChannel): boolean => channel.expiresAt === null;

const isRegistrationRetryable = (channel: StoredPushChannel): boolean =>
  channel.state === "registering" || hasNeverActivated(channel);

const isRegistrationRetryDue = (channel: StoredPushChannel, now: Date): boolean => {
  if (channel.nextAttemptAt !== null) {
    return channel.nextAttemptAt.getTime() <= now.getTime();
  }
  return isStaleRegistering(channel, now);
};

const isPushChannelGoneError = (error: unknown): boolean =>
  typeof error === "object"
  && error !== null
  && "channelGone" in error
  && (error as { channelGone: unknown }).channelGone === true;

const resolvePlansByUserId = async (
  userIds: string[],
  resolvePlan: (userId: string) => Promise<"free" | "pro">,
  onPlanError: (userId: string, error: unknown) => void,
): Promise<Map<string, "free" | "pro">> => {
  const uniqueUserIds = [...new Set(userIds)];
  const settlements = await Promise.allSettled(
    uniqueUserIds.map((userId) => resolvePlan(userId)),
  );

  const plansByUserId = new Map<string, "free" | "pro">();
  for (const [index, settlement] of settlements.entries()) {
    const userId = uniqueUserIds[index] ?? "";
    if (settlement.status === "rejected") {
      onPlanError(userId, new Error(
        `Unable to resolve user plan for push channel registration: ${userId}`,
        { cause: settlement.reason },
      ));
      continue;
    }
    plansByUserId.set(userId, settlement.value);
  }

  return plansByUserId;
};

const buildEligibleCalendarScope = (
  calendar: EligibleSourceCalendar | undefined,
): PushChannelScope | null => {
  if (!calendar || !isRegistrationEligible(calendar)) {
    return null;
  }
  return buildCalendarScope(calendar);
};

const buildChannelAction = (
  channel: StoredPushChannel,
  type: PushChannelActionType,
  scope: PushChannelScope,
  renewalMode: PushChannelRenewalMode | null,
  requestedExpiresAt: Date,
): PushChannelAction => ({
  channel,
  previousProviderChannelId: channel.providerChannelId,
  previousProviderResourceId: channel.providerResourceId,
  provider: channel.provider,
  renewalMode,
  requestedExpiresAt,
  scope,
  type,
});

const planStoredChannelAction = (
  channel: StoredPushChannel,
  calendar: EligibleSourceCalendar | undefined,
  plan: "free" | "pro",
  now: Date,
): PushChannelAction | null => {
  const profile = resolvePushProviderProfile(channel.provider);
  const scope = buildEligibleCalendarScope(calendar);

  if (!profile || plan !== "pro" || scope === null) {
    return buildChannelAction(
      channel,
      "deregister",
      scope ?? buildChannelScope(channel),
      profile?.renewalMode ?? null,
      now,
    );
  }

  const requestedExpiresAt = resolveRequestedExpiresAt(
    `${channel.provider}:${channel.calendarId ?? channel.accountId}`,
    profile.maxLifetimeMs,
    now,
  );

  if (isRegistrationRetryable(channel)) {
    if (!isRegistrationRetryDue(channel, now)) {
      return null;
    }
    return buildChannelAction(
      channel,
      "register",
      scope,
      profile.renewalMode,
      requestedExpiresAt,
    );
  }

  if (!isRenewalDue(channel, profile.maxLifetimeMs, now)) {
    return null;
  }

  return buildChannelAction(channel, "renew", scope, profile.renewalMode, requestedExpiresAt);
};

const planPushChannelActions = async (
  input: PlanPushChannelActionsInput,
): Promise<PushChannelAction[]> => {
  if (!input.webhookPublicUrl) {
    return [];
  }

  const calendarsById = new Map(
    input.calendars.map((calendar) => [calendar.calendarId, calendar]),
  );
  const liveChannels = input.channels.filter(
    (channel) => LIVE_PUSH_CHANNEL_STATES.has(channel.state),
  );
  const liveChannelsByCalendarId = new Map(
    liveChannels
      .filter((channel) => channel.calendarId !== null)
      .map((channel) => [channel.calendarId, channel]),
  );
  const plansByUserId = await resolvePlansByUserId(
    [
      ...liveChannels.map((channel) => channel.userId),
      ...input.calendars.map((calendar) => calendar.userId),
    ],
    input.resolvePlan,
    input.onPlanError,
  );

  const actions: PushChannelAction[] = [];

  const plannableChannels = liveChannels.flatMap((channel) => {
    const plan = plansByUserId.get(channel.userId);
    if (!plan) {
      return [];
    }
    return [{ channel, plan }];
  });

  for (const { channel, plan } of plannableChannels) {
    const action = planStoredChannelAction(
      channel,
      calendarsById.get(channel.calendarId ?? ""),
      plan,
      input.now,
    );
    if (action) {
      actions.push(action);
    }
  }

  for (const calendar of input.calendars) {
    if (liveChannelsByCalendarId.has(calendar.calendarId)) {
      continue;
    }
    if (!isRegistrationEligible(calendar)) {
      continue;
    }
    const profile = resolvePushProviderProfile(calendar.provider);
    const scope = buildCalendarScope(calendar);
    if (!profile || !scope) {
      continue;
    }
    if (plansByUserId.get(calendar.userId) === "free") {
      input.onFreeCalendarSkipped?.(calendar);
      continue;
    }
    if (plansByUserId.get(calendar.userId) !== "pro") {
      continue;
    }

    actions.push({
      channel: null,
      previousProviderChannelId: null,
      previousProviderResourceId: null,
      provider: calendar.provider,
      renewalMode: profile.renewalMode,
      requestedExpiresAt: resolveRequestedExpiresAt(
        `${calendar.provider}:${calendar.calendarId}`,
        profile.maxLifetimeMs,
        input.now,
      ),
      scope,
      type: "register",
    });
  }

  return actions;
};

const shouldRetainPushChannelAction = (
  action: PushChannelAction,
  channel: StoredPushChannel | null,
  now: Date,
): boolean => {
  if (action.channel === null) {
    return true;
  }
  if (channel === null) {
    return false;
  }

  const profile = resolvePushProviderProfile(channel.provider);

  if (action.type === "deregister") {
    return LIVE_PUSH_CHANNEL_STATES.has(channel.state);
  }
  if (action.type === "register") {
    return isRegistrationRetryable(channel) && isRegistrationRetryDue(channel, now);
  }
  if (!profile || (channel.state !== "active" && channel.state !== "degraded")) {
    return false;
  }
  return isRenewalDue(channel, profile.maxLifetimeMs, now);
};

export {
  FULL_POLL_INTERVAL_MS,
  isPushChannelGoneError,
  LIVE_PUSH_CHANNEL_STATES,
  planPushChannelActions,
  PUSH_HEALTHY_POLL_FLOOR_MS,
  resolveAffectedCalendarIds,
  resolveIngestPollFloorMs,
  resolvePushChannelHealth,
  shouldRetainPushChannelAction,
  STALE_REGISTERING_MS,
  toPushChannelState,
};
export type {
  AccountCalendarRow,
  AffectedCalendarDependencies,
  EligibleSourceCalendar,
  IngestPollFloorInput,
  ListedPushChannel,
  PlanPushChannelActionsInput,
  PushChannelAction,
  PushChannelActionType,
  PushChannelHealth,
  PushChannelRegistration,
  PushChannelRenewalMode,
  PushChannelScope,
  PushChannelState,
  PushClaimKind,
  PushRateLimiter,
  RegistrarContext,
  SourcePushRegistrar,
  StoredPushChannel,
};
