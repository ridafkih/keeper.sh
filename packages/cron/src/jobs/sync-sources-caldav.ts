import type { CronOptions } from "cronbake";
import { createCalDAVSourceProvider } from "@keeper.sh/provider-caldav";
import { createFastMailSourceProvider } from "@keeper.sh/provider-fastmail";
import { createICloudSourceProvider } from "@keeper.sh/provider-icloud";
import { WideEvent, emitWideEvent, runWithWideEvent } from "@keeper.sh/log";
import env from "@keeper.sh/env/cron";
import { database } from "../context";
import { setCronEventFields, withCronWideEvent } from "../utils/with-wide-event";

const syncCalDAVSourcesForProvider = async (
  providerName: string,
  providerId: string,
): Promise<void> => {
  if (!env.ENCRYPTION_KEY) {
    return;
  }

  const providerConfig = {
    database,
    encryptionKey: env.ENCRYPTION_KEY,
  };

  const createProvider = (): ReturnType<typeof createCalDAVSourceProvider> => {
    switch (providerId) {
      case "fastmail": {
        return createFastMailSourceProvider(providerConfig);
      }
      case "icloud": {
        return createICloudSourceProvider(providerConfig);
      }
      default: {
        return createCalDAVSourceProvider(providerConfig);
      }
    }
  };

  const provider = createProvider();

  const event = new WideEvent("cron");
  event.set({
    operationName: "sync-caldav-sources",
    operationType: "caldav-source-sync",
    provider: providerName,
  });

  await runWithWideEvent(event, async () => {
    try {
      const result = await provider.syncAllSources();
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

const syncAllCalDAVSources = async (): Promise<void> => {
  await Promise.all([
    syncCalDAVSourcesForProvider("CalDAV", "caldav"),
    syncCalDAVSourcesForProvider("FastMail", "fastmail"),
    syncCalDAVSourcesForProvider("iCloud", "icloud"),
  ]);
};

export default withCronWideEvent({
  async callback() {
    setCronEventFields({ jobType: "caldav-source-sync" });
    await syncAllCalDAVSources();
  },
  cron: "@every_1_minutes",
  immediate: true,
  name: import.meta.file,
}) satisfies CronOptions;
