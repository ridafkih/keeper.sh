import type { CronOptions } from "cronbake";
import { createGoogleCalendarSourceProvider } from "@keeper.sh/provider-google-calendar";
import { createOutlookSourceProvider } from "@keeper.sh/provider-outlook";
import { createGoogleOAuthService } from "@keeper.sh/oauth-google";
import { createMicrosoftOAuthService } from "@keeper.sh/oauth-microsoft";
import { setCronEventFields, withCronWideEvent } from "../utils/with-wide-event";
import { endTiming, reportError, startTiming } from "../utils/logging";

interface ProviderSyncResult {
  eventsAdded: number;
  eventsRemoved: number;
  errorCount: number;
  errorMessages: string[];
  errorDetails: Record<string, { count: number; messages: string[] }>;
}

interface OAuthSyncJobDependencies {
  syncGoogleSources: () => Promise<ProviderSyncResult | null>;
  syncOutlookSources: () => Promise<ProviderSyncResult | null>;
  setCronEventFields: (fields: Record<string, unknown>) => void;
  reportError?: (error: unknown, fields?: Record<string, unknown>) => void;
}

const deduplicateMessages = (messages: string[]): string[] => [...new Set(messages)];

const publishProviderMetrics = (
  provider: "google" | "outlook",
  result: ProviderSyncResult,
  dependencies: OAuthSyncJobDependencies,
): void => {
  const fields: Record<string, unknown> = {
    [`${provider}.error.count`]: result.errorCount,
    [`${provider}.events.added`]: result.eventsAdded,
    [`${provider}.events.removed`]: result.eventsRemoved,
  };

  const errorMessages = deduplicateMessages(result.errorMessages);

  if (errorMessages.length > 0) {
    fields[`${provider}.error.messages`] = errorMessages;
  }

  for (const [errorType, details] of Object.entries(result.errorDetails)) {
    fields[`${provider}.error.${errorType}.count`] = details.count;
    const detailMessages = deduplicateMessages(details.messages);
    if (detailMessages.length > 0) {
      fields[`${provider}.error.${errorType}.messages`] = detailMessages;
    }
  }

  dependencies.setCronEventFields(fields);
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
  const settlements = await Promise.allSettled([
    Promise.resolve().then(() => dependencies.syncGoogleSources()),
    Promise.resolve().then(() => dependencies.syncOutlookSources()),
  ]);

  const [googleSettlement, outlookSettlement] = settlements;

  if (googleSettlement?.status === "fulfilled" && googleSettlement.value) {
    publishProviderMetrics("google", googleSettlement.value, dependencies);
  } else if (googleSettlement?.status === "rejected") {
    dependencies.reportError?.(googleSettlement.reason, {
      "operation.name": "oauth-source-sync:google",
      "source.provider": "google",
    });
  }

  if (outlookSettlement?.status === "fulfilled" && outlookSettlement.value) {
    publishProviderMetrics("outlook", outlookSettlement.value, dependencies);
  } else if (outlookSettlement?.status === "rejected") {
    dependencies.reportError?.(outlookSettlement.reason, {
      "operation.name": "oauth-source-sync:outlook",
      "source.provider": "outlook",
    });
  }
};

const createDefaultJobDependencies = async (): Promise<OAuthSyncJobDependencies> => {
  const [{ default: env }, { database }] = await Promise.all([
    import("@keeper.sh/env/cron"),
    import("../context"),
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
    });

    startTiming("syncGoogleSources");

    try {
      const result = await googleSourceProvider.syncAllSources();
      const errorSummary = summarizeProviderErrors(result.errors);

      return {
        ...errorSummary,
        eventsAdded: result.eventsAdded,
        eventsRemoved: result.eventsRemoved,
      };
    } catch (error) {
      reportError(error, {
        "operation.name": "oauth-source-sync:google",
        "source.provider": "google",
      });
      return null;
    } finally {
      endTiming("syncGoogleSources");
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
    });

    startTiming("syncOutlookSources");

    try {
      const result = await outlookSourceProvider.syncAllSources();
      const errorSummary = summarizeProviderErrors(result.errors);

      return {
        ...errorSummary,
        eventsAdded: result.eventsAdded,
        eventsRemoved: result.eventsRemoved,
      };
    } catch (error) {
      reportError(error, {
        "operation.name": "oauth-source-sync:outlook",
        "source.provider": "outlook",
      });
      return null;
    } finally {
      endTiming("syncOutlookSources");
    }
  };

  return {
    reportError,
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
