import type { CronOptions } from "cronbake";
import { createCalDAVSourceProvider } from "@keeper.sh/provider-caldav";
import type { CalDAVSourceProvider } from "@keeper.sh/provider-caldav";
import { createFastMailSourceProvider } from "@keeper.sh/provider-fastmail";
import { createICloudSourceProvider } from "@keeper.sh/provider-icloud";
import { getCalDAVProviders } from "@keeper.sh/provider-registry";
import { WideEvent, emitWideEvent, runWithWideEvent } from "@keeper.sh/log";
import env from "@keeper.sh/env/cron";
import { database } from "../context";
import { setCronEventFields, withCronWideEvent } from "../utils/with-wide-event";

interface SourceProviderConfig {
  database: typeof database;
  encryptionKey: string;
}

type SourceProviderFactory = (config: SourceProviderConfig) => CalDAVSourceProvider;

const SOURCE_PROVIDER_FACTORIES: Record<string, SourceProviderFactory> = {
  caldav: createCalDAVSourceProvider,
  fastmail: createFastMailSourceProvider,
  icloud: createICloudSourceProvider,
};

const syncCalDAVSourcesForProvider = async (
  providerName: string,
  providerId: string,
): Promise<void> => {
  if (!env.ENCRYPTION_KEY) {
    return;
  }

  const factory = SOURCE_PROVIDER_FACTORIES[providerId];
  if (!factory) {
    return;
  }

  const provider = factory({
    database,
    encryptionKey: env.ENCRYPTION_KEY,
  });

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
  const caldavProviders = getCalDAVProviders();
  await Promise.all(
    caldavProviders.map((provider) => syncCalDAVSourcesForProvider(provider.name, provider.id)),
  );
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
