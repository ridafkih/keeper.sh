import {
  buildSourceEventStateIdsToRemove,
  buildSourceEventsToAdd,
  OAuthSourceProvider,
  createOAuthSourceProvider,
  encodeStoredSyncToken,
  getOAuthSyncWindow,
  OAUTH_SYNC_WINDOW_VERSION,
  resolveSyncTokenForWindow,
  type FetchEventsResult as BaseFetchEventsResult,
  type OAuthSourceConfig,
  type OAuthTokenProvider,
  type ProcessEventsOptions,
  type SourceEvent,
  type SourceProvider,
  type SourceSyncResult,
} from "@keeper.sh/provider-core";
import {
  calendarAccountsTable,
  calendarsTable,
  eventStatesTable,
  oauthCredentialsTable,
} from "@keeper.sh/database/schema";
import { and, arrayContains, eq, gt, inArray, lt, or } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { fetchCalendarEvents, fetchCalendarName, parseOutlookEvents } from "./utils/fetch-events";

const OUTLOOK_PROVIDER_ID = "outlook";
const EMPTY_COUNT = 0;

const stringifyIfPresent = (value: unknown) => {
  if (!value) {
    return;
  }
  return JSON.stringify(value);
};
const YEARS_UNTIL_FUTURE = 2;

interface OutlookSourceConfig extends OAuthSourceConfig {
  originalName: string | null;
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
    await this.refreshOriginalName();

    const fetchOptions: Parameters<typeof fetchCalendarEvents>[0] = {
      accessToken: this.currentAccessToken,
      calendarId: this.config.externalCalendarId,
    };
    const syncTokenResolution = resolveSyncTokenForWindow(
      syncToken,
      OAUTH_SYNC_WINDOW_VERSION,
    );

    if (syncTokenResolution.requiresBackfill && syncToken !== null) {
      await this.clearSyncToken();
    }

    if (syncTokenResolution.syncToken === null) {
      const syncWindow = getOAuthSyncWindow(YEARS_UNTIL_FUTURE);
      fetchOptions.timeMin = syncWindow.timeMin;
      fetchOptions.timeMax = syncWindow.timeMax;
    } else {
      fetchOptions.deltaLink = syncTokenResolution.syncToken;
    }

    const result = await fetchCalendarEvents(fetchOptions);

    if (result.fullSyncRequired) {
      return { events: [], fullSyncRequired: true };
    }

    const events = parseOutlookEvents(result.events);
    const fetchResult: BaseFetchEventsResult = {
      events,
      fullSyncRequired: false,
      isDeltaSync: result.isDeltaSync,
      nextSyncToken: result.nextDeltaLink,
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
    const { database, calendarId } = this.config;
    const { nextSyncToken, isDeltaSync, cancelledEventUids } = options;

    const needsFullResync = await OutlookSourceProvider.hasOutOfRangeEvents(database, calendarId);

    if (needsFullResync) {
      await OutlookSourceProvider.clearSourceAndResetToken(database, calendarId);
      return {
        eventsAdded: EMPTY_COUNT,
        eventsRemoved: EMPTY_COUNT,
        fullSyncRequired: true,
      };
    }

    const existingEvents = await database
      .select({
        id: eventStatesTable.id,
        endTime: eventStatesTable.endTime,
        sourceEventUid: eventStatesTable.sourceEventUid,
        startTime: eventStatesTable.startTime,
      })
      .from(eventStatesTable)
      .where(eq(eventStatesTable.calendarId, calendarId));

    const eventsToAdd = buildSourceEventsToAdd(existingEvents, events);
    const eventStateIdsToRemove = buildSourceEventStateIdsToRemove(
      existingEvents,
      events,
      { cancelledEventUids, isDeltaSync },
    );

    if (eventStateIdsToRemove.length > EMPTY_COUNT) {
      await database
        .delete(eventStatesTable)
        .where(
          and(
            eq(eventStatesTable.calendarId, calendarId),
            inArray(eventStatesTable.id, eventStateIdsToRemove),
          ),
        );
    }

    if (eventsToAdd.length > EMPTY_COUNT) {
      await database.insert(eventStatesTable).values(
        eventsToAdd.map((event) => ({
          calendarId,
          description: event.description,
          endTime: event.endTime,
          exceptionDates: stringifyIfPresent(event.exceptionDates),
          location: event.location,
          recurrenceRule: stringifyIfPresent(event.recurrenceRule),
          sourceEventUid: event.uid,
          startTime: event.startTime,
          startTimeZone: event.startTimeZone,
          title: event.title,
        })),
      );
    }

    if (nextSyncToken) {
      await this.updateSyncToken(
        encodeStoredSyncToken(nextSyncToken, OAUTH_SYNC_WINDOW_VERSION),
      );
    }

    return {
      eventsAdded: eventsToAdd.length,
      eventsRemoved: eventStateIdsToRemove.length,
      syncToken: nextSyncToken,
    };
  }

  private async refreshOriginalName(): Promise<void> {
    const remoteCalendarName = await fetchCalendarName({
      accessToken: this.currentAccessToken,
      calendarId: this.config.externalCalendarId,
    });

    if (!remoteCalendarName || remoteCalendarName === this.config.originalName) {
      return;
    }

    await this.config.database
      .update(calendarsTable)
      .set({ originalName: remoteCalendarName })
      .where(eq(calendarsTable.id, this.config.calendarId));

    this.config.originalName = remoteCalendarName;
  }

  private static async hasOutOfRangeEvents(
    database: BunSQLDatabase,
    calendarId: string,
  ): Promise<boolean> {
    const syncWindow = getOAuthSyncWindow(YEARS_UNTIL_FUTURE);

    const outOfRange = await database
      .select({ id: eventStatesTable.id })
      .from(eventStatesTable)
      .where(
        and(
          eq(eventStatesTable.calendarId, calendarId),
          or(
            lt(eventStatesTable.endTime, syncWindow.timeMin),
            gt(eventStatesTable.startTime, syncWindow.timeMax),
          ),
        ),
      )
      .limit(1);

    return outOfRange.length > EMPTY_COUNT;
  }

  private static async clearSourceAndResetToken(
    database: BunSQLDatabase,
    calendarId: string,
  ): Promise<void> {
    await database.delete(eventStatesTable).where(eq(eventStatesTable.calendarId, calendarId));

    await database
      .update(calendarsTable)
      .set({ syncToken: null })
      .where(eq(calendarsTable.id, calendarId));
  }

}

interface OutlookSourceAccount {
  calendarId: string;
  userId: string;
  externalCalendarId: string;
  syncToken: string | null;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
  credentialId: string;
  oauthCredentialId: string;
  calendarAccountId: string;
  provider: string;
  originalName: string | null;
  sourceName: string;
}

interface CreateOutlookSourceProviderConfig {
  database: BunSQLDatabase;
  oauthProvider: OAuthTokenProvider;
}

const createOutlookSourceProvider = (config: CreateOutlookSourceProviderConfig): SourceProvider => {
  const { database, oauthProvider } = config;

  return createOAuthSourceProvider<OutlookSourceAccount, OutlookSourceConfig>({
    buildConfig: (db, account) => ({
      accessToken: account.accessToken,
      accessTokenExpiresAt: account.accessTokenExpiresAt,
      calendarAccountId: account.calendarAccountId,
      calendarId: account.calendarId,
      database: db,
      deltaLink: account.syncToken,
      externalCalendarId: account.externalCalendarId,
      oauthCredentialId: account.oauthCredentialId,
      originalName: account.originalName,
      refreshToken: account.refreshToken,
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
      calendarAccountId: calendarAccountsTable.id,
      calendarId: calendarsTable.id,
      credentialId: oauthCredentialsTable.id,
      externalCalendarId: calendarsTable.externalCalendarId,
      oauthCredentialId: oauthCredentialsTable.id,
      originalName: calendarsTable.originalName,
      provider: calendarAccountsTable.provider,
      refreshToken: oauthCredentialsTable.refreshToken,
      sourceName: calendarsTable.name,
      syncToken: calendarsTable.syncToken,
      userId: calendarsTable.userId,
    })
    .from(calendarsTable)
    .innerJoin(calendarAccountsTable, eq(calendarsTable.accountId, calendarAccountsTable.id))
    .innerJoin(
      oauthCredentialsTable,
      eq(calendarAccountsTable.oauthCredentialId, oauthCredentialsTable.id),
    )
    .where(
      and(
        eq(calendarsTable.calendarType, "oauth"),
        arrayContains(calendarsTable.capabilities, ["pull"]),
        eq(calendarAccountsTable.provider, OUTLOOK_PROVIDER_ID),
        eq(calendarAccountsTable.needsReauthentication, false),
      ),
    );

  return sources.flatMap((source) => {
    if (!source.externalCalendarId) return [];
    return [{
      ...source,
      externalCalendarId: source.externalCalendarId,
      provider: source.provider,
    }];
  });
};

export { createOutlookSourceProvider, OutlookSourceProvider };
export type { CreateOutlookSourceProviderConfig, OutlookSourceAccount, OutlookSourceConfig };
