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
  calendarAccountsTable,
  calendarsTable,
  eventStatesTable,
  oauthCredentialsTable,
} from "@keeper.sh/database/schema";
import { getStartOfToday } from "@keeper.sh/date-utils";
import { and, eq, inArray, lt, or, gt } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { fetchCalendarEvents, parseOutlookEvents } from "./utils/fetch-events";

const OUTLOOK_PROVIDER_ID = "outlook";
const EMPTY_COUNT = 0;
const YEARS_UNTIL_FUTURE = 2;

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
        sourceEventUid: eventStatesTable.sourceEventUid,
      })
      .from(eventStatesTable)
      .where(eq(eventStatesTable.calendarId, calendarId));

    const existingUids = new Set(existingEvents.map((event) => event.sourceEventUid));

    const toAdd = events.filter((event) => !existingUids.has(event.uid));

    const toRemoveUids = OutlookSourceProvider.calculateEventsToRemove(
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
            eq(eventStatesTable.calendarId, calendarId),
            inArray(eventStatesTable.sourceEventUid, toRemoveUids),
          ),
        );
    }

    if (toAdd.length > EMPTY_COUNT) {
      await database.insert(eventStatesTable).values(
        toAdd.map((event) => ({
          calendarId,
          description: event.description,
          endTime: event.endTime,
          location: event.location,
          sourceEventUid: event.uid,
          startTime: event.startTime,
          title: event.title,
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
    calendarId: string,
  ): Promise<boolean> {
    const today = getStartOfToday();
    const futureDate = new Date(today);
    futureDate.setFullYear(futureDate.getFullYear() + YEARS_UNTIL_FUTURE);

    const outOfRange = await database
      .select({ id: eventStatesTable.id })
      .from(eventStatesTable)
      .where(
        and(
          eq(eventStatesTable.calendarId, calendarId),
          or(lt(eventStatesTable.endTime, today), gt(eventStatesTable.startTime, futureDate)),
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
        eq(calendarAccountsTable.provider, OUTLOOK_PROVIDER_ID),
        eq(calendarAccountsTable.needsReauthentication, false),
      ),
    );

  return sources.map((source) => {
    if (!source.externalCalendarId) {
      throw new Error(`Outlook source ${source.calendarId} is missing externalCalendarId`);
    }
    return {
      ...source,
      externalCalendarId: source.externalCalendarId,
      provider: source.provider,
    };
  });
};

export { createOutlookSourceProvider, OutlookSourceProvider };
export type { CreateOutlookSourceProviderConfig, OutlookSourceAccount, OutlookSourceConfig };
