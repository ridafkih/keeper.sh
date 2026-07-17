import {
  buildSourceEventStateIdsToRemove,
  buildSourceEventsToAdd,
} from "../../../core/source/event-diff";
import {
  buildInvalidStoredEventIdsToRemove,
  parseStoredSourceEventStatesRecoveringInvalid,
} from "../../../core/source/stored-event-state";
import { filterSourceEventsToSyncWindow, resolveSourceSyncTokenAction, splitSourceEventsByPersistenceIdentity } from "../../../core/source/sync-diagnostics";
import {
  buildEventStateInsertRow,
  insertEventStatesWithConflictResolution,
} from "../../../core/source/write-event-states";
import { OAuthSourceProvider, type ProcessEventsOptions } from "../../../core/oauth/source-provider";
import type { FetchEventsResult as BaseFetchEventsResult } from "../../../core/oauth/source-provider";
import { createOAuthSourceProvider, type SourceProvider } from "../../../core/oauth/create-source-provider";
import { encodeStoredSyncToken, resolveSyncTokenForWindow } from "../../../core/oauth/sync-token";
import { getOAuthSyncTokenVersion, getOAuthSyncWindow } from "../../../core/oauth/sync-window";
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
import type { BunSQLClient } from "../../../core/database-client";
import { fetchCalendarEvents, fetchCalendarName, parseOutlookEvents } from "./utils/fetch-events";

const OUTLOOK_PROVIDER_ID = "outlook";
const EMPTY_COUNT = 0;
const OUTLOOK_ADAPTER_VERSION = 1;

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
    const syncTokenVersion = getOAuthSyncTokenVersion(OUTLOOK_ADAPTER_VERSION);
    const syncTokenResolution = resolveSyncTokenForWindow(
      syncToken,
      syncTokenVersion,
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
      changedEventIds: result.changedEventIds,
      events,
      fullSyncRequired: false,
      isDeltaSync: result.isDeltaSync,
      nextSyncToken: result.nextDeltaLink,
      syncTokenVersion,
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
    const {
      cancelledEventIds,
      changedEventIds,
      isDeltaSync,
      nextSyncToken,
      syncTokenVersion,
    } = options;
    const syncWindow = getOAuthSyncWindow(YEARS_UNTIL_FUTURE);
    const {
      events: eventsInWindow,
      filteredCount: eventsFilteredOutOfWindow,
    } = filterSourceEventsToSyncWindow(events, syncWindow);

    await OutlookSourceProvider.removeOutOfRangeEvents(
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
        sourceEventUid: eventStatesTable.sourceEventUid,
        startTime: eventStatesTable.startTime,
        startTimeZone: eventStatesTable.startTimeZone,
        title: eventStatesTable.title,
      })
      .from(eventStatesTable)
      .where(eq(eventStatesTable.calendarId, calendarId));
    const parseResult = parseStoredSourceEventStatesRecoveringInvalid(storedEvents);
    const existingEvents = parseResult.events;
    if (isDeltaSync && parseResult.failures.length > 0) {
      await this.clearSyncToken();
      return {
        eventsAdded: 0,
        eventsFilteredOutOfWindow,
        eventsRemoved: 0,
        fullSyncRequired: true,
        syncTokenResetCount: 1,
      };
    }

    const eventsToAdd = buildSourceEventsToAdd(existingEvents, eventsInWindow, { isDeltaSync });
    const eventStateIdsToRemove = [...new Set([
      ...buildInvalidStoredEventIdsToRemove(parseResult.failures, eventsInWindow),
      ...buildSourceEventStateIdsToRemove(
        existingEvents,
        eventsInWindow,
        { cancelledEventIds, changedEventIds, isDeltaSync },
      ),
    ])];
    const { eventsToInsert, eventsToUpdate } = splitSourceEventsByPersistenceIdentity(
      existingEvents,
      eventsToAdd,
    );

    if (
      eventStateIdsToRemove.length > EMPTY_COUNT
      || eventsToAdd.length > EMPTY_COUNT
    ) {
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
        encodeStoredSyncToken(
          syncTokenAction.nextSyncTokenToPersist,
          syncTokenVersion ?? getOAuthSyncTokenVersion(OUTLOOK_ADAPTER_VERSION),
        ),
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

  private static async removeOutOfRangeEvents(
    database: BunSQLClient,
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
  refreshLockStore?: RefreshLockStore | null;
}

const getOutlookSourcesWithCredentials = async (
  database: BunSQLDatabase,
  userId: string | null,
): Promise<OutlookSourceAccount[]> => {
  const sourceConditions = [
    eq(calendarsTable.calendarType, "oauth"),
    arrayContains(calendarsTable.capabilities, ["pull"]),
    eq(calendarAccountsTable.provider, OUTLOOK_PROVIDER_ID),
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

const createOutlookSourceProvider = (config: CreateOutlookSourceProviderConfig): SourceProvider => {
  const { database, oauthProvider, refreshLockStore } = config;

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
    getAllSources: (db) => getOutlookSourcesWithCredentials(db, null),
    getSourcesForUser: getOutlookSourcesWithCredentials,
    oauthProvider,
    refreshLockStore,
  });
};

export { createOutlookSourceProvider, OutlookSourceProvider };
export type { CreateOutlookSourceProviderConfig, OutlookSourceAccount, OutlookSourceConfig };
