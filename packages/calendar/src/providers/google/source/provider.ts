import { buildSourceEventStateIdsToRemove, buildSourceEventsToAdd } from "../../../core/source/event-diff";
import { parseStoredSourceEventStates } from "../../../core/source/stored-event-state";
import { filterSourceEventsToSyncWindow, resolveSourceSyncTokenAction, splitSourceEventsByPersistenceIdentity } from "../../../core/source/sync-diagnostics";
import {
  buildEventStateInsertRow,
  insertEventStatesWithConflictResolution,
} from "../../../core/source/write-event-states";
import { OAuthSourceProvider, type ProcessEventsOptions } from "../../../core/oauth/source-provider";
import type { FetchEventsResult as BaseFetchEventsResult } from "../../../core/oauth/source-provider";
import { createOAuthSourceProvider, type SourceProvider } from "../../../core/oauth/create-source-provider";
import { encodeStoredSyncToken, resolveSyncTokenForWindow } from "../../../core/oauth/sync-token";
import { getOAuthSyncWindow, OAUTH_SYNC_WINDOW_VERSION } from "../../../core/oauth/sync-window";
import type { OAuthTokenProvider } from "../../../core/oauth/token-provider";
import type { RefreshLockStore } from "../../../core/oauth/refresh-coordinator";
import type { OAuthSourceConfig, SourceEvent, SourceSyncResult } from "../../../core/types";
import {
  calendarAccountsTable,
  calendarsTable,
  eventStatesTable,
  oauthCredentialsTable,
} from "@keeper.sh/database/schema";
import { and, arrayContains, eq, gt, inArray, lt, or } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { fetchCalendarEvents, parseGoogleEvents } from "./utils/fetch-events";

const GOOGLE_PROVIDER_ID = "google";
const EMPTY_COUNT = 0;

const YEARS_UNTIL_FUTURE = 2;

interface GoogleSourceConfig extends OAuthSourceConfig {
  originalName: string | null;
  sourceName: string;
  excludeFocusTime: boolean;
  excludeOutOfOffice: boolean;
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
      fetchOptions.syncToken = syncTokenResolution.syncToken;
    }

    const result = await fetchCalendarEvents(fetchOptions);

    if (result.fullSyncRequired) {
      return { events: [], fullSyncRequired: true };
    }

    const events = parseGoogleEvents(result.events);
    const fetchResult: BaseFetchEventsResult = {
      changedEventIds: result.changedEventIds,
      events,
      fullSyncRequired: false,
      isDeltaSync: result.isDeltaSync,
      nextSyncToken: result.nextSyncToken,
    };

    if (result.cancelledEventIds) {
      fetchResult.cancelledEventIds = result.cancelledEventIds;
    }

    return fetchResult;
  }

  protected async processEvents(
    events: SourceEvent[],
    options: ProcessEventsOptions,
  ): Promise<SourceSyncResult> {
    const { database, calendarId } = this.config;
    const { changedEventIds, nextSyncToken, isDeltaSync, cancelledEventIds } = options;
    const syncWindow = getOAuthSyncWindow(YEARS_UNTIL_FUTURE);
    const {
      events: eventsInWindow,
      filteredCount: eventsFilteredOutOfWindow,
    } = filterSourceEventsToSyncWindow(events, syncWindow);

    await GoogleCalendarSourceProvider.removeOutOfRangeEvents(
      database,
      calendarId,
      syncWindow,
    );

    const storedEvents = await database
      .select({
        availability: eventStatesTable.availability,
        description: eventStatesTable.description,
        id: eventStatesTable.id,
        endTime: eventStatesTable.endTime,
        exceptionDates: eventStatesTable.exceptionDates,
        isAllDay: eventStatesTable.isAllDay,
        location: eventStatesTable.location,
        recurrenceId: eventStatesTable.recurrenceId,
        recurrenceRule: eventStatesTable.recurrenceRule,
        sourceEventType: eventStatesTable.sourceEventType,
        sourceEventId: eventStatesTable.sourceEventId,
        sourceEventInstanceKey: eventStatesTable.sourceEventInstanceKey,
        sourceEventUid: eventStatesTable.sourceEventUid,
        startTime: eventStatesTable.startTime,
        startTimeZone: eventStatesTable.startTimeZone,
        title: eventStatesTable.title,
      })
      .from(eventStatesTable)
      .where(eq(eventStatesTable.calendarId, calendarId));
    const existingEvents = parseStoredSourceEventStates(storedEvents);

    const eventsToAdd = buildSourceEventsToAdd(existingEvents, eventsInWindow, { isDeltaSync });
    const eventStateIdsToRemove = buildSourceEventStateIdsToRemove(
      existingEvents,
      eventsInWindow,
      { cancelledEventIds, changedEventIds, isDeltaSync },
    );
    const { eventsToInsert, eventsToUpdate } = splitSourceEventsByPersistenceIdentity(
      existingEvents,
      eventsToAdd,
    );

    if (eventStateIdsToRemove.length > EMPTY_COUNT || eventsToAdd.length > EMPTY_COUNT) {
      await database.transaction(async (transactionDatabase) => {
        if (eventStateIdsToRemove.length > EMPTY_COUNT) {
          await transactionDatabase
            .delete(eventStatesTable)
            .where(
              and(
                eq(eventStatesTable.calendarId, calendarId),
                inArray(eventStatesTable.id, eventStateIdsToRemove),
              ),
            );
        }

        if (eventsToAdd.length > EMPTY_COUNT) {
          await insertEventStatesWithConflictResolution(
            transactionDatabase,
            eventsToAdd.map((event) => buildEventStateInsertRow(calendarId, event)),
          );
        }
      });
    }

    const syncTokenAction = resolveSourceSyncTokenAction(nextSyncToken, isDeltaSync);
    if (syncTokenAction.shouldResetSyncToken) {
      await this.clearSyncToken();
    }

    if (syncTokenAction.nextSyncTokenToPersist) {
      await this.updateSyncToken(
        encodeStoredSyncToken(syncTokenAction.nextSyncTokenToPersist, OAUTH_SYNC_WINDOW_VERSION),
      );
    }

    return {
      eventsAdded: eventsToInsert.length,
      eventsFilteredOutOfWindow,
      eventsInserted: eventsToInsert.length,
      eventsRemoved: eventStateIdsToRemove.length,
      eventsUpdated: eventsToUpdate.length,
      syncTokenResetCount: Number(syncTokenAction.shouldResetSyncToken),
      syncToken: nextSyncToken,
    };
  }
  private static async removeOutOfRangeEvents(
    database: BunSQLDatabase,
    calendarId: string,
    syncWindow: { timeMin: Date; timeMax: Date },
  ): Promise<void> {
    await database
      .delete(eventStatesTable)
      .where(
        and(
          eq(eventStatesTable.calendarId, calendarId),
          or(
            lt(eventStatesTable.endTime, syncWindow.timeMin),
            gt(eventStatesTable.startTime, syncWindow.timeMax),
          ),
        ),
      );
  }

}

interface GoogleSourceAccount {
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
  excludeFocusTime: boolean;
  excludeOutOfOffice: boolean;
}

interface CreateGoogleSourceProviderConfig {
  database: BunSQLDatabase;
  oauthProvider: OAuthTokenProvider;
  refreshLockStore?: RefreshLockStore | null;
}

const getGoogleSourcesWithCredentials = async (
  database: BunSQLDatabase,
  userId: string | null,
): Promise<GoogleSourceAccount[]> => {
  const sourceConditions = [
    eq(calendarsTable.calendarType, "oauth"),
    arrayContains(calendarsTable.capabilities, ["pull"]),
    eq(calendarAccountsTable.provider, GOOGLE_PROVIDER_ID),
  ];
  if (userId !== null) {
    sourceConditions.push(eq(calendarsTable.userId, userId));
  }
  const sources = await database
    .select({
      accessToken: oauthCredentialsTable.accessToken,
      accessTokenExpiresAt: oauthCredentialsTable.expiresAt,
      calendarAccountId: calendarAccountsTable.id,
      calendarId: calendarsTable.id,
      credentialId: oauthCredentialsTable.id,
      excludeFocusTime: calendarsTable.excludeFocusTime,
      excludeOutOfOffice: calendarsTable.excludeOutOfOffice,
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
    .where(and(...sourceConditions));

  return sources.flatMap((source) => {
    if (!source.externalCalendarId) {return [];}
    return [{
      ...source,
      externalCalendarId: source.externalCalendarId,
      provider: source.provider,
    }];
  });
};

const createGoogleCalendarSourceProvider = (
  config: CreateGoogleSourceProviderConfig,
): SourceProvider => {
  const { database, oauthProvider, refreshLockStore } = config;

  return createOAuthSourceProvider<GoogleSourceAccount, GoogleSourceConfig>({
    buildConfig: (db, account) => ({
      accessToken: account.accessToken,
      accessTokenExpiresAt: account.accessTokenExpiresAt,
      calendarAccountId: account.calendarAccountId,
      calendarId: account.calendarId,
      database: db,
      excludeFocusTime: account.excludeFocusTime,
      excludeOutOfOffice: account.excludeOutOfOffice,
      externalCalendarId: account.externalCalendarId,
      oauthCredentialId: account.oauthCredentialId,
      originalName: account.originalName,
      refreshToken: account.refreshToken,
      sourceName: account.sourceName,
      syncToken: account.syncToken,
      userId: account.userId,
    }),
    createProviderInstance: (providerConfig, oauth) =>
      new GoogleCalendarSourceProvider(providerConfig, oauth),
    database,
    getAllSources: (db) => getGoogleSourcesWithCredentials(db, null),
    getSourcesForUser: getGoogleSourcesWithCredentials,
    oauthProvider,
    refreshLockStore,
  });
};

export { createGoogleCalendarSourceProvider, GoogleCalendarSourceProvider };
export type { CreateGoogleSourceProviderConfig, GoogleSourceAccount, GoogleSourceConfig };
