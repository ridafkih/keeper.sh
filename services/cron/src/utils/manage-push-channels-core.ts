import {
  allSettledWithConcurrency,
  buildCalendarBackoffState,
  hashPushSecret,
  isPushChannelGoneError,
  planPushChannelActions,
  resolvePushChannelHealth,
  shouldRetainPushChannelAction,
} from "@keeper.sh/calendar";
import type {
  EligibleSourceCalendar,
  ListedPushChannel,
  PushChannelAction,
  PushChannelRegistration,
  PushChannelScope,
  RegistrarContext,
  SourcePushRegistrar,
  StoredPushChannel,
} from "@keeper.sh/calendar";
import type { Plan } from "@keeper.sh/data-schemas";

const TICK_LOCK_KEY = "push-channel:tick";
const TICK_LOCK_TTL_SECONDS = 300;
const SCOPE_LOCK_TTL_SECONDS = 120;
const SCOPE_CONCURRENCY = 5;
const PUSH_ACTIONS_PER_TICK = 100;
const MAX_DEREGISTER_ATTEMPTS = 3;
const MS_PER_SECOND = 1000;

interface RegistrarContextRequest {
  channelId: string | null;
  provider: string;
  requestedExpiresAt: Date;
  scope: PushChannelScope;
}

interface ManagePushChannelsDependencies {
  createRegistrarContext: (request: RegistrarContextRequest) => Promise<RegistrarContext>;
  deleteNegativeCacheKey: (provider: string, providerChannelId: string) => Promise<void>;
  generateChannelId: () => string;
  generateSecret: () => string;
  insertChannel: (row: Record<string, unknown>) => Promise<StoredPushChannel>;
  now: () => Date;
  observe: (fields: Record<string, unknown>) => void;
  readChannel: (channelId: string) => Promise<StoredPushChannel | null>;
  recordError: (error: unknown, slug: string) => void;
  releaseLock: (key: string) => Promise<void>;
  resolvePlan: (userId: string) => Promise<Plan>;
  resolveRegistrar: (provider: string) => SourcePushRegistrar | null;
  selectChannels: () => Promise<StoredPushChannel[]>;
  selectEligibleCalendars: () => Promise<EligibleSourceCalendar[]>;
  tryAcquireLock: (key: string, ttlSeconds: number) => Promise<boolean>;
  updateChannel: (channelId: string, updates: Record<string, unknown>) => Promise<void>;
  webhookPublicUrl: string | null;
}

interface ManageCounters {
  activatedProviderChannelIds: Set<string>;
  deregistered: number;
  driftUnknownAtProvider: number;
  failed: number;
  lockContention: number;
  orphanSuspected: number;
  planErrors: number;
  registered: number;
  renewed: number;
  skippedFree: number;
}

const createCounters = (): ManageCounters => ({
  activatedProviderChannelIds: new Set<string>(),
  deregistered: 0,
  driftUnknownAtProvider: 0,
  failed: 0,
  lockContention: 0,
  orphanSuspected: 0,
  planErrors: 0,
  registered: 0,
  renewed: 0,
  skippedFree: 0,
});

const resolveScopeLockKey = (action: PushChannelAction): string => {
  if (action.scope.kind === "calendar") {
    return `push-channel:${action.provider}:calendar:${action.scope.calendarId}`;
  }
  if (action.scope.kind === "channel") {
    return `push-channel:${action.provider}:channel:${action.scope.calendarId ?? action.scope.accountId}`;
  }
  return `push-channel:${action.provider}:account:${action.scope.accountId}`;
};

const usesClientAssignedChannelId = (registrar: SourcePushRegistrar): boolean =>
  registrar.renewalMode === "recreate";

const resolveRegistrationChannelId = (
  registrar: SourcePushRegistrar,
  generateChannelId: () => string,
): string | null => {
  if (!usesClientAssignedChannelId(registrar)) {
    return null;
  }
  return generateChannelId();
};

const resolveRenewalChannelId = (
  recreates: boolean,
  generateChannelId: () => string,
): string | null => {
  if (!recreates) {
    return null;
  }
  return generateChannelId();
};

const resolveRenewalSecret = (
  recreates: boolean,
  generateSecret: () => string,
): string | null => {
  if (!recreates) {
    return null;
  }
  return generateSecret();
};

const resolveRenewalSecretHash = (secret: string | null): string | null => {
  if (secret === null) {
    return null;
  }
  return hashPushSecret(secret);
};

const resolveMinExpiresInSeconds = (expiries: number[]): number | null => {
  if (expiries.length === 0) {
    return null;
  }
  return Math.floor(Math.min(...expiries) / MS_PER_SECOND);
};

const buildActivationUpdates = (
  registration: PushChannelRegistration,
  secretHash: string | null,
): Record<string, unknown> => ({
  expiresAt: registration.expiresAt,
  failureCount: 0,
  lastFailureAt: null,
  nextAttemptAt: null,
  providerChannelId: registration.providerChannelId,
  providerResourceId: registration.providerResourceId,
  reauthorizeRequestedAt: null,
  resourcePath: registration.resourcePath,
  state: "active",
  ...(secretHash !== null && { secretHash }),
});

const applyBackoff = async (
  channel: StoredPushChannel,
  dependencies: ManagePushChannelsDependencies,
  finalState: string,
): Promise<void> => {
  const backoff = buildCalendarBackoffState(channel.failureCount, dependencies.now());
  await dependencies.updateChannel(channel.id, {
    failureCount: backoff.failureCount,
    lastFailureAt: backoff.lastFailureAt,
    nextAttemptAt: backoff.nextAttemptAt,
    state: finalState,
  });
};

const activateChannel = async (
  channel: StoredPushChannel,
  registration: PushChannelRegistration,
  secretHash: string | null,
  dependencies: ManagePushChannelsDependencies,
  provider: string,
  counters: ManageCounters,
): Promise<void> => {
  await dependencies.updateChannel(
    channel.id,
    buildActivationUpdates(registration, secretHash),
  );
  counters.activatedProviderChannelIds.add(registration.providerChannelId);
  await dependencies.deleteNegativeCacheKey(provider, registration.providerChannelId);
};

const runRegisterAction = async (
  action: PushChannelAction,
  registrar: SourcePushRegistrar,
  existing: StoredPushChannel | null,
  dependencies: ManagePushChannelsDependencies,
  counters: ManageCounters,
  countsAsOrphan = true,
): Promise<void> => {
  if (action.scope.kind !== "calendar") {
    return;
  }

  const secret = dependencies.generateSecret();
  const secretHash = hashPushSecret(secret);
  const clientChannelId = resolveRegistrationChannelId(
    registrar,
    dependencies.generateChannelId,
  );

  let channel = existing;
  if (channel === null) {
    channel = await dependencies.insertChannel({
      accountId: action.scope.accountId,
      calendarId: action.scope.calendarId,
      expiresAt: null,
      provider: action.provider,
      providerChannelId: clientChannelId,
      resourcePath: null,
      secretHash,
      state: "registering",
      userId: action.scope.userId,
    });
  } else {
    if (countsAsOrphan) {
      counters.orphanSuspected += 1;
    }
    await dependencies.updateChannel(channel.id, {
      providerChannelId: clientChannelId,
      secretHash,
      state: "registering",
    });
  }

  try {
    const registrarContext = await dependencies.createRegistrarContext({
      channelId: clientChannelId,
      provider: action.provider,
      requestedExpiresAt: action.requestedExpiresAt,
      scope: action.scope,
    });
    const registration = await registrar.register(action.scope, secret, registrarContext);
    await activateChannel(
      channel,
      registration,
      secretHash,
      dependencies,
      action.provider,
      counters,
    );
    counters.registered += 1;
  } catch (error) {
    dependencies.recordError(error, "webhook-registration-failed");
    await applyBackoff(channel, dependencies, "registering");
    counters.failed += 1;
  }
};

const stopSupersededChannel = async (
  action: PushChannelAction,
  registrar: SourcePushRegistrar,
  channel: StoredPushChannel,
  registration: PushChannelRegistration,
  registrarContext: RegistrarContext,
  dependencies: ManagePushChannelsDependencies,
  counters: ManageCounters,
): Promise<void> => {
  const previousChannelId = action.previousProviderChannelId;
  if (previousChannelId === null || previousChannelId === registration.providerChannelId) {
    return;
  }

  try {
    await registrar.deregister(
      {
        ...channel,
        providerChannelId: previousChannelId,
        providerResourceId: action.previousProviderResourceId,
      },
      registrarContext,
    );
    counters.deregistered += 1;
  } catch (error) {
    dependencies.recordError(error, "webhook-deregistration-failed");
  }
};

type RenewalAttempt =
  | { error: unknown; kind: "failed" }
  | { error: unknown; kind: "gone" }
  | {
    kind: "renewed";
    registrarContext: RegistrarContext;
    registration: PushChannelRegistration;
  };

const attemptRenewal = async (
  action: PushChannelAction,
  registrar: SourcePushRegistrar,
  channel: StoredPushChannel,
  secret: string | null,
  recreates: boolean,
  dependencies: ManagePushChannelsDependencies,
): Promise<RenewalAttempt> => {
  try {
    const registrarContext = await dependencies.createRegistrarContext({
      channelId: resolveRenewalChannelId(recreates, dependencies.generateChannelId),
      provider: action.provider,
      requestedExpiresAt: action.requestedExpiresAt,
      scope: action.scope,
    });
    return {
      kind: "renewed",
      registrarContext,
      registration: await registrar.renew(channel, secret, registrarContext),
    };
  } catch (error) {
    if (isPushChannelGoneError(error)) {
      return { error, kind: "gone" };
    }
    return { error, kind: "failed" };
  }
};

const runRenewAction = async (
  action: PushChannelAction,
  registrar: SourcePushRegistrar,
  channel: StoredPushChannel,
  dependencies: ManagePushChannelsDependencies,
  counters: ManageCounters,
): Promise<void> => {
  const recreates = usesClientAssignedChannelId(registrar);
  const secret = resolveRenewalSecret(recreates, dependencies.generateSecret);
  const secretHash = resolveRenewalSecretHash(secret);

  const attempt = await attemptRenewal(
    action,
    registrar,
    channel,
    secret,
    recreates,
    dependencies,
  );

  if (attempt.kind === "gone") {
    dependencies.recordError(attempt.error, "webhook-channel-vanished");
    await runRegisterAction(action, registrar, channel, dependencies, counters, false);
    return;
  }

  if (attempt.kind === "failed") {
    dependencies.recordError(attempt.error, "webhook-renewal-failed");
    await applyBackoff(channel, dependencies, "degraded");
    counters.failed += 1;
    return;
  }

  await activateChannel(
    channel,
    attempt.registration,
    secretHash,
    dependencies,
    action.provider,
    counters,
  );
  counters.renewed += 1;

  if (recreates) {
    await stopSupersededChannel(
      action,
      registrar,
      channel,
      attempt.registration,
      attempt.registrarContext,
      dependencies,
      counters,
    );
  }
};

const runDeregisterAction = async (
  action: PushChannelAction,
  registrar: SourcePushRegistrar | null,
  channel: StoredPushChannel,
  dependencies: ManagePushChannelsDependencies,
  counters: ManageCounters,
): Promise<void> => {
  if (!registrar || channel.providerChannelId === null) {
    await dependencies.updateChannel(channel.id, { state: "failed" });
    counters.failed += 1;
    return;
  }

  try {
    const registrarContext = await dependencies.createRegistrarContext({
      channelId: channel.providerChannelId,
      provider: action.provider,
      requestedExpiresAt: action.requestedExpiresAt,
      scope: action.scope,
    });
    await registrar.deregister(channel, registrarContext);
    await dependencies.updateChannel(channel.id, { state: "removed" });
    counters.deregistered += 1;
  } catch (error) {
    dependencies.recordError(error, "webhook-deregistration-failed");
    if (channel.failureCount + 1 >= MAX_DEREGISTER_ATTEMPTS) {
      await dependencies.updateChannel(channel.id, { state: "failed" });
      counters.failed += 1;
      return;
    }
    await applyBackoff(channel, dependencies, channel.state);
  }
};

const readCurrentChannel = (
  action: PushChannelAction,
  dependencies: ManagePushChannelsDependencies,
): Promise<StoredPushChannel | null> => {
  if (action.channel === null) {
    return Promise.resolve(null);
  }
  return dependencies.readChannel(action.channel.id);
};

const runAction = async (
  action: PushChannelAction,
  dependencies: ManagePushChannelsDependencies,
  counters: ManageCounters,
): Promise<void> => {
  const lockKey = resolveScopeLockKey(action);
  if (!await dependencies.tryAcquireLock(lockKey, SCOPE_LOCK_TTL_SECONDS)) {
    counters.lockContention += 1;
    return;
  }

  try {
    const current = await readCurrentChannel(action, dependencies);
    if (!shouldRetainPushChannelAction(action, current, dependencies.now())) {
      return;
    }

    const registrar = dependencies.resolveRegistrar(action.provider);

    if (action.type === "deregister") {
      if (current === null) {
        return;
      }
      await runDeregisterAction(action, registrar, current, dependencies, counters);
      return;
    }

    if (!registrar) {
      return;
    }

    if (action.type === "renew") {
      if (current === null) {
        return;
      }
      await runRenewAction(action, registrar, current, dependencies, counters);
      return;
    }

    await runRegisterAction(action, registrar, current, dependencies, counters);
  } finally {
    await dependencies.releaseLock(lockKey);
  }
};

const toOrphanChannel = (
  orphan: ListedPushChannel,
  calendar: EligibleSourceCalendar,
  now: Date,
): StoredPushChannel => ({
  accountId: calendar.accountId,
  calendarId: null,
  createdAt: now,
  expiresAt: orphan.expiresAt,
  failureCount: 0,
  id: orphan.providerChannelId,
  lastFailureAt: null,
  lastNotificationAt: null,
  nextAttemptAt: null,
  provider: calendar.provider,
  providerChannelId: orphan.providerChannelId,
  providerResourceId: orphan.providerResourceId,
  reauthorizeRequestedAt: null,
  resourcePath: orphan.resourcePath,
  secretHash: "",
  state: "removed",
  updatedAt: now,
  userId: calendar.userId,
  verifiedAt: null,
});

const isDriftEligible = (
  calendar: EligibleSourceCalendar,
  registrar: SourcePushRegistrar | null,
): boolean =>
  registrar?.supportsList === true
  && Boolean(registrar.list)
  && !calendar.needsReauthentication
  && calendar.providerAccountId !== null;

const reconcileAccountDrift = async (
  calendar: EligibleSourceCalendar,
  providerAccountId: string,
  registrar: SourcePushRegistrar,
  knownChannelIds: Set<string>,
  dependencies: ManagePushChannelsDependencies,
  counters: ManageCounters,
): Promise<void> => {
  if (!registrar.list) {
    return;
  }

  const registrarContext = await dependencies.createRegistrarContext({
    channelId: null,
    provider: calendar.provider,
    requestedExpiresAt: dependencies.now(),
    scope: {
      accountId: calendar.accountId,
      kind: "account",
      providerAccountId,
      userId: calendar.userId,
    },
  });

  const listed = await registrar.list(calendar.accountId, registrarContext);
  const orphans = listed.filter((subscription: ListedPushChannel) =>
    subscription.notificationUrl === registrarContext.notificationUrl
    && !knownChannelIds.has(subscription.providerChannelId));

  for (const orphan of orphans) {
    counters.driftUnknownAtProvider += 1;
    await registrar.deregister(
      toOrphanChannel(orphan, calendar, dependencies.now()),
      registrarContext,
    );
  }
};

const reconcileProviderDrift = async (
  calendars: EligibleSourceCalendar[],
  dependencies: ManagePushChannelsDependencies,
  counters: ManageCounters,
): Promise<void> => {
  if (!dependencies.webhookPublicUrl) {
    return;
  }

  const currentChannels = await dependencies.selectChannels();
  const knownChannelIds = new Set([
    ...counters.activatedProviderChannelIds,
    ...currentChannels
      .map((channel) => channel.providerChannelId)
      .filter((channelId): channelId is string => channelId !== null),
  ]);
  const accounts = new Map<string, EligibleSourceCalendar>();
  for (const calendar of calendars) {
    const registrar = dependencies.resolveRegistrar(calendar.provider);
    if (isDriftEligible(calendar, registrar) && !accounts.has(calendar.accountId)) {
      accounts.set(calendar.accountId, calendar);
    }
  }

  for (const [accountId, calendar] of accounts) {
    const registrar = dependencies.resolveRegistrar(calendar.provider);
    const { providerAccountId } = calendar;
    if (!registrar || providerAccountId === null) {
      continue;
    }

    const lockKey = `push-channel:${calendar.provider}:drift:${accountId}`;
    if (!await dependencies.tryAcquireLock(lockKey, SCOPE_LOCK_TTL_SECONDS)) {
      continue;
    }

    try {
      await reconcileAccountDrift(
        calendar,
        providerAccountId,
        registrar,
        knownChannelIds,
        dependencies,
        counters,
      );
    } catch (error) {
      dependencies.recordError(error, "webhook-drift-reconciliation-failed");
    } finally {
      await dependencies.releaseLock(lockKey);
    }
  }
};

const observeInventory = (
  calendars: EligibleSourceCalendar[],
  channels: StoredPushChannel[],
  dependencies: ManagePushChannelsDependencies,
): void => {
  const now = dependencies.now();
  const expiries = channels
    .filter((channel) => channel.state === "active" && channel.expiresAt !== null)
    .map((channel) => (channel.expiresAt?.getTime() ?? now.getTime()) - now.getTime());

  dependencies.observe({
    "push_channel.active_count": channels.filter((channel) => channel.state === "active").length,
    "push_channel.eligible_count": calendars.length,
    "push_channel.healthy_count": channels.filter(
      (channel) => resolvePushChannelHealth(channel, now).healthy,
    ).length,
    "push_channel.min_expires_in_seconds": resolveMinExpiresInSeconds(expiries),
    "push_channel.registering_count": channels.filter(
      (channel) => channel.state === "registering",
    ).length,
    "push_channel.skipped_reauth_count": calendars.filter(
      (calendar) => calendar.needsReauthentication,
    ).length,
    "push_channel.verified_count": channels.filter(
      (channel) => channel.verifiedAt !== null,
    ).length,
  });
};

const runManagePushChannels = async (
  dependencies: ManagePushChannelsDependencies,
): Promise<void> => {
  if (!dependencies.webhookPublicUrl) {
    return;
  }

  if (!await dependencies.tryAcquireLock(TICK_LOCK_KEY, TICK_LOCK_TTL_SECONDS)) {
    dependencies.observe({ "push_channel.lock_contention": 1 });
    return;
  }

  const counters = createCounters();

  try {
    const [calendars, channels] = await Promise.all([
      dependencies.selectEligibleCalendars(),
      dependencies.selectChannels(),
    ]);

    observeInventory(calendars, channels, dependencies);

    const actions = await planPushChannelActions({
      calendars,
      channels,
      now: dependencies.now(),
      onFreeCalendarSkipped: () => {
        counters.skippedFree += 1;
      },
      onPlanError: (_userId, error) => {
        counters.planErrors += 1;
        dependencies.recordError(error, "webhook-plan-unresolvable");
      },
      resolvePlan: dependencies.resolvePlan,
      webhookPublicUrl: dependencies.webhookPublicUrl,
    });

    const settlements = await allSettledWithConcurrency(
      actions.slice(0, PUSH_ACTIONS_PER_TICK).map((action) => () =>
        runAction(action, dependencies, counters)),
      { concurrency: SCOPE_CONCURRENCY },
    );

    for (const settlement of settlements) {
      if (settlement.status === "rejected") {
        counters.failed += 1;
        dependencies.recordError(settlement.reason, "webhook-channel-action-failed");
      }
    }

    await reconcileProviderDrift(calendars, dependencies, counters);
  } finally {
    dependencies.observe({
      "push_channel.deregistered_count": counters.deregistered,
      "push_channel.drift_unknown_at_provider": counters.driftUnknownAtProvider,
      "push_channel.failed_count": counters.failed,
      "push_channel.lock_contention": counters.lockContention,
      "push_channel.orphan_suspected": counters.orphanSuspected,
      "push_channel.plan_error_count": counters.planErrors,
      "push_channel.registered_count": counters.registered,
      "push_channel.renewed_count": counters.renewed,
      "push_channel.skipped_free_count": counters.skippedFree,
    });
    await dependencies.releaseLock(TICK_LOCK_KEY);
  }
};

export { MAX_DEREGISTER_ATTEMPTS, PUSH_ACTIONS_PER_TICK, runManagePushChannels };
export type { ManagePushChannelsDependencies, RegistrarContextRequest };
