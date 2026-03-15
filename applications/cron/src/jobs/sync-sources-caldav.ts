import type { CronOptions } from "cronbake";
import { createCalDAVSourceProvider } from "@keeper.sh/providers/caldav";
import type { CalDAVSourceProvider } from "@keeper.sh/providers/caldav";
import { createFastMailSourceProvider } from "@keeper.sh/providers/fastmail";
import { createICloudSourceProvider } from "@keeper.sh/providers/icloud";
import { getCalDAVProviders } from "@keeper.sh/providers";
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
  outcome: "success" | "error";
  durationMs: number;
}

interface JobAggregation {
  eventsAdded: number;
  eventsRemoved: number;
  providersFailed: number;
  providersSucceeded: number;
}

interface CaldavSyncJobDependencies {
  providers: CaldavProvider[];
  syncProvider: (provider: CaldavProvider) => Promise<ProviderSyncResult | null>;
  setCronEventFields: (fields: Record<string, unknown>) => void;
}

const invokeProviderSync = (
  dependencies: CaldavSyncJobDependencies,
  provider: CaldavProvider,
): Promise<ProviderSyncResult | null> =>
  Promise.resolve().then(() => dependencies.syncProvider(provider));

const runCaldavSourceSyncJob = async (dependencies: CaldavSyncJobDependencies): Promise<void> => {
  const totals: JobAggregation = {
    eventsAdded: 0,
    eventsRemoved: 0,
    providersFailed: 0,
    providersSucceeded: 0,
  };

  const settlements = await Promise.allSettled(
    dependencies.providers.map((provider) => invokeProviderSync(dependencies, provider)),
  );

  for (const settlement of settlements) {
    if (settlement.status !== "fulfilled" || !settlement.value) {
      totals.providersFailed++;
      continue;
    }

    const providerResult = settlement.value;

    if (providerResult.outcome === "error") {
      totals.providersFailed++;
    } else {
      totals.providersSucceeded++;
      totals.eventsAdded += providerResult.eventsAdded;
      totals.eventsRemoved += providerResult.eventsRemoved;
    }

    widelog.append("provider.id", providerResult.providerId);
    widelog.append("provider.outcome", providerResult.outcome);
    widelog.append("provider.duration_ms", providerResult.durationMs);
    widelog.append("provider.events.added", providerResult.eventsAdded);
    widelog.append("provider.events.removed", providerResult.eventsRemoved);
  }

  dependencies.setCronEventFields({
    "events.added": totals.eventsAdded,
    "events.removed": totals.eventsRemoved,
    "provider.count": dependencies.providers.length,
    "provider.failed_count": totals.providersFailed,
    "provider.succeeded_count": totals.providersSucceeded,
  });
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

    const startedAt = performance.now();

    try {
      const result = await sourceProvider.syncAllSources();
      return {
        durationMs: Math.round(performance.now() - startedAt),
        eventsAdded: result.eventsAdded,
        eventsRemoved: result.eventsRemoved,
        outcome: "success",
        providerId: provider.id,
      };
    } catch (error) {
      widelog.count("provider.error_count");
      widelog.errorFields(error, { prefix: "provider.error" });
      return {
        durationMs: Math.round(performance.now() - startedAt),
        eventsAdded: 0,
        eventsRemoved: 0,
        outcome: "error",
        providerId: provider.id,
      };
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
