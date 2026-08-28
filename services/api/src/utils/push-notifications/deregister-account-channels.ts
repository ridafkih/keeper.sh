import { and, eq, inArray } from "drizzle-orm";
import {
  LIVE_PUSH_CHANNEL_STATES,
  PUSH_CHANNEL_STATES,
  createCoordinatedRefresher,
  createGoogleTokenRefresher,
  createMicrosoftTokenRefresher,
  ensureValidToken,
  resolvePushRegistrar,
  toPushChannelState,
} from "@keeper.sh/calendar";
import type {
  PushChannelState,
  RegistrarContext,
  SourcePushRegistrar,
  StoredPushChannel,
  TeardownResidueCredential,
  TokenState,
  WebhookConfig,
} from "@keeper.sh/calendar";
import {
  calendarAccountsTable,
  calendarPushChannelsTable,
  oauthCredentialsTable,
} from "@keeper.sh/database/schema";
import { widelog } from "@/utils/logging";
import {
  PUSH_CHANNELS_TIMEOUT_MS,
  STEP_ABORT_SETTLE_MS,
} from "@/utils/teardown-step-budgets";
import type { database as databaseInstance } from "@/context";

const DEREGISTRATION_ERROR_PREFIX = "push_channel.disconnect_error";
const DEREGISTRATION_FAILED_SLUG = "webhook-deregistration-failed";
const RESTATE_FAILED_SLUG = "push-channel-restate-failed";
const RESIDUE_CREDENTIAL_FAILED_SLUG = "push-channel-residue-credential-failed";
const STOPPED_STATE = "removed";
const DISCONNECT_TIMEOUT_MS = 5000;
const REFRESH_LOCK_ACQUIRE_BUDGET_MS = PUSH_CHANNELS_TIMEOUT_MS - STEP_ABORT_SETTLE_MS;
const DISCONNECT_CONCURRENCY = 8;
const SERIAL_CONCURRENCY = 1;
const LISTING_ATTEMPTS = 3;
const LISTING_RETRY_DELAY_MS = 50;

interface AbandonedPushChannelResidue {
  credential: TeardownResidueCredential | null;
  provider: string;
  providerChannelId: string;
  providerResourceId: string | null;
}

class AbandonedPushChannelError extends Error {
  readonly residue: AbandonedPushChannelResidue;

  constructor(
    message: string,
    residue: AbandonedPushChannelResidue,
    options: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AbandonedPushChannelError";
    this.residue = residue;
  }
}

interface DeregisterPushChannelsDependencies {
  createRegistrarContext: (channel: StoredPushChannel) => Promise<RegistrarContext>;
  listLiveChannels: (scopeId: string) => Promise<StoredPushChannel[]>;
  markChannelsStopped?: (channelIds: string[]) => Promise<void>;
  observe: (fields: Record<string, unknown>) => void;
  recordError: (error: unknown, slug: string) => void;
  resolveResidueCredential?: (
    channel: StoredPushChannel,
  ) => Promise<TeardownResidueCredential | null> | TeardownResidueCredential | null;
  resolveRegistrar: (provider: string) => SourcePushRegistrar | null;
  webhookConfigured: boolean;
}

interface DeregisterPushChannelsOutcome {
  abandonments: Error[];
  deregisteredCount: number;
}

interface AbandonedPushChannel {
  id: string;
  provider: string;
  providerChannelId: string;
  providerResourceId: string | null;
}

const combineSignals = (signals: AbortSignal[]): AbortSignal[] => {
  if (signals.length < 2) {
    return signals;
  }
  return [AbortSignal.any(signals)];
};

type ChannelDialOutcome = { context: RegistrarContext } | { reason: unknown };

type ChannelStopOutcome =
  | { context: RegistrarContext | null; reason: unknown; stopped: false }
  | { stopped: true };

const stopChannel = async (
  channel: StoredPushChannel,
  registrar: SourcePushRegistrar,
  dependencies: DeregisterPushChannelsDependencies,
  signal: AbortSignal | null,
): Promise<ChannelStopOutcome> => {
  const dialed = await dependencies
    .createRegistrarContext(channel)
    .then(
      (registrarContext): ChannelDialOutcome => ({ context: registrarContext }),
      (error: unknown) => ({ reason: error }),
    );

  if (!("context" in dialed)) {
    return { context: null, reason: dialed.reason, stopped: false };
  }

  const { context } = dialed;

  try {
    const [effectiveSignal] = combineSignals(
      [signal, context.signal ?? null].filter(
        (candidate): candidate is AbortSignal => candidate !== null,
      ),
    );

    await registrar.deregister(channel, {
      ...context,
      ...(effectiveSignal && { signal: effectiveSignal }),
    });
    return { stopped: true };
  } catch (error) {
    return { context, reason: error, stopped: false };
  }
};

const resolveAbandonmentReason = (
  channelId: string,
  failureReasons: Map<string, unknown>,
  signal: AbortSignal | null,
): unknown => {
  if (failureReasons.has(channelId)) {
    return failureReasons.get(channelId);
  }
  if (signal?.aborted) {
    return signal.reason;
  }
  return new Error(`Push channel ${channelId} was never dialed at the provider`);
};

const identifyChannel = (channel: AbandonedPushChannel): string =>
  `${channel.provider}:${channel.id}:${channel.providerChannelId}`;

const describeReason = (reason: unknown): string => {
  if (reason instanceof AggregateError) {
    return [reason.message, ...reason.errors.map((inner) => describeReason(inner))]
      .join("; ");
  }
  if (reason instanceof Error) {
    const cause = reason.cause ?? null;
    if (cause === null) {
      return `${reason.name}: ${reason.message}`;
    }
    return `${reason.name}: ${reason.message}; caused by ${describeReason(cause)}`;
  }
  if (typeof reason === "string") {
    return reason;
  }
  return `Unknown reason ${String(reason)}`;
};

const describeAbandonment = (
  channel: AbandonedPushChannel,
  reason: unknown,
  credential: TeardownResidueCredential | null,
): Error =>
  new AbandonedPushChannelError(
    `Push channel ${channel.id} (${channel.provider} channel ${channel.providerChannelId}) was not confirmed stopped at the provider: ${describeReason(reason)}`,
    {
      credential,
      provider: channel.provider,
      providerChannelId: channel.providerChannelId,
      providerResourceId: channel.providerResourceId,
    },
    { cause: reason },
  );

const describeAbandoned = (
  channels: StoredPushChannel[],
  stoppedChannelIds: string[],
): AbandonedPushChannel[] => {
  const stopped = new Set(stoppedChannelIds);

  return channels
    .filter((channel) => !stopped.has(channel.id))
    .map((channel) => ({
      id: channel.id,
      provider: channel.provider,
      providerChannelId: String(channel.providerChannelId),
      providerResourceId: channel.providerResourceId,
    }));
};

const carriesProviderIdentifier = (channel: StoredPushChannel): boolean =>
  channel.providerChannelId !== null;

const describePossiblyOrphaned = (channels: StoredPushChannel[]): string[] =>
  channels
    .filter((channel) =>
      !carriesProviderIdentifier(channel)
      && LIVE_PUSH_CHANNEL_STATES.has(channel.state))
    .map((channel) => `${channel.provider}:${channel.id}:${channel.state}`);

const storedResidueCredentialFor = async (
  channel: StoredPushChannel,
  dependencies: DeregisterPushChannelsDependencies,
): Promise<TeardownResidueCredential | null> => {
  const { resolveResidueCredential } = dependencies;
  if (!resolveResidueCredential) {
    return null;
  }

  try {
    return await resolveResidueCredential(channel);
  } catch (error) {
    dependencies.recordError(error, RESIDUE_CREDENTIAL_FAILED_SLUG);
    return null;
  }
};

const residueCredentialFor = async (
  channel: StoredPushChannel,
  context: RegistrarContext | null,
  dependencies: DeregisterPushChannelsDependencies,
): Promise<TeardownResidueCredential | null> => {
  const stored = await storedResidueCredentialFor(channel, dependencies);

  if (stored !== null) {
    return stored;
  }

  if (context === null) {
    return null;
  }

  return { accessToken: context.accessToken, expiresAt: null, refreshToken: null };
};

const restateStoppedChannels = async (
  channelIds: string[],
  dependencies: DeregisterPushChannelsDependencies,
): Promise<number> => {
  if (channelIds.length === 0) {
    return 0;
  }

  const { markChannelsStopped } = dependencies;
  if (!markChannelsStopped) {
    dependencies.recordError(
      new Error(
        `Push channels ${channelIds.join(", ")} were stopped at the provider but no channel writer was supplied to restate their rows`,
      ),
      RESTATE_FAILED_SLUG,
    );
    return 0;
  }

  try {
    await markChannelsStopped(channelIds);
    return channelIds.length;
  } catch (error) {
    dependencies.recordError(error, RESTATE_FAILED_SLUG);
    return 0;
  }
};

const delayBeforeListingRetry = async (signal: AbortSignal | null): Promise<void> =>
  await new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }

    const settled = new AbortController();
    const timer = setTimeout(() => {
      settled.abort();
      resolve();
    }, LISTING_RETRY_DELAY_MS);

    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true, signal: settled.signal });
  });

const listLiveChannelsWithRetry = async (
  scopeId: string,
  dependencies: DeregisterPushChannelsDependencies,
  signal: AbortSignal | null,
): Promise<StoredPushChannel[]> => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await dependencies.listLiveChannels(scopeId);
    } catch (error) {
      if (attempt >= LISTING_ATTEMPTS || signal?.aborted) {
        throw error;
      }

      try {
        await delayBeforeListingRetry(signal);
      } catch {
        throw error;
      }
    }
  }
};

const runDeregisterPushChannelsOutcome = async (
  scopeId: string,
  dependencies: DeregisterPushChannelsDependencies,
  signal: AbortSignal | null = null,
  concurrency: number = DISCONNECT_CONCURRENCY,
  recordAbandonments = false,
  requireChannelListing = recordAbandonments,
): Promise<DeregisterPushChannelsOutcome> => {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error(
      `Push channel deregistration concurrency must be a positive integer, received ${concurrency}`,
    );
  }

  if (!dependencies.webhookConfigured) {
    if (requireChannelListing) {
      const error = new Error(
        `Push channel deregistration for ${scopeId} cannot dial any channel because WEBHOOK_PUBLIC_URL is not configured`,
      );

      dependencies.recordError(error, DEREGISTRATION_FAILED_SLUG);

      throw error;
    }

    return { abandonments: [], deregisteredCount: 0 };
  }

  let channels: StoredPushChannel[] = [];
  try {
    channels = await listLiveChannelsWithRetry(scopeId, dependencies, signal);
  } catch (error) {
    dependencies.recordError(error, DEREGISTRATION_FAILED_SLUG);
    if (requireChannelListing) {
      throw error;
    }
    return { abandonments: [], deregisteredCount: 0 };
  }

  const dialable = channels.filter((channel) => carriesProviderIdentifier(channel));
  const possiblyOrphaned = describePossiblyOrphaned(channels);
  const queued = [...dialable];
  const stoppedChannelIds: string[] = [];
  const failureReasons = new Map<string, unknown>();
  const residueCredentials = new Map<string, TeardownResidueCredential>();

  const workers = Array.from(
    { length: Math.min(concurrency, queued.length) },
    async () => {
      for (let channel = queued.shift(); channel; channel = queued.shift()) {
        if (signal?.aborted) {
          return;
        }

        const registrar = dependencies.resolveRegistrar(channel.provider);
        if (!registrar) {
          failureReasons.set(
            channel.id,
            new Error(`No push registrar is available for provider ${channel.provider}`),
          );
          continue;
        }

        const outcome = await stopChannel(channel, registrar, dependencies, signal);
        if (outcome.stopped) {
          stoppedChannelIds.push(channel.id);
          continue;
        }

        failureReasons.set(channel.id, outcome.reason);

        const credential = await residueCredentialFor(
          channel,
          outcome.context,
          dependencies,
        );
        if (credential !== null) {
          residueCredentials.set(channel.id, credential);
        }
      }
    },
  );

  await Promise.all(workers);

  const abandoned = describeAbandoned(dialable, stoppedChannelIds).map((channel) => ({
    channel,
    reason: resolveAbandonmentReason(channel.id, failureReasons, signal),
  }));
  const dialableById = new Map(dialable.map((channel) => [channel.id, channel]));
  const abandonments = await Promise.all(abandoned.map(async ({ channel, reason }) => {
    const dialed = residueCredentials.get(channel.id) ?? null;
    if (dialed !== null) {
      return describeAbandonment(channel, reason, dialed);
    }

    const stored = dialableById.get(channel.id) ?? null;
    if (stored === null) {
      throw new Error(
        `Abandoned push channel ${channel.id} is missing from the dialable channels it was drawn from`,
      );
    }

    return describeAbandonment(
      channel,
      reason,
      await residueCredentialFor(stored, null, dependencies),
    );
  }));

  if (recordAbandonments) {
    for (const abandonment of abandonments) {
      dependencies.recordError(abandonment, DEREGISTRATION_FAILED_SLUG);
    }
  }

  const restated = await restateStoppedChannels(stoppedChannelIds, dependencies);

  dependencies.observe({
    "push_channel.disconnect_abandoned": abandoned.map(({ channel }) =>
      identifyChannel(channel)),
    "push_channel.disconnect_abandoned_reason": abandoned.map(({ channel, reason }) =>
      `${identifyChannel(channel)} ${describeReason(reason)}`),
    "push_channel.disconnect_abandoned_count": abandoned.length,
    "push_channel.disconnect_deregistered_count": stoppedChannelIds.length,
    "push_channel.disconnect_live_count": channels.length,
    "push_channel.disconnect_possibly_orphaned": possiblyOrphaned,
    "push_channel.disconnect_possibly_orphaned_count": possiblyOrphaned.length,
    "push_channel.disconnect_restated_count": restated,
  });

  return { abandonments, deregisteredCount: stoppedChannelIds.length };
};

const runDeregisterPushChannels = async (
  scopeId: string,
  dependencies: DeregisterPushChannelsDependencies,
  signal: AbortSignal | null = null,
  concurrency: number = DISCONNECT_CONCURRENCY,
  requireChannelListing = false,
): Promise<number> => {
  const outcome = await runDeregisterPushChannelsOutcome(
    scopeId,
    dependencies,
    signal,
    concurrency,
    true,
    requireChannelListing,
  );

  return outcome.deregisteredCount;
};

const describeAbandonedScope = (
  scopeId: string,
  abandonments: Error[],
): AggregateError =>
  new AggregateError(
    abandonments,
    `${abandonments.length} push channel(s) for ${scopeId} were left running at their provider`,
  );

const resolveTokenRefresher = (
  provider: string,
  clientCredentials: {
    googleClientId?: string;
    googleClientSecret?: string;
    microsoftClientId?: string;
    microsoftClientSecret?: string;
  },
) => {
  if (
    provider === "google"
    && clientCredentials.googleClientId
    && clientCredentials.googleClientSecret
  ) {
    return createGoogleTokenRefresher({
      clientId: clientCredentials.googleClientId,
      clientSecret: clientCredentials.googleClientSecret,
    });
  }

  if (
    provider === "outlook"
    && clientCredentials.microsoftClientId
    && clientCredentials.microsoftClientSecret
  ) {
    return createMicrosoftTokenRefresher({
      clientId: clientCredentials.microsoftClientId,
      clientSecret: clientCredentials.microsoftClientSecret,
    });
  }

  return null;
};

const resolveNotificationUrl = (provider: string, config: WebhookConfig): string => {
  if (provider === "google") {
    return config.googleCallbackUrl;
  }
  if (provider === "outlook") {
    return config.outlookCallbackUrl;
  }
  throw new Error(`No push notification url is defined for provider ${provider}`);
};

type PushChannelScopeColumn = "accountId" | "calendarId" | "userId";

interface TeardownPushChannel {
  credential: TeardownResidueCredential | null;
  provider: string;
  providerChannelId: string | null;
  providerResourceId: string | null;
  userId: string;
}

const selectLivePushChannels = async (
  database: typeof databaseInstance,
  scopeColumn: PushChannelScopeColumn,
  scope: string,
  states: PushChannelState[],
): Promise<StoredPushChannel[]> => {
  const rows = await database
    .select()
    .from(calendarPushChannelsTable)
    .where(and(
      eq(calendarPushChannelsTable[scopeColumn], scope),
      inArray(calendarPushChannelsTable.state, states),
    ));

  return rows.map((row) => ({ ...row, state: toPushChannelState(row.state) }));
};

const userTeardownPushChannelStates = (): PushChannelState[] =>
  PUSH_CHANNEL_STATES.filter((state) => state !== STOPPED_STATE);

const teardownResidueCredentialOf = (row: {
  accessToken: string | null;
  expiresAt: Date | null;
  refreshToken: string | null;
}): TeardownResidueCredential | null => {
  if (row.accessToken === null) {
    return null;
  }

  return {
    accessToken: row.accessToken,
    expiresAt: row.expiresAt,
    refreshToken: row.refreshToken,
  };
};

const listUserTeardownPushChannels = async (
  userId: string,
): Promise<TeardownPushChannel[]> => {
  const { database } = await import("@/context");
  const rows = await database
    .select({
      accessToken: oauthCredentialsTable.accessToken,
      expiresAt: oauthCredentialsTable.expiresAt,
      provider: calendarPushChannelsTable.provider,
      providerChannelId: calendarPushChannelsTable.providerChannelId,
      providerResourceId: calendarPushChannelsTable.providerResourceId,
      refreshToken: oauthCredentialsTable.refreshToken,
      userId: calendarPushChannelsTable.userId,
    })
    .from(calendarPushChannelsTable)
    .leftJoin(
      calendarAccountsTable,
      eq(calendarAccountsTable.id, calendarPushChannelsTable.accountId),
    )
    .leftJoin(
      oauthCredentialsTable,
      eq(oauthCredentialsTable.id, calendarAccountsTable.oauthCredentialId),
    )
    .where(and(
      eq(calendarPushChannelsTable.userId, userId),
      inArray(calendarPushChannelsTable.state, userTeardownPushChannelStates()),
    ));

  return rows.map((row) => ({
    credential: teardownResidueCredentialOf(row),
    provider: row.provider,
    providerChannelId: row.providerChannelId,
    providerResourceId: row.providerResourceId,
    userId: row.userId,
  }));
};

const deregisterPushChannelsWithin = async (
  scopeId: string,
  scopeColumn: PushChannelScopeColumn,
  states: PushChannelState[],
  signal: AbortSignal | null,
  requireEveryChannelStopped: boolean,
  concurrency: number,
): Promise<number> => {
  const { database, env, refreshLockStore, webhookConfig } = await import("@/context");
  const credentialsByChannel = new Map<string, TeardownResidueCredential>();

  const readStoredCredentials = async (accountId: string) => {
    const [credentials] = await database
      .select({
        accessToken: oauthCredentialsTable.accessToken,
        calendarAccountId: calendarAccountsTable.id,
        expiresAt: oauthCredentialsTable.expiresAt,
        oauthCredentialId: oauthCredentialsTable.id,
        refreshToken: oauthCredentialsTable.refreshToken,
      })
      .from(calendarAccountsTable)
      .innerJoin(
        oauthCredentialsTable,
        eq(calendarAccountsTable.oauthCredentialId, oauthCredentialsTable.id),
      )
      .where(eq(calendarAccountsTable.id, accountId))
      .limit(1);

    if (!credentials) {
      throw new Error(
        `No OAuth credentials found for push channel account ${accountId}`,
      );
    }

    return credentials;
  };

  const outcome = await runDeregisterPushChannelsOutcome(scopeId, {
    createRegistrarContext: async (channel) => {
      if (webhookConfig === null) {
        throw new Error(
          "Push channel deregistration requires WEBHOOK_PUBLIC_URL to be configured",
        );
      }

      const credentials = await readStoredCredentials(channel.accountId);

      const tokenState: TokenState = {
        accessToken: credentials.accessToken,
        accessTokenExpiresAt: credentials.expiresAt,
        refreshToken: credentials.refreshToken,
      };

      const rawRefresh = resolveTokenRefresher(channel.provider, {
        googleClientId: env.GOOGLE_CLIENT_ID,
        googleClientSecret: env.GOOGLE_CLIENT_SECRET,
        microsoftClientId: env.MICROSOFT_CLIENT_ID,
        microsoftClientSecret: env.MICROSOFT_CLIENT_SECRET,
      });
      if (rawRefresh) {
        await ensureValidToken(tokenState, createCoordinatedRefresher({
          acquireBudgetMs: REFRESH_LOCK_ACQUIRE_BUDGET_MS,
          calendarAccountId: credentials.calendarAccountId,
          database,
          oauthCredentialId: credentials.oauthCredentialId,
          rawRefresh: (refreshToken, refreshOptions) =>
            rawRefresh(refreshToken, refreshOptions?.signal),
          refreshLockStore,
        }));
      }

      credentialsByChannel.set(channel.id, {
        accessToken: tokenState.accessToken,
        expiresAt: tokenState.accessTokenExpiresAt,
        refreshToken: tokenState.refreshToken,
      });

      return {
        accessToken: tokenState.accessToken,
        channelId: channel.providerChannelId,
        fetchImpl: globalThis.fetch,
        notificationUrl: resolveNotificationUrl(channel.provider, webhookConfig),
        now: new Date(),
        requestedExpiresAt: new Date(),
        signal: AbortSignal.timeout(DISCONNECT_TIMEOUT_MS),
      };
    },
    listLiveChannels: (scope) => selectLivePushChannels(database, scopeColumn, scope, states),
    markChannelsStopped: async (channelIds) => {
      await database
        .update(calendarPushChannelsTable)
        .set({
          expiresAt: null,
          lastNotificationAt: null,
          state: STOPPED_STATE,
          verifiedAt: null,
        })
        .where(and(
          eq(calendarPushChannelsTable[scopeColumn], scopeId),
          inArray(calendarPushChannelsTable.id, channelIds),
        ));
    },
    observe: (fields) => {
      widelog.setFields(fields);
    },
    recordError: (error, slug) => {
      widelog.errorFields(error, {
        prefix: DEREGISTRATION_ERROR_PREFIX,
        retriable: false,
        slug,
      });
    },
    resolveRegistrar: resolvePushRegistrar,
    resolveResidueCredential: async (channel) => {
      const dialed = credentialsByChannel.get(channel.id) ?? null;
      if (dialed !== null) {
        return dialed;
      }

      const credentials = await readStoredCredentials(channel.accountId);

      return {
        accessToken: credentials.accessToken,
        expiresAt: credentials.expiresAt,
        refreshToken: credentials.refreshToken,
      };
    },
    webhookConfigured: webhookConfig !== null,
  }, signal, concurrency, true, requireEveryChannelStopped);

  if (requireEveryChannelStopped && outcome.abandonments.length > 0) {
    throw describeAbandonedScope(`${scopeColumn} ${scopeId}`, outcome.abandonments);
  }

  return outcome.deregisteredCount;
};

const deregisterAccountPushChannels = async (accountId: string): Promise<number> =>
  await deregisterPushChannelsWithin(
    accountId,
    "accountId",
    [...LIVE_PUSH_CHANNEL_STATES],
    null,
    false,
    SERIAL_CONCURRENCY,
  );

const deregisterCalendarPushChannels = async (calendarId: string): Promise<number> =>
  await deregisterPushChannelsWithin(
    calendarId,
    "calendarId",
    [...LIVE_PUSH_CHANNEL_STATES],
    null,
    false,
    SERIAL_CONCURRENCY,
  );

const deregisterUserPushChannels = async (
  userId: string,
  signal: AbortSignal | null = null,
): Promise<number> =>
  await deregisterPushChannelsWithin(
    userId,
    "userId",
    userTeardownPushChannelStates(),
    signal,
    true,
    DISCONNECT_CONCURRENCY,
  );

const runDeregisterAccountPushChannels = async (
  accountId: string,
  dependencies: DeregisterPushChannelsDependencies,
  signal: AbortSignal | null = null,
): Promise<number> =>
  await runDeregisterPushChannels(
    accountId,
    dependencies,
    signal,
    SERIAL_CONCURRENCY,
    false,
  );

const runDeregisterUserPushChannels = async (
  userId: string,
  dependencies: DeregisterPushChannelsDependencies,
  signal: AbortSignal | null = null,
): Promise<number> =>
  await runDeregisterPushChannels(
    userId,
    dependencies,
    signal,
    DISCONNECT_CONCURRENCY,
    true,
  );

export {
  AbandonedPushChannelError,
  DEREGISTRATION_FAILED_SLUG,
  RESTATE_FAILED_SLUG,
  deregisterAccountPushChannels,
  deregisterCalendarPushChannels,
  deregisterUserPushChannels,
  listUserTeardownPushChannels,
  runDeregisterAccountPushChannels,
  runDeregisterPushChannels,
  runDeregisterPushChannelsOutcome,
  runDeregisterUserPushChannels,
};
export type {
  AbandonedPushChannel,
  AbandonedPushChannelResidue,
  DeregisterPushChannelsDependencies,
  DeregisterPushChannelsOutcome,
  TeardownPushChannel,
};
