import type { CronOptions } from "cronbake";
import { allSettledWithConcurrency, getCalDAVProviders, createGoogleOAuthService, createMicrosoftOAuthService } from "@keeper.sh/calendar";
import { fetchAndSyncSource } from "@keeper.sh/calendar/ics";
import { createGoogleCalendarSourceProvider } from "@keeper.sh/calendar/google";
import { createOutlookSourceProvider } from "@keeper.sh/calendar/outlook";
import { createCalDAVSourceProvider } from "@keeper.sh/calendar/caldav";
import { createFastMailSourceProvider } from "@keeper.sh/calendar/fastmail";
import { createICloudSourceProvider } from "@keeper.sh/calendar/icloud";
import { calendarsTable } from "@keeper.sh/database/schema";
import { eq } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { setCronEventFields, withCronWideEvent } from "@/utils/with-wide-event";
import { widelog } from "@/utils/logging";
import { database, refreshLockStore } from "@/context";
import env from "@/env";

const SOURCE_TIMEOUT_MS = 60_000;
const SOURCE_CONCURRENCY = 5;

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

const ingestOAuthSources = async (): Promise<{ added: number; removed: number; errors: number }> => {
  let added = 0;
  let removed = 0;
  let errors = 0;

  const providers: { name: string; sync: () => Promise<{ eventsAdded: number; eventsRemoved: number }> }[] = [];

  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    const googleClientId = env.GOOGLE_CLIENT_ID;
    const googleClientSecret = env.GOOGLE_CLIENT_SECRET;
    providers.push({
      name: "google",
      sync: async () => {
        const oauthService = createGoogleOAuthService({ clientId: googleClientId, clientSecret: googleClientSecret });
        const sourceProvider = createGoogleCalendarSourceProvider({ database, oauthProvider: oauthService, refreshLockStore });
        const result = await sourceProvider.syncAllSources();
        return { eventsAdded: result.eventsAdded, eventsRemoved: result.eventsRemoved };
      },
    });
  }

  if (env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET) {
    const microsoftClientId = env.MICROSOFT_CLIENT_ID;
    const microsoftClientSecret = env.MICROSOFT_CLIENT_SECRET;
    providers.push({
      name: "outlook",
      sync: async () => {
        const oauthService = createMicrosoftOAuthService({ clientId: microsoftClientId, clientSecret: microsoftClientSecret });
        const sourceProvider = createOutlookSourceProvider({ database, oauthProvider: oauthService, refreshLockStore });
        const result = await sourceProvider.syncAllSources();
        return { eventsAdded: result.eventsAdded, eventsRemoved: result.eventsRemoved };
      },
    });
  }

  const settlements = await Promise.allSettled(
    providers.map((provider) => withTimeout(() => provider.sync(), SOURCE_TIMEOUT_MS)),
  );

  for (const settlement of settlements) {
    if (settlement.status === "fulfilled") {
      added += settlement.value.eventsAdded;
      removed += settlement.value.eventsRemoved;
    } else {
      errors += 1;
      widelog.errorFields(settlement.reason, { prefix: "ingest.oauth" });
    }
  }

  return { added, removed, errors };
};

const ingestCalDAVSources = async (): Promise<{ added: number; removed: number; errors: number }> => {
  if (!env.ENCRYPTION_KEY) {
    return { added: 0, removed: 0, errors: 0 };
  }

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
    const sourceProvider = factory({ database, encryptionKey: env.ENCRYPTION_KEY });
    syncTasks.push(() => sourceProvider.syncAllSources());
  }

  const settlements = await Promise.allSettled(
    syncTasks.map((task) => withTimeout(task, SOURCE_TIMEOUT_MS)),
  );

  let added = 0;
  let removed = 0;
  let errors = 0;

  for (const settlement of settlements) {
    if (settlement.status === "fulfilled") {
      added += settlement.value.eventsAdded;
      removed += settlement.value.eventsRemoved;
    } else {
      errors += 1;
      widelog.errorFields(settlement.reason, { prefix: "ingest.caldav" });
    }
  }

  return { added, removed, errors };
};

const ingestIcsSources = async (): Promise<{ succeeded: number; failed: number }> => {
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

export default withCronWideEvent({
  async callback() {
    setCronEventFields({ "job.type": "ingest-sources" });

    const [oauthSettlement, caldavSettlement, icsSettlement] = await Promise.allSettled([
      ingestOAuthSources(),
      ingestCalDAVSources(),
      ingestIcsSources(),
    ]);

    const oauth = extractSettledResult(oauthSettlement, { added: 0, removed: 0, errors: 1 }, "ingest.oauth");
    const caldav = extractSettledResult(caldavSettlement, { added: 0, removed: 0, errors: 1 }, "ingest.caldav");
    const ics = extractSettledResult(icsSettlement, { succeeded: 0, failed: 1 }, "ingest.ics");

    setCronEventFields({
      "oauth.events.added": oauth.added,
      "oauth.events.removed": oauth.removed,
      "oauth.errors": oauth.errors,
      "caldav.events.added": caldav.added,
      "caldav.events.removed": caldav.removed,
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
