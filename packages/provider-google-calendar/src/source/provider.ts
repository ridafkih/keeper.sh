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
import { TOKEN_REFRESH_BUFFER_MS } from "@keeper.sh/constants";
import {
  calendarAccountsTable,
  calendarsTable,
  eventStatesTable,
  oauthCredentialsTable,
} from "@keeper.sh/database/schema";
import { and, arrayContains, eq, gt, inArray, lt, or } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import {
  fetchCalendarName,
  fetchCalendarEvents,
  parseGoogleEvents,
  type EventTypeFilters,
} from "./utils/fetch-events";
import { listUserCalendars } from "./utils/list-calendars";

const GOOGLE_PROVIDER_ID = "google";
const EMPTY_COUNT = 0;

const stringifyIfPresent = (value: unknown) => {
  if (!value) {
    return;
  }
  return JSON.stringify(value);
};
const YEARS_UNTIL_FUTURE = 2;

interface GoogleSourceConfig extends OAuthSourceConfig {
  originalName: string | null;
  sourceName: string;
  excludeFocusTime: boolean;
  excludeOutOfOffice: boolean;
  excludeWorkingLocation: boolean;
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
      fetchOptions.syncToken = syncTokenResolution.syncToken;
    }

    const result = await fetchCalendarEvents(fetchOptions);

    if (result.fullSyncRequired) {
      return { events: [], fullSyncRequired: true };
    }

    const filters: EventTypeFilters = {
      excludeFocusTime: this.config.excludeFocusTime,
      excludeOutOfOffice: this.config.excludeOutOfOffice,
      excludeWorkingLocation: this.config.excludeWorkingLocation,
    };

    const events = parseGoogleEvents(result.events, filters);
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
    const { database, calendarId } = this.config;
    const { nextSyncToken, isDeltaSync, cancelledEventUids } = options;

    const needsFullResync = await GoogleCalendarSourceProvider.hasOutOfRangeEvents(
      database,
      calendarId,
    );

    if (needsFullResync) {
      await GoogleCalendarSourceProvider.clearSourceAndResetToken(database, calendarId);
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
  excludeWorkingLocation: boolean;
}

interface CreateGoogleSourceProviderConfig {
  database: BunSQLDatabase;
  oauthProvider: OAuthTokenProvider;
}

const GOOGLE_PRIMARY_CALENDAR_ID = "primary";
const OAUTH_CALENDAR_TYPE = "oauth";
const MS_PER_SECOND = 1000;

const ensureValidAccessToken = async (
  database: BunSQLDatabase,
  oauthProvider: OAuthTokenProvider,
  source: { accessToken: string; accessTokenExpiresAt: Date; refreshToken: string; oauthCredentialId: string },
): Promise<string> => {
  if (source.accessTokenExpiresAt.getTime() > Date.now() + TOKEN_REFRESH_BUFFER_MS) {
    return source.accessToken;
  }

  const tokenData = await oauthProvider.refreshAccessToken(source.refreshToken);
  const newExpiresAt = new Date(Date.now() + tokenData.expires_in * MS_PER_SECOND);

  await database
    .update(oauthCredentialsTable)
    .set({
      accessToken: tokenData.access_token,
      expiresAt: newExpiresAt,
      refreshToken: tokenData.refresh_token ?? source.refreshToken,
    })
    .where(eq(oauthCredentialsTable.id, source.oauthCredentialId));

  return tokenData.access_token;
};

const importRemainingCalendars = async (
  database: BunSQLDatabase,
  accessToken: string,
  accountId: string,
  userId: string,
): Promise<void> => {
  const remoteCalendars = await listUserCalendars(accessToken);

  const existingCalendars = await database
    .select({ externalCalendarId: calendarsTable.externalCalendarId })
    .from(calendarsTable)
    .where(
      and(
        eq(calendarsTable.accountId, accountId),
        eq(calendarsTable.userId, userId),
      ),
    );

  const existingIds = new Set(
    existingCalendars.map(({ externalCalendarId }) => externalCalendarId),
  );

  const newCalendars = remoteCalendars.filter(
    (calendar) => !existingIds.has(calendar.id),
  );

  if (newCalendars.length === 0) {return;}

  await database.insert(calendarsTable).values(
    newCalendars.map((calendar) => ({
      accountId,
      calendarType: OAUTH_CALENDAR_TYPE,
      capabilities: ["pull", "push"],
      customEventName: "{{calendar_name}}",
      excludeEventDescription: true,
      excludeEventLocation: true,
      excludeEventName: true,
      externalCalendarId: calendar.id,
      includeInIcalFeed: true,
      name: calendar.summary,
      originalName: calendar.summary,
      userId,
    })),
  );
};

const createGoogleCalendarSourceProvider = (
  config: CreateGoogleSourceProviderConfig,
): SourceProvider => {
  const { database, oauthProvider } = config;

  return createOAuthSourceProvider<GoogleSourceAccount, GoogleSourceConfig>({
    buildConfig: (db, account) => ({
      accessToken: account.accessToken,
      accessTokenExpiresAt: account.accessTokenExpiresAt,
      calendarAccountId: account.calendarAccountId,
      calendarId: account.calendarId,
      database: db,
      excludeFocusTime: account.excludeFocusTime,
      excludeOutOfOffice: account.excludeOutOfOffice,
      excludeWorkingLocation: account.excludeWorkingLocation,
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
    getAllSources: getGoogleSourcesWithCredentials,
    oauthProvider,
  });
};

const getGoogleSourcesWithCredentials = async (
  database: BunSQLDatabase,
  oauthProvider: OAuthTokenProvider,
): Promise<GoogleSourceAccount[]> => {
  const sources = await database
    .select({
      accessToken: oauthCredentialsTable.accessToken,
      accessTokenExpiresAt: oauthCredentialsTable.expiresAt,
      calendarAccountId: calendarAccountsTable.id,
      calendarId: calendarsTable.id,
      credentialId: oauthCredentialsTable.id,
      excludeFocusTime: calendarsTable.excludeFocusTime,
      excludeOutOfOffice: calendarsTable.excludeOutOfOffice,
      excludeWorkingLocation: calendarsTable.excludeWorkingLocation,
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
        eq(calendarAccountsTable.provider, GOOGLE_PROVIDER_ID),
        eq(calendarAccountsTable.needsReauthentication, false),
      ),
    );

  const results: GoogleSourceAccount[] = [];

  for (const source of sources) {
    if (source.externalCalendarId) {
      results.push({
        ...source,
        externalCalendarId: source.externalCalendarId,
        provider: source.provider,
      });
      continue;
    }

    await database
      .update(calendarsTable)
      .set({ externalCalendarId: GOOGLE_PRIMARY_CALENDAR_ID })
      .where(eq(calendarsTable.id, source.calendarId));

    const accessToken = await ensureValidAccessToken(database, oauthProvider, source);

    await importRemainingCalendars(
      database,
      accessToken,
      source.calendarAccountId,
      source.userId,
    );

    results.push({
      ...source,
      externalCalendarId: GOOGLE_PRIMARY_CALENDAR_ID,
      provider: source.provider,
    });
  }

  return results;
};

export { createGoogleCalendarSourceProvider, GoogleCalendarSourceProvider };
export type { CreateGoogleSourceProviderConfig, GoogleSourceAccount, GoogleSourceConfig };
