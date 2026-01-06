import {
  OAuthSourceProvider,
  createOAuthSourceProvider,
  type FetchEventsResult as BaseFetchEventsResult,
  type OAuthSourceConfig,
  type OAuthTokenProvider,
  type SourceEvent,
  type SourceProvider,
  type SourceSyncResult,
} from "@keeper.sh/integration";
import { oauthEventStatesTable, oauthCalendarSourcesTable } from "@keeper.sh/database/schema";
import { and, eq, inArray } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { fetchCalendarEvents, parseGoogleEvents } from "./fetch-events";

const GOOGLE_PROVIDER_ID = "google";
const EMPTY_COUNT = 0;

interface GoogleSourceConfig extends OAuthSourceConfig {
  sourceName: string;
}

class GoogleCalendarSourceProvider extends OAuthSourceProvider<GoogleSourceConfig> {
  readonly name = "Google Calendar";
  readonly providerId = GOOGLE_PROVIDER_ID;

  protected oauthProvider: OAuthTokenProvider;

  constructor(config: GoogleSourceConfig, oauthProvider: OAuthTokenProvider) {
    super(config);
    this.oauthProvider = oauthProvider;
  }

  async fetchEvents(syncToken: string | null): Promise<BaseFetchEventsResult> {
    const fetchOptions: Parameters<typeof fetchCalendarEvents>[0] = {
      accessToken: this.currentAccessToken,
      calendarId: this.config.externalCalendarId,
    };

    if (syncToken) {
      fetchOptions.syncToken = syncToken;
    }

    const result = await fetchCalendarEvents(fetchOptions);

    if (result.fullSyncRequired) {
      return { events: [], fullSyncRequired: true };
    }

    const events = parseGoogleEvents(result.events);
    return {
      events,
      fullSyncRequired: false,
      nextSyncToken: result.nextSyncToken,
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

interface GoogleSourceAccount {
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

interface CreateGoogleSourceProviderConfig {
  database: BunSQLDatabase;
  oauthProvider: OAuthTokenProvider;
}

const createGoogleCalendarSourceProvider = (
  config: CreateGoogleSourceProviderConfig,
): SourceProvider => {
  const { database, oauthProvider } = config;

  return createOAuthSourceProvider<GoogleSourceAccount, GoogleSourceConfig>({
    buildConfig: (db, account) => ({
      accessToken: account.accessToken,
      accessTokenExpiresAt: account.accessTokenExpiresAt,
      database: db,
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
      new GoogleCalendarSourceProvider(providerConfig, oauth),
    database,
    getAllSources: getGoogleSourcesWithCredentials,
    oauthProvider,
  });
};

const getGoogleSourcesWithCredentials = async (
  database: BunSQLDatabase,
): Promise<GoogleSourceAccount[]> => {
  const { oauthCredentialsTable, calendarDestinationsTable } = await import(
    "@keeper.sh/database/schema"
  );

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
    .where(eq(oauthCalendarSourcesTable.provider, GOOGLE_PROVIDER_ID));

  return sources.filter(
    (source): source is GoogleSourceAccount => source.oauthCredentialId !== null,
  );
};

export { createGoogleCalendarSourceProvider, GoogleCalendarSourceProvider };
export type { CreateGoogleSourceProviderConfig, GoogleSourceAccount, GoogleSourceConfig };
