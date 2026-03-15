import type { CronOptions } from "cronbake";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type { RefreshLockStore } from "@keeper.sh/calendar";
import { setCronEventFields, withCronWideEvent } from "@/utils/with-wide-event";
import { widelog } from "@/utils/logging";

const SOURCE_CONCURRENCY = 5;
const SOURCE_TIMEOUT_MS = 60_000;

interface IngestionMetrics {
  eventsAdded: number;
  eventsRemoved: number;
  errors: number;
}

interface IcsMetrics {
  succeeded: number;
  failed: number;
}

const withTimeout = <TResult>(
  operation: () => Promise<TResult>,
  timeoutMs: number,
): Promise<TResult> =>
  Promise.race([
    Promise.resolve().then(operation),
    Bun.sleep(timeoutMs).then((): never => {
      throw new Error(`Source ingestion timed out after ${timeoutMs}ms`);
    }),
  ]);

const extractSettledResult = <TResult>(
  settlement: PromiseSettledResult<TResult>,
  fallback: TResult,
  errorPrefix: string,
): TResult => {
  if (settlement.status === "fulfilled") {
    return settlement.value;
  }
  widelog.errorFields(settlement.reason, { prefix: errorPrefix });
  return fallback;
};

const ingestOAuthSources = async (
  database: BunSQLDatabase,
  refreshLockStore: RefreshLockStore,
  googleClientId: string | undefined,
  googleClientSecret: string | undefined,
  microsoftClientId: string | undefined,
  microsoftClientSecret: string | undefined,
): Promise<IngestionMetrics> => {
  const { createGoogleCalendarSourceProvider } = await import("@keeper.sh/calendar/google");
  const { createOutlookSourceProvider } = await import("@keeper.sh/calendar/outlook");
  const { createGoogleOAuthService, createMicrosoftOAuthService } = await import("@keeper.sh/calendar");

  const syncTasks: (() => Promise<{ eventsAdded: number; eventsRemoved: number }>)[] = [];

  if (googleClientId && googleClientSecret) {
    syncTasks.push(async () => {
      const oauthService = createGoogleOAuthService({ clientId: googleClientId, clientSecret: googleClientSecret });
      const sourceProvider = createGoogleCalendarSourceProvider({ database, oauthProvider: oauthService, refreshLockStore });
      const result = await sourceProvider.syncAllSources();
      return { eventsAdded: result.eventsAdded, eventsRemoved: result.eventsRemoved };
    });
  }

  if (microsoftClientId && microsoftClientSecret) {
    syncTasks.push(async () => {
      const oauthService = createMicrosoftOAuthService({ clientId: microsoftClientId, clientSecret: microsoftClientSecret });
      const sourceProvider = createOutlookSourceProvider({ database, oauthProvider: oauthService, refreshLockStore });
      const result = await sourceProvider.syncAllSources();
      return { eventsAdded: result.eventsAdded, eventsRemoved: result.eventsRemoved };
    });
  }

  const settlements = await Promise.allSettled(
    syncTasks.map((task) => withTimeout(task, SOURCE_TIMEOUT_MS)),
  );

  let eventsAdded = 0;
  let eventsRemoved = 0;
  let errors = 0;

  for (const settlement of settlements) {
    if (settlement.status === "fulfilled") {
      eventsAdded += settlement.value.eventsAdded;
      eventsRemoved += settlement.value.eventsRemoved;
    } else {
      errors += 1;
      widelog.errorFields(settlement.reason, { prefix: "ingest.oauth" });
    }
  }

  return { eventsAdded, eventsRemoved, errors };
};

const ingestCalDAVSources = async (
  database: BunSQLDatabase,
  encryptionKey: string | undefined,
): Promise<IngestionMetrics> => {
  const emptyResult: IngestionMetrics = { eventsAdded: 0, eventsRemoved: 0, errors: 0 };

  if (!encryptionKey) {
    return emptyResult;
  }

  const { createCalDAVSourceProvider } = await import("@keeper.sh/calendar/caldav");
  const { createFastMailSourceProvider } = await import("@keeper.sh/calendar/fastmail");
  const { createICloudSourceProvider } = await import("@keeper.sh/calendar/icloud");
  const { getCalDAVProviders } = await import("@keeper.sh/calendar");

  type ProviderFactory = (config: { database: BunSQLDatabase; encryptionKey: string }) => {
    syncAllSources: () => Promise<{ eventsAdded: number; eventsRemoved: number }>;
  };

  const factories: Record<string, ProviderFactory> = {
    caldav: createCalDAVSourceProvider,
    fastmail: createFastMailSourceProvider,
    icloud: createICloudSourceProvider,
  };

  const caldavProviders = getCalDAVProviders();
  const syncTasks: (() => Promise<{ eventsAdded: number; eventsRemoved: number }>)[] = [];

  for (const provider of caldavProviders) {
    const factory = factories[provider.id];
    if (!factory) {
      continue;
    }
    const sourceProvider = factory({ database, encryptionKey });
    syncTasks.push(() => sourceProvider.syncAllSources());
  }

  const settlements = await Promise.allSettled(
    syncTasks.map((task) => withTimeout(task, SOURCE_TIMEOUT_MS)),
  );

  let eventsAdded = 0;
  let eventsRemoved = 0;
  let errors = 0;

  for (const settlement of settlements) {
    if (settlement.status === "fulfilled") {
      eventsAdded += settlement.value.eventsAdded;
      eventsRemoved += settlement.value.eventsRemoved;
    } else {
      errors += 1;
      widelog.errorFields(settlement.reason, { prefix: "ingest.caldav" });
    }
  }

  return { eventsAdded, eventsRemoved, errors };
};

const ingestIcsSources = async (
  database: BunSQLDatabase,
): Promise<IcsMetrics> => {
  const { calendarsTable } = await import("@keeper.sh/database/schema");
  const { eq } = await import("drizzle-orm");
  const { fetchAndSyncSource } = await import("@keeper.sh/calendar/ics");
  const { allSettledWithConcurrency } = await import("@keeper.sh/calendar");

  const icsSources = await database
    .select()
    .from(calendarsTable)
    .where(eq(calendarsTable.calendarType, "ical"));

  const results = await allSettledWithConcurrency(
    icsSources.map((source) => () =>
      withTimeout(
        () => fetchAndSyncSource(database, source),
        SOURCE_TIMEOUT_MS,
      ),
    ),
    { concurrency: SOURCE_CONCURRENCY },
  );

  let succeeded = 0;
  let failed = 0;

  for (const result of results) {
    if (result.status === "fulfilled") {
      succeeded += 1;
    } else {
      failed += 1;
    }
  }

  return { succeeded, failed };
};

const defaultIngestionFallback: IngestionMetrics = { eventsAdded: 0, eventsRemoved: 0, errors: 1 };
const defaultIcsFallback: IcsMetrics = { succeeded: 0, failed: 1 };

export default withCronWideEvent({
  async callback() {
    setCronEventFields({ "job.type": "ingest-sources" });

    const [{ database, refreshLockStore }, { default: env }] = await Promise.all([
      import("@/context"),
      import("@/env"),
    ]);

    const [oauthSettlement, caldavSettlement, icsSettlement] = await Promise.allSettled([
      ingestOAuthSources(
        database,
        refreshLockStore,
        env.GOOGLE_CLIENT_ID,
        env.GOOGLE_CLIENT_SECRET,
        env.MICROSOFT_CLIENT_ID,
        env.MICROSOFT_CLIENT_SECRET,
      ),
      ingestCalDAVSources(database, env.ENCRYPTION_KEY),
      ingestIcsSources(database),
    ]);

    const oauth = extractSettledResult(oauthSettlement, defaultIngestionFallback, "ingest.oauth");
    const caldav = extractSettledResult(caldavSettlement, defaultIngestionFallback, "ingest.caldav");
    const ics = extractSettledResult(icsSettlement, defaultIcsFallback, "ingest.ics");

    setCronEventFields({
      "oauth.events.added": oauth.eventsAdded,
      "oauth.events.removed": oauth.eventsRemoved,
      "oauth.errors": oauth.errors,
      "caldav.events.added": caldav.eventsAdded,
      "caldav.events.removed": caldav.eventsRemoved,
      "caldav.errors": caldav.errors,
      "ics.succeeded": ics.succeeded,
      "ics.failed": ics.failed,
    });
  },
  cron: "@every_1_minutes",
  immediate: true,
  name: "ingest-sources",
  overrunProtection: false,
}) satisfies CronOptions;
