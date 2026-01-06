import type { CronOptions } from "cronbake";
import { createGoogleCalendarSourceProvider } from "@keeper.sh/provider-google-calendar";
import { createOutlookSourceProvider } from "@keeper.sh/provider-outlook";
import { createGoogleOAuthService } from "@keeper.sh/oauth-google";
import { createMicrosoftOAuthService } from "@keeper.sh/oauth-microsoft";
import { WideEvent, emitWideEvent, runWithWideEvent } from "@keeper.sh/log";
import { database } from "../context";
import { setCronEventFields, withCronWideEvent } from "../utils/with-wide-event";
import env from "@keeper.sh/env/cron";

const syncGoogleSources = async (): Promise<void> => {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return;
  }

  const googleOAuth = createGoogleOAuthService({
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
  });

  const googleSourceProvider = createGoogleCalendarSourceProvider({
    database,
    oauthProvider: googleOAuth,
  });

  const event = new WideEvent("cron");
  event.set({
    operationName: "sync-oauth-sources",
    operationType: "oauth-source-sync",
    provider: "google",
  });

  await runWithWideEvent(event, async () => {
    try {
      const result = await googleSourceProvider.syncAllSources();
      event.set({
        eventsAdded: result.eventsAdded,
        eventsRemoved: result.eventsRemoved,
        sourceSyncErrors: result.errors?.length ?? 0,
      });
      if (result.errors && result.errors.length > 0) {
        for (const error of result.errors) {
          event.setError(error);
        }
      }
    } catch (error) {
      event.setError(error);
    } finally {
      emitWideEvent(event.finalize());
    }
  });
};

const syncOutlookSources = async (): Promise<void> => {
  if (!env.MICROSOFT_CLIENT_ID || !env.MICROSOFT_CLIENT_SECRET) {
    return;
  }

  const microsoftOAuth = createMicrosoftOAuthService({
    clientId: env.MICROSOFT_CLIENT_ID,
    clientSecret: env.MICROSOFT_CLIENT_SECRET,
  });

  const outlookSourceProvider = createOutlookSourceProvider({
    database,
    oauthProvider: microsoftOAuth,
  });

  const event = new WideEvent("cron");
  event.set({
    operationName: "sync-oauth-sources",
    operationType: "oauth-source-sync",
    provider: "outlook",
  });

  await runWithWideEvent(event, async () => {
    try {
      const result = await outlookSourceProvider.syncAllSources();
      event.set({
        eventsAdded: result.eventsAdded,
        eventsRemoved: result.eventsRemoved,
        sourceSyncErrors: result.errors?.length ?? 0,
      });
      if (result.errors && result.errors.length > 0) {
        for (const error of result.errors) {
          event.setError(error);
        }
      }
    } catch (error) {
      event.setError(error);
    } finally {
      emitWideEvent(event.finalize());
    }
  });
};

const syncOAuthSources = async (): Promise<void> => {
  await Promise.all([syncGoogleSources(), syncOutlookSources()]);
};

export default withCronWideEvent({
  async callback() {
    setCronEventFields({ jobType: "oauth-source-sync" });
    await syncOAuthSources();
  },
  cron: "@every_1_minutes",
  immediate: true,
  name: import.meta.file,
}) satisfies CronOptions;
