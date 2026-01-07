import type { CronOptions } from "cronbake";
import { createCalDAVSourceProvider } from "@keeper.sh/provider-caldav";
import type { CalDAVSourceProvider } from "@keeper.sh/provider-caldav";
import { createFastMailSourceProvider } from "@keeper.sh/provider-fastmail";
import { createICloudSourceProvider } from "@keeper.sh/provider-icloud";
import { getCalDAVProviders } from "@keeper.sh/provider-registry";
import { WideEvent } from "@keeper.sh/log";
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

interface ProviderSyncResult {
  providerId: string;
  eventsAdded: number;
  eventsRemoved: number;
}

const syncCalDAVSourcesForProvider = async (
  providerName: string,
  providerId: string,
): Promise<ProviderSyncResult | null> => {
  if (!env.ENCRYPTION_KEY) {
    return null;
  }

  const factory = SOURCE_PROVIDER_FACTORIES[providerId];
  if (!factory) {
    return null;
  }

  const provider = factory({
    database,
    encryptionKey: env.ENCRYPTION_KEY,
  });

  const event = WideEvent.grasp();
  const timingKey = `sync_${providerId}`;
  event?.startTiming(timingKey);

  try {
    const result = await provider.syncAllSources();
    return {
      eventsAdded: result.eventsAdded,
      eventsRemoved: result.eventsRemoved,
      providerId,
    };
  } catch (error) {
    event?.addError(error);
    return null;
  } finally {
    event?.endTiming(timingKey);
  }
};

const syncAllCalDAVSources = async (): Promise<void> => {
  const caldavProviders = getCalDAVProviders();
  const results = await Promise.all(
    caldavProviders.map((provider) => syncCalDAVSourcesForProvider(provider.name, provider.id)),
  );

  const event = WideEvent.grasp();
  for (const result of results) {
    if (result) {
      event?.set({
        [`${result.providerId}.events.added`]: result.eventsAdded,
        [`${result.providerId}.events.removed`]: result.eventsRemoved,
      });
    }
  }
};

export default withCronWideEvent({
  async callback() {
    setCronEventFields({ "job.type": "caldav-source-sync" });
    await syncAllCalDAVSources();
  },
  cron: "@every_1_minutes",
  immediate: true,
  name: import.meta.file,
}) satisfies CronOptions;
