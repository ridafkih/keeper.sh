import {
  OAuthSourceProvider,
  createOAuthSourceProvider,
  type FetchEventsResult as BaseFetchEventsResult,
  type OAuthSourceConfig,
  type OAuthTokenProvider,
  type ProcessEventsOptions,
  type SourceEvent,
  type SourceProvider,
  type SourceSyncResult,
} from "@keeper.sh/provider-core";
import {
  calendarSourcesTable,
  eventStatesTable,
  oauthSourceCredentialsTable,
} from "@keeper.sh/database/schema";
import { getStartOfToday } from "@keeper.sh/date-utils";
import { and, eq, inArray, lt, or, gt } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { fetchCalendarEvents, parseGoogleEvents } from "./utils/fetch-events";

const GOOGLE_PROVIDER_ID = "google";
const EMPTY_COUNT = 0;
const YEARS_UNTIL_FUTURE = 2;

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
    } else {
      const today = getStartOfToday();
      const futureDate = new Date(today);
      futureDate.setFullYear(futureDate.getFullYear() + YEARS_UNTIL_FUTURE);
      fetchOptions.timeMin = today;
      fetchOptions.timeMax = futureDate;
    }

    const result = await fetchCalendarEvents(fetchOptions);

    if (result.fullSyncRequired) {
      return { events: [], fullSyncRequired: true };
    }

    const events = parseGoogleEvents(result.events);
    const fetchResult: BaseFetchEventsResult = {
      events,
      fullSyncRequired: false,
      isDeltaSync: result.isDeltaSync,
      nextSyncToken: result.nextSyncToken,
    };

    if (result.cancelledEventUids) {
      fetchResult.cancelledEventUids = result.cancelledEventUids;
    }

    return fetchResult;
  }

  protected async processEvents(
    events: SourceEvent[],
    options: ProcessEventsOptions,
  ): Promise<SourceSyncResult> {
    const { database, sourceId } = this.config;
    const { nextSyncToken, isDeltaSync, cancelledEventUids } = options;

    const needsFullResync = await GoogleCalendarSourceProvider.hasOutOfRangeEvents(database, sourceId);

    if (needsFullResync) {
      await GoogleCalendarSourceProvider.clearSourceAndResetToken(database, sourceId);
      return {
        eventsAdded: EMPTY_COUNT,
        eventsRemoved: EMPTY_COUNT,
        fullSyncRequired: true,
      };
    }

    const existingEvents = await database
      .select({
        id: eventStatesTable.id,
        sourceEventUid: eventStatesTable.sourceEventUid,
      })
      .from(eventStatesTable)
      .where(eq(eventStatesTable.sourceId, sourceId));

    const existingUids = new Set(existingEvents.map((event) => event.sourceEventUid));

    const toAdd = events.filter((event) => !existingUids.has(event.uid));

    const toRemoveUids = GoogleCalendarSourceProvider.calculateEventsToRemove(
      existingEvents,
      events,
      isDeltaSync,
      cancelledEventUids,
    );

    if (toRemoveUids.length > EMPTY_COUNT) {
      await database
        .delete(eventStatesTable)
        .where(
          and(
            eq(eventStatesTable.sourceId, sourceId),
            inArray(eventStatesTable.sourceEventUid, toRemoveUids),
          ),
        );
    }

    if (toAdd.length > EMPTY_COUNT) {
      await database
        .insert(eventStatesTable)
        .values(
          toAdd.map((event) => ({
            endTime: event.endTime,
            sourceEventUid: event.uid,
            sourceId,
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

  private static async hasOutOfRangeEvents(
    database: BunSQLDatabase,
    sourceId: string,
  ): Promise<boolean> {
    const today = getStartOfToday();
    const futureDate = new Date(today);
    futureDate.setFullYear(futureDate.getFullYear() + YEARS_UNTIL_FUTURE);

    const outOfRange = await database
      .select({ id: eventStatesTable.id })
      .from(eventStatesTable)
      .where(
        and(
          eq(eventStatesTable.sourceId, sourceId),
          or(
            lt(eventStatesTable.endTime, today),
            gt(eventStatesTable.startTime, futureDate),
          ),
        ),
      )
      .limit(1);

    return outOfRange.length > EMPTY_COUNT;
  }

  private static async clearSourceAndResetToken(
    database: BunSQLDatabase,
    sourceId: string,
  ): Promise<void> {
    await database
      .delete(eventStatesTable)
      .where(eq(eventStatesTable.sourceId, sourceId));

    await database
      .update(calendarSourcesTable)
      .set({ syncToken: null })
      .where(eq(calendarSourcesTable.id, sourceId));
  }

  private static calculateEventsToRemove(
    existingEvents: { id: string; sourceEventUid: string | null }[],
    incomingEvents: SourceEvent[],
    isDeltaSync?: boolean,
    cancelledEventUids?: string[],
  ): string[] {
    if (isDeltaSync) {
      if (!cancelledEventUids || cancelledEventUids.length === EMPTY_COUNT) {
        return [];
      }
      const existingUidSet = new Set(
        existingEvents
          .map((event) => event.sourceEventUid)
          .filter((uid): uid is string => uid !== null),
      );
      return cancelledEventUids.filter((uid) => existingUidSet.has(uid));
    }

    const incomingUids = new Set(incomingEvents.map((event) => event.uid));
    return existingEvents
      .filter((event) => event.sourceEventUid && !incomingUids.has(event.sourceEventUid))
      .map((event) => event.sourceEventUid)
      .filter((uid): uid is string => uid !== null);
  }
}

interface GoogleSourceAccount {
  sourceId: string;
  userId: string;
  externalCalendarId: string;
  syncToken: string | null;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
  credentialId: string;
  oauthCredentialId?: string;
  oauthSourceCredentialId?: string;
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
      externalCalendarId: account.externalCalendarId,
      oauthCredentialId: account.oauthCredentialId,
      oauthSourceCredentialId: account.oauthSourceCredentialId,
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
  const sources = await database
    .select({
      accessToken: oauthSourceCredentialsTable.accessToken,
      accessTokenExpiresAt: oauthSourceCredentialsTable.expiresAt,
      credentialId: oauthSourceCredentialsTable.id,
      externalCalendarId: calendarSourcesTable.externalCalendarId,
      oauthSourceCredentialId: oauthSourceCredentialsTable.id,
      provider: calendarSourcesTable.provider,
      refreshToken: oauthSourceCredentialsTable.refreshToken,
      sourceId: calendarSourcesTable.id,
      sourceName: calendarSourcesTable.name,
      syncToken: calendarSourcesTable.syncToken,
      userId: calendarSourcesTable.userId,
    })
    .from(calendarSourcesTable)
    .innerJoin(
      oauthSourceCredentialsTable,
      eq(calendarSourcesTable.oauthCredentialId, oauthSourceCredentialsTable.id),
    )
    .where(
      and(
        eq(calendarSourcesTable.sourceType, "oauth"),
        eq(calendarSourcesTable.provider, GOOGLE_PROVIDER_ID),
      ),
    );

  return sources.map((source) => {
    if (!source.externalCalendarId) {
      throw new Error(`Google source ${source.sourceId} is missing externalCalendarId`);
    }
    if (!source.provider) {
      throw new Error(`Google source ${source.sourceId} is missing provider`);
    }
    return {
      ...source,
      externalCalendarId: source.externalCalendarId,
      provider: source.provider,
    };
  });
};

export { createGoogleCalendarSourceProvider, GoogleCalendarSourceProvider };
export type { CreateGoogleSourceProviderConfig, GoogleSourceAccount, GoogleSourceConfig };
