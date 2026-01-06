import {
  OAuthSourceProvider,
  createOAuthSourceProvider,
  type FetchEventsResult as BaseFetchEventsResult,
  type OAuthSourceConfig,
  type OAuthTokenProvider,
  type SourceEvent,
  type SourceProvider,
  type SourceSyncResult,
} from "@keeper.sh/provider-core";
import {
  oauthEventStatesTable,
  oauthCalendarSourcesTable,
  oauthCredentialsTable,
  calendarDestinationsTable,
} from "@keeper.sh/database/schema";
import { and, eq, inArray } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { fetchCalendarEvents, parseOutlookEvents } from "./utils/fetch-events";

const OUTLOOK_PROVIDER_ID = "outlook";
const EMPTY_COUNT = 0;

interface OutlookSourceConfig extends OAuthSourceConfig {
  sourceName: string;
  deltaLink: string | null;
}

class OutlookSourceProvider extends OAuthSourceProvider<OutlookSourceConfig> {
  readonly name = "Outlook Calendar";
  readonly providerId = OUTLOOK_PROVIDER_ID;

  protected oauthProvider: OAuthTokenProvider;

  constructor(config: OutlookSourceConfig, oauthProvider: OAuthTokenProvider) {
    super(config);
    this.oauthProvider = oauthProvider;
  }

  async fetchEvents(syncToken: string | null): Promise<BaseFetchEventsResult> {
    const fetchOptions: Parameters<typeof fetchCalendarEvents>[0] = {
      accessToken: this.currentAccessToken,
      calendarId: this.config.externalCalendarId,
    };

    if (syncToken) {
      fetchOptions.deltaLink = syncToken;
    }

    const result = await fetchCalendarEvents(fetchOptions);

    if (result.fullSyncRequired) {
      return { events: [], fullSyncRequired: true };
    }

    const events = parseOutlookEvents(result.events);
    return {
      events,
      fullSyncRequired: false,
      nextSyncToken: result.nextDeltaLink,
    };
  }

  protected async processEvents(
    events: SourceEvent[],
    nextSyncToken?: string,
  ): Promise<SourceSyncResult> {
    const { database, sourceId } = this.config;

    const existingEvents = await database
      .select({
        id: oauthEventStatesTable.id,
        sourceEventUid: oauthEventStatesTable.sourceEventUid,
      })
      .from(oauthEventStatesTable)
      .where(eq(oauthEventStatesTable.oauthSourceId, sourceId));

    const existingUids = new Set(existingEvents.map((event) => event.sourceEventUid));
    const incomingUids = new Set(events.map((event) => event.uid));

    const toAdd = events.filter((event) => !existingUids.has(event.uid));
    const toRemoveUids = existingEvents
      .filter((event) => event.sourceEventUid && !incomingUids.has(event.sourceEventUid))
      .map((event) => event.sourceEventUid)
      .filter((uid): uid is string => uid !== null);

    if (toRemoveUids.length > EMPTY_COUNT) {
      await database
        .delete(oauthEventStatesTable)
        .where(
          and(
            eq(oauthEventStatesTable.oauthSourceId, sourceId),
            inArray(oauthEventStatesTable.sourceEventUid, toRemoveUids),
          ),
        );
    }

    if (toAdd.length > EMPTY_COUNT) {
      await database.insert(oauthEventStatesTable).values(
        toAdd.map((event) => ({
          endTime: event.endTime,
          oauthSourceId: sourceId,
          sourceEventUid: event.uid,
          startTime: event.startTime,
        })),
      );
    }

    if (nextSyncToken) {
      await this.updateSyncToken(nextSyncToken);
    }

    return {
      eventsAdded: toAdd.length,
      eventsRemoved: toRemoveUids.length,
      syncToken: nextSyncToken,
    };
  }
}

interface OutlookSourceAccount {
  sourceId: string;
  userId: string;
  destinationId: string;
  externalCalendarId: string;
  syncToken: string | null;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
  oauthCredentialId: string;
  provider: string;
  sourceName: string;
}

interface CreateOutlookSourceProviderConfig {
  database: BunSQLDatabase;
  oauthProvider: OAuthTokenProvider;
}

const createOutlookSourceProvider = (
  config: CreateOutlookSourceProviderConfig,
): SourceProvider => {
  const { database, oauthProvider } = config;

  return createOAuthSourceProvider<OutlookSourceAccount, OutlookSourceConfig>({
    buildConfig: (db, account) => ({
      accessToken: account.accessToken,
      accessTokenExpiresAt: account.accessTokenExpiresAt,
      database: db,
      deltaLink: account.syncToken,
      destinationId: account.destinationId,
      externalCalendarId: account.externalCalendarId,
      oauthCredentialId: account.oauthCredentialId,
      refreshToken: account.refreshToken,
      sourceId: account.sourceId,
      sourceName: account.sourceName,
      syncToken: account.syncToken,
      userId: account.userId,
    }),
    createProviderInstance: (providerConfig, oauth) =>
      new OutlookSourceProvider(providerConfig, oauth),
    database,
    getAllSources: getOutlookSourcesWithCredentials,
    oauthProvider,
  });
};

const getOutlookSourcesWithCredentials = async (
  database: BunSQLDatabase,
): Promise<OutlookSourceAccount[]> => {
  const sources = await database
    .select({
      accessToken: oauthCredentialsTable.accessToken,
      accessTokenExpiresAt: oauthCredentialsTable.expiresAt,
      destinationId: oauthCalendarSourcesTable.destinationId,
      externalCalendarId: oauthCalendarSourcesTable.externalCalendarId,
      oauthCredentialId: calendarDestinationsTable.oauthCredentialId,
      provider: oauthCalendarSourcesTable.provider,
      refreshToken: oauthCredentialsTable.refreshToken,
      sourceId: oauthCalendarSourcesTable.id,
      sourceName: oauthCalendarSourcesTable.name,
      syncToken: oauthCalendarSourcesTable.syncToken,
      userId: oauthCalendarSourcesTable.userId,
    })
    .from(oauthCalendarSourcesTable)
    .innerJoin(
      calendarDestinationsTable,
      eq(oauthCalendarSourcesTable.destinationId, calendarDestinationsTable.id),
    )
    .innerJoin(
      oauthCredentialsTable,
      eq(calendarDestinationsTable.oauthCredentialId, oauthCredentialsTable.id),
    )
    .where(eq(oauthCalendarSourcesTable.provider, OUTLOOK_PROVIDER_ID));

  return sources.filter(
    (source): source is OutlookSourceAccount => source.oauthCredentialId !== null,
  );
};

export { createOutlookSourceProvider, OutlookSourceProvider };
export type { CreateOutlookSourceProviderConfig, OutlookSourceAccount, OutlookSourceConfig };
