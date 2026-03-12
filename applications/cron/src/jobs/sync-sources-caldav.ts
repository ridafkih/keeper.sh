import type { CronOptions } from "cronbake";
import { createCalDAVSourceProvider } from "@keeper.sh/provider-caldav";
import type { CalDAVSourceProvider } from "@keeper.sh/provider-caldav";
import { createFastMailSourceProvider } from "@keeper.sh/provider-fastmail";
import { createICloudSourceProvider } from "@keeper.sh/provider-icloud";
import { getCalDAVProviders } from "@keeper.sh/provider-registry";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { setCronEventFields, withCronWideEvent } from "../utils/with-wide-event";
import { widelog } from "../utils/logging";

interface SourceProviderConfig {
  database: BunSQLDatabase;
  encryptionKey: string;
}

type SourceProviderFactory = (config: SourceProviderConfig) => CalDAVSourceProvider;

const SOURCE_PROVIDER_FACTORIES: Record<string, SourceProviderFactory> = {
  caldav: createCalDAVSourceProvider,
  fastmail: createFastMailSourceProvider,
  icloud: createICloudSourceProvider,
};

interface CaldavProvider {
  id: string;
  name: string;
}

interface ProviderSyncResult {
  providerId: string;
  eventsAdded: number;
  eventsRemoved: number;
}

interface CaldavSyncJobDependencies {
  providers: CaldavProvider[];
  syncProvider: (provider: CaldavProvider) => Promise<ProviderSyncResult | null>;
  setCronEventFields: (fields: Record<string, unknown>) => void;
}

const runCaldavSourceSyncJob = async (dependencies: CaldavSyncJobDependencies): Promise<void> => {
  const settlements = await Promise.allSettled(
    dependencies.providers.map((provider) =>
      Promise.resolve().then(() => dependencies.syncProvider(provider))),
  );

  for (const settlement of settlements) {
    if (settlement.status !== "fulfilled" || !settlement.value) {
      continue;
    }

    dependencies.setCronEventFields({
      [`${settlement.value.providerId}.events.added`]: settlement.value.eventsAdded,
      [`${settlement.value.providerId}.events.removed`]: settlement.value.eventsRemoved,
    });
  }
};

const createDefaultJobDependencies = async (): Promise<CaldavSyncJobDependencies> => {
  const [{ default: env }, { database }] = await Promise.all([
    import("@keeper.sh/env/cron"),
    import("../context"),
  ]);

  const syncProvider = async (provider: CaldavProvider): Promise<ProviderSyncResult | null> => {
    if (!env.ENCRYPTION_KEY) {
      return null;
    }

    const sourceProviderFactory = SOURCE_PROVIDER_FACTORIES[provider.id];
    if (!sourceProviderFactory) {
      return null;
    }

    const sourceProvider = sourceProviderFactory({
      database,
      encryptionKey: env.ENCRYPTION_KEY,
    });

    const timingKey = `sync_${provider.id}`;
    widelog.time.start(timingKey);

    try {
      const result = await sourceProvider.syncAllSources();
      return {
        eventsAdded: result.eventsAdded,
        eventsRemoved: result.eventsRemoved,
        providerId: provider.id,
      };
    } catch (error) {
      widelog.set(`${provider.id}.error`, true);
      widelog.errorFields(error, { prefix: provider.id });
      return null;
    } finally {
      widelog.time.stop(timingKey);
    }
  };

  return {
    providers: getCalDAVProviders(),
    setCronEventFields,
    syncProvider,
  };
};

export default withCronWideEvent({
  async callback() {
    setCronEventFields({ "job.type": "caldav-source-sync" });
    const dependencies = await createDefaultJobDependencies();
    await runCaldavSourceSyncJob(dependencies);
  },
  cron: "@every_1_minutes",
  immediate: true,
  name: import.meta.file,
}) satisfies CronOptions;

export { runCaldavSourceSyncJob };
