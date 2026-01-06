import type { CronOptions } from "cronbake";
import { createGoogleCalendarSourceProvider } from "@keeper.sh/source-google-calendar";
import { createGoogleOAuthService } from "@keeper.sh/oauth-google";
import { WideEvent, emitWideEvent, runWithWideEvent } from "@keeper.sh/log";
import { database } from "../context";
import { setCronEventFields, withCronWideEvent } from "../utils/with-wide-event";
import env from "@keeper.sh/env/cron";

const syncOAuthSources = async (): Promise<void> => {
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
      });
    } catch (error) {
      event.setError(error);
    } finally {
      emitWideEvent(event.finalize());
    }
  });
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
