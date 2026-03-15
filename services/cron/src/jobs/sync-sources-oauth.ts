import type { CronOptions } from "cronbake";
import { createGoogleCalendarSourceProvider } from "@keeper.sh/calendar/google";
import { createOutlookSourceProvider } from "@keeper.sh/calendar/outlook";
import { createGoogleOAuthService } from "@keeper.sh/calendar";
import { createMicrosoftOAuthService } from "@keeper.sh/calendar";
import { setCronEventFields, withCronWideEvent } from "@/utils/with-wide-event";
import { widelog } from "@/utils/logging";

interface ProviderSyncResult {
  eventsAdded: number;
  eventsRemoved: number;
  eventsInserted?: number;
  eventsUpdated?: number;
  eventsFilteredOutOfWindow?: number;
  syncTokenResetCount?: number;
  errorCount: number;
  errorMessages: string[];
  errorDetails: Record<string, { count: number; messages: string[] }>;
}

interface OAuthSyncJobDependencies {
  syncGoogleSources: () => Promise<ProviderSyncResult | null>;
  syncOutlookSources: () => Promise<ProviderSyncResult | null>;
  setCronEventFields: (fields: Record<string, unknown>) => void;
}

const deduplicateMessages = (messages: string[]): string[] => [...new Set(messages)];

const invokeProviderSync = (
  operation: () => Promise<ProviderSyncResult | null>,
): Promise<ProviderSyncResult | null> => Promise.resolve().then(operation);

const publishProviderMetrics = (
  provider: "google" | "outlook",
  result: ProviderSyncResult,
): void => {
  const errorMessages = deduplicateMessages(result.errorMessages);

  widelog.append("provider.id", provider);
  widelog.append("provider.error.count", result.errorCount);
  widelog.append("provider.events.added", result.eventsAdded);
  widelog.append("provider.events.filtered_out_of_window", result.eventsFilteredOutOfWindow ?? 0);
  widelog.append("provider.events.inserted", result.eventsInserted ?? 0);
  widelog.append("provider.events.removed", result.eventsRemoved);
  widelog.append("provider.events.updated", result.eventsUpdated ?? 0);
  widelog.append("provider.sync_token.reset_count", result.syncTokenResetCount ?? 0);

  for (const message of errorMessages) {
    widelog.append("provider.error.message", message);
  }

  for (const [type, details] of Object.entries(result.errorDetails)) {
    widelog.append("provider.error.type", type);
    widelog.append("provider.error.type_count", details.count);
    const deduplicatedTypeMessages = deduplicateMessages(details.messages);
    for (const message of deduplicatedTypeMessages) {
      widelog.append("provider.error.type_message", `${type}: ${message}`);
    }
  }
};

const summarizeProviderErrors = (
  errors: Error[] | undefined,
): Pick<ProviderSyncResult, "errorCount" | "errorMessages" | "errorDetails"> => {
  const providerErrors = errors ?? [];
  const errorDetails: Record<string, { count: number; messages: string[] }> = {};
  const errorMessages: string[] = [];

  for (const error of providerErrors) {
    let errorType = "Error";

    if (typeof error.constructor?.name === "string" && error.constructor.name.length > 0) {
      errorType = error.constructor.name;
    }

    const existingDetails = errorDetails[errorType] ?? { count: 0, messages: [] };
    existingDetails.count += 1;
    if (!existingDetails.messages.includes(error.message)) {
      existingDetails.messages.push(error.message);
    }
    errorDetails[errorType] = existingDetails;

    if (!errorMessages.includes(error.message)) {
      errorMessages.push(error.message);
    }
  }

  return {
    errorCount: providerErrors.length,
    errorDetails,
    errorMessages,
  };
};

const runOAuthSourceSyncJob = async (dependencies: OAuthSyncJobDependencies): Promise<void> => {
  let eventsAdded = 0;
  let eventsRemoved = 0;
  let eventsInserted = 0;
  let eventsUpdated = 0;
  let eventsFilteredOutOfWindow = 0;
  let syncTokenResetCount = 0;
  let providerErrorCount = 0;
  let providersSucceeded = 0;
  let providersFailed = 0;

  const settlements = await Promise.allSettled([
    invokeProviderSync(() => dependencies.syncGoogleSources()),
    invokeProviderSync(() => dependencies.syncOutlookSources()),
  ]);

  const [googleSettlement, outlookSettlement] = settlements;

  if (googleSettlement?.status === "fulfilled" && googleSettlement.value) {
    publishProviderMetrics("google", googleSettlement.value);
    eventsAdded += googleSettlement.value.eventsAdded;
    eventsRemoved += googleSettlement.value.eventsRemoved;
    eventsInserted += googleSettlement.value.eventsInserted ?? 0;
    eventsUpdated += googleSettlement.value.eventsUpdated ?? 0;
    eventsFilteredOutOfWindow += googleSettlement.value.eventsFilteredOutOfWindow ?? 0;
    syncTokenResetCount += googleSettlement.value.syncTokenResetCount ?? 0;
    providerErrorCount += googleSettlement.value.errorCount;
    providersSucceeded += 1;
  } else {
    providersFailed += 1;
  }

  if (outlookSettlement?.status === "fulfilled" && outlookSettlement.value) {
    publishProviderMetrics("outlook", outlookSettlement.value);
    eventsAdded += outlookSettlement.value.eventsAdded;
    eventsRemoved += outlookSettlement.value.eventsRemoved;
    eventsInserted += outlookSettlement.value.eventsInserted ?? 0;
    eventsUpdated += outlookSettlement.value.eventsUpdated ?? 0;
    eventsFilteredOutOfWindow += outlookSettlement.value.eventsFilteredOutOfWindow ?? 0;
    syncTokenResetCount += outlookSettlement.value.syncTokenResetCount ?? 0;
    providerErrorCount += outlookSettlement.value.errorCount;
    providersSucceeded += 1;
  } else {
    providersFailed += 1;
  }

  dependencies.setCronEventFields({
    "events.added": eventsAdded,
    "events.filtered_out_of_window": eventsFilteredOutOfWindow,
    "events.inserted": eventsInserted,
    "events.removed": eventsRemoved,
    "events.updated": eventsUpdated,
    "provider.count": 2,
    "provider.error_count": providerErrorCount,
    "provider.failed_count": providersFailed,
    "provider.succeeded_count": providersSucceeded,
    "sync_token.reset_count": syncTokenResetCount,
  });
};

const createDefaultJobDependencies = async (): Promise<OAuthSyncJobDependencies> => {
  const [{ default: env }, { database, refreshLockStore }] = await Promise.all([
    import("@/env"),
    import("@/context"),
  ]);

  const syncGoogleSources = async (): Promise<ProviderSyncResult | null> => {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
      return null;
    }

    const googleOAuth = createGoogleOAuthService({
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    });

    const googleSourceProvider = createGoogleCalendarSourceProvider({
      database,
      oauthProvider: googleOAuth,
      refreshLockStore,
    });

    try {
      const result = await widelog.time.measure("sync.google.duration_ms", () =>
        googleSourceProvider.syncAllSources(),
      );
      const errorSummary = summarizeProviderErrors(result.errors);

      return {
        ...errorSummary,
        eventsAdded: result.eventsAdded,
        eventsFilteredOutOfWindow: result.eventsFilteredOutOfWindow,
        eventsInserted: result.eventsInserted,
        eventsRemoved: result.eventsRemoved,
        eventsUpdated: result.eventsUpdated,
        syncTokenResetCount: result.syncTokenResetCount,
      };
    } catch (error) {
      widelog.count("provider.error_count");
      widelog.errorFields(error, { prefix: "provider.error" });
      return null;
    }
  };

  const syncOutlookSources = async (): Promise<ProviderSyncResult | null> => {
    if (!env.MICROSOFT_CLIENT_ID || !env.MICROSOFT_CLIENT_SECRET) {
      return null;
    }

    const microsoftOAuth = createMicrosoftOAuthService({
      clientId: env.MICROSOFT_CLIENT_ID,
      clientSecret: env.MICROSOFT_CLIENT_SECRET,
    });

    const outlookSourceProvider = createOutlookSourceProvider({
      database,
      oauthProvider: microsoftOAuth,
      refreshLockStore,
    });

    try {
      const result = await widelog.time.measure("sync.outlook.duration_ms", () =>
        outlookSourceProvider.syncAllSources(),
      );
      const errorSummary = summarizeProviderErrors(result.errors);

      return {
        ...errorSummary,
        eventsAdded: result.eventsAdded,
        eventsFilteredOutOfWindow: result.eventsFilteredOutOfWindow,
        eventsInserted: result.eventsInserted,
        eventsRemoved: result.eventsRemoved,
        eventsUpdated: result.eventsUpdated,
        syncTokenResetCount: result.syncTokenResetCount,
      };
    } catch (error) {
      widelog.count("provider.error_count");
      widelog.errorFields(error, { prefix: "provider.error" });
      return null;
    }
  };

  return {
    setCronEventFields,
    syncGoogleSources,
    syncOutlookSources,
  };
};

export default withCronWideEvent({
  async callback() {
    setCronEventFields({ "job.type": "oauth-source-sync" });
    const dependencies = await createDefaultJobDependencies();
    await runOAuthSourceSyncJob(dependencies);
  },
  cron: "@every_1_minutes",
  immediate: true,
  name: import.meta.file,
}) satisfies CronOptions;

export { runOAuthSourceSyncJob };
