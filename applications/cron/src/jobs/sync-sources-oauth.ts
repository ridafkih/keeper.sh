import type { CronOptions } from "cronbake";
import { createGoogleCalendarSourceProvider } from "@keeper.sh/provider-google-calendar";
import { createOutlookSourceProvider } from "@keeper.sh/provider-outlook";
import { createGoogleOAuthService } from "@keeper.sh/oauth-google";
import { createMicrosoftOAuthService } from "@keeper.sh/oauth-microsoft";
import { WideEvent } from "@keeper.sh/log";
import { database } from "../context";
import { setCronEventFields, withCronWideEvent } from "../utils/with-wide-event";
import env from "@keeper.sh/env/cron";

interface ProviderSyncResult {
  eventsAdded: number;
  eventsRemoved: number;
  errorCount: number;
}

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

  const event = WideEvent.grasp();
  event?.startTiming("syncGoogleSources");

  try {
    const result = await googleSourceProvider.syncAllSources();
    return {
      errorCount: result.errors?.length ?? 0,
      eventsAdded: result.eventsAdded,
      eventsRemoved: result.eventsRemoved,
    };
  } catch (error) {
    event?.addError(error);
    return null;
  } finally {
    event?.endTiming("syncGoogleSources");
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

  const event = WideEvent.grasp();
  event?.startTiming("syncOutlookSources");

  try {
    const result = await outlookSourceProvider.syncAllSources();
    return {
      errorCount: result.errors?.length ?? 0,
      eventsAdded: result.eventsAdded,
      eventsRemoved: result.eventsRemoved,
    };
  } catch (error) {
    event?.addError(error);
    return null;
  } finally {
    event?.endTiming("syncOutlookSources");
  }
};

const syncOAuthSources = async (): Promise<void> => {
  const [googleResult, outlookResult] = await Promise.all([
    syncGoogleSources(),
    syncOutlookSources(),
  ]);

  const event = WideEvent.grasp();
  if (googleResult) {
    event?.set({
      "google.events.added": googleResult.eventsAdded,
      "google.events.removed": googleResult.eventsRemoved,
      "google.error.count": googleResult.errorCount,
    });
  }
  if (outlookResult) {
    event?.set({
      "outlook.events.added": outlookResult.eventsAdded,
      "outlook.events.removed": outlookResult.eventsRemoved,
      "outlook.error.count": outlookResult.errorCount,
    });
  }
};

export default withCronWideEvent({
  async callback() {
    setCronEventFields({ "job.type": "oauth-source-sync" });
    await syncOAuthSources();
  },
  cron: "@every_1_minutes",
  immediate: true,
  name: import.meta.file,
}) satisfies CronOptions;
