import { eventStatesTable, userEventsTable } from "@keeper.sh/database/schema";
import { eq } from "drizzle-orm";
import type { KeeperDatabase } from "@/types";
import type {
  EventInput,
  EventUpdateInput,
  EventActionResult,
  EventCreateResult,
  PendingInvite,
  ProviderCredentials,
  ProviderEventReference,
  RsvpStatus,
} from "@/types";
import { createCoordinatedRefresher } from "@keeper.sh/calendar";
import type { RefreshLockStore } from "@keeper.sh/calendar";
import { resolveCredentialsByCalendarId, resolveCredentialsByEventId } from "./resolve-credentials";
import type { EventSource } from "./resolve-credentials";
import { resolveSyncedEventWriteError } from "./synced-event-write";
import { getEvent } from "@/queries/get-event";
import { parseEventReference } from "@/queries/event-read-model";
import {
  createGoogleEvent,
  updateGoogleEvent,
  deleteGoogleEvent,
  rsvpGoogleEvent,
  getPendingGoogleInvites,
} from "./providers/google";
import {
  createOutlookEvent,
  updateOutlookEvent,
  deleteOutlookEvent,
  rsvpOutlookEvent,
  getPendingOutlookInvites,
} from "./providers/outlook";
import {
  createCalDAVEvent,
  updateCalDAVEvent,
  deleteCalDAVEvent,
  rsvpCalDAVEvent,
  getPendingCalDAVInvites,
} from "./providers/caldav";

interface OAuthTokenRefresher {
  getProvider: (providerId: string) => { refreshAccessToken: (refreshToken: string) => Promise<{ access_token: string; expires_in: number }> } | undefined;
}

interface MutationDependencies {
  database: KeeperDatabase;
  oauthTokenRefresher?: OAuthTokenRefresher;
  refreshLockStore?: RefreshLockStore | null;
  encryptionKey?: string;
  onSourceEventChanged?: (userId: string) => Promise<void>;
}

const TOKEN_REFRESH_BUFFER_MS = 60_000;

const CALDAV_PROVIDERS = new Set(["caldav", "fastmail", "icloud"]);

const ensureValidAccessToken = async (
  provider: string,
  oauth: { credentialId: string; accessToken: string; refreshToken: string; expiresAt: Date },
  accountId: string,
  deps: MutationDependencies,
): Promise<string> => {
  if (oauth.expiresAt.getTime() > Date.now() + TOKEN_REFRESH_BUFFER_MS) {
    return oauth.accessToken;
  }

  if (!deps.oauthTokenRefresher) {
    return oauth.accessToken;
  }

  const oauthProvider = deps.oauthTokenRefresher.getProvider(provider);
  if (!oauthProvider) {
    return oauth.accessToken;
  }

  const refresher = createCoordinatedRefresher({
    database: deps.database,
    oauthCredentialId: oauth.credentialId,
    calendarAccountId: accountId,
    refreshLockStore: deps.refreshLockStore ?? null,
    rawRefresh: (refreshToken) => oauthProvider.refreshAccessToken(refreshToken),
  });

  const result = await refresher(oauth.refreshToken);
  return result.access_token;
};

interface CreateProviderFailure {
  success: false;
  error: string;
}

interface CreateProviderSuccess {
  success: true;
  sourceEventUid: string | null;
}

type CreateProviderResult = CreateProviderFailure | CreateProviderSuccess;

const createEventViaOAuth = async (
  credentials: ProviderCredentials,
  input: EventInput,
  deps: MutationDependencies,
): Promise<CreateProviderResult> => {
  if (!credentials.oauth) {
    return { success: false, error: "No OAuth credentials available." };
  }

  const accessToken = await ensureValidAccessToken(
    credentials.provider,
    credentials.oauth,
    credentials.accountId,
    deps,
  );

  if (credentials.provider === "google") {
    const result = await createGoogleEvent(accessToken, credentials.externalCalendarId, input);
    if (!result.success) {
      return { success: false, error: result.error ?? "Google create failed." };
    }
    return { success: true, sourceEventUid: result.sourceEventUid ?? null };
  }

  if (credentials.provider === "outlook") {
    const result = await createOutlookEvent(accessToken, input);
    if (!result.success) {
      return { success: false, error: result.error ?? "Outlook create failed." };
    }
    return { success: true, sourceEventUid: result.sourceEventUid ?? null };
  }

  return { success: false, error: `Unsupported OAuth provider: ${credentials.provider}` };
};

const createEventViaCalDAV = async (
  credentials: ProviderCredentials,
  input: EventInput,
  encryptionKey: string,
): Promise<CreateProviderResult> => {
  if (!credentials.caldav || !credentials.calendarUrl) {
    return { success: false, error: "Missing CalDAV credentials or calendar URL." };
  }

  const result = await createCalDAVEvent(
    {
      serverUrl: credentials.caldav.serverUrl,
      calendarUrl: credentials.calendarUrl,
      username: credentials.caldav.username,
      authMethod: credentials.caldav.authMethod,
      encryptedPassword: credentials.caldav.encryptedPassword,
      encryptionKey,
    },
    input,
  );

  if (!result.success) {
    return { success: false, error: result.error ?? "CalDAV create failed." };
  }

  return { success: true, sourceEventUid: result.sourceEventUid ?? null };
};

const dispatchCreateEvent = (
  credentials: ProviderCredentials,
  input: EventInput,
  deps: MutationDependencies,
): Promise<CreateProviderResult> => {
  if (credentials.oauth) {
    return createEventViaOAuth(credentials, input, deps);
  }

  if (credentials.caldav && CALDAV_PROVIDERS.has(credentials.provider) && deps.encryptionKey && credentials.calendarUrl) {
    return createEventViaCalDAV(credentials, input, deps.encryptionKey);
  }

  return Promise.resolve({ success: false, error: "Calendar provider not supported for event creation." });
};

const createEventMutation = async (
  deps: MutationDependencies,
  userId: string,
  input: EventInput,
): Promise<EventCreateResult> => {
  const credentials = await resolveCredentialsByCalendarId(deps.database, userId, input.calendarId);

  if (!credentials) {
    return { success: false, error: "Calendar not found or requires reauthentication." };
  }

  const providerResult = await dispatchCreateEvent(credentials, input, deps);

  if (!providerResult.success) {
    return providerResult;
  }

  const [inserted] = await deps.database
    .insert(userEventsTable)
    .values({
      calendarId: input.calendarId,
      userId,
      sourceEventUid: providerResult.sourceEventUid,
      title: input.title,
      description: input.description ?? null,
      location: input.location ?? null,
      startTime: new Date(input.startTime),
      endTime: new Date(input.endTime),
      startTimeZone: input.startTimeZone ?? null,
      isAllDay: input.isAllDay ?? false,
      availability: input.availability ?? "busy",
    })
    .returning({ id: userEventsTable.id });

  if (!inserted) {
    return { success: true };
  }

  const event = await getEvent(deps.database, userId, inserted.id);

  if (event) {
    return { success: true, event };
  }

  return { success: true };
};

const dispatchUpdateEvent = async (
  credentials: ProviderCredentials,
  reference: ProviderEventReference,
  updates: EventUpdateInput,
  deps: MutationDependencies,
): Promise<EventActionResult> => {
  if (credentials.oauth) {
    const accessToken = await ensureValidAccessToken(
      credentials.provider,
      credentials.oauth,
      credentials.accountId,
      deps,
    );

    if (credentials.provider === "google") {
      return updateGoogleEvent(accessToken, credentials.externalCalendarId, reference.sourceEventUid, updates);
    }

    if (credentials.provider === "outlook") {
      return updateOutlookEvent(accessToken, reference, updates);
    }

    return { success: false, error: `Unsupported OAuth provider: ${credentials.provider}` };
  }

  if (credentials.caldav && CALDAV_PROVIDERS.has(credentials.provider) && deps.encryptionKey && credentials.calendarUrl) {
    return updateCalDAVEvent(
      {
        serverUrl: credentials.caldav.serverUrl,
        calendarUrl: credentials.calendarUrl,
        username: credentials.caldav.username,
        authMethod: credentials.caldav.authMethod,
        encryptedPassword: credentials.caldav.encryptedPassword,
        encryptionKey: deps.encryptionKey,
      },
      reference.sourceEventUid,
      updates,
    );
  }

  return { success: false, error: "Calendar provider not supported for event updates." };
};

const completeUpdateRange = (
  updates: EventUpdateInput,
  stored: { endTime: Date; startTime: Date },
): EventUpdateInput => {
  if (!updates.startTime && !updates.endTime) {
    return updates;
  }

  return {
    ...updates,
    endTime: updates.endTime ?? stored.endTime.toISOString(),
    startTime: updates.startTime ?? stored.startTime.toISOString(),
  };
};

const buildDbUpdates = (updates: EventUpdateInput): Record<string, unknown> => {
  const dbUpdates: Record<string, unknown> = {};

  if ("title" in updates) {
    dbUpdates.title = updates.title;
  }
  if ("description" in updates) {
    dbUpdates.description = updates.description;
  }
  if ("location" in updates) {
    dbUpdates.location = updates.location;
  }
  if ("startTime" in updates && updates.startTime) {
    dbUpdates.startTime = new Date(updates.startTime);
  }
  if ("endTime" in updates && updates.endTime) {
    dbUpdates.endTime = new Date(updates.endTime);
  }
  if ("startTimeZone" in updates) {
    dbUpdates.startTimeZone = updates.startTimeZone ?? null;
  }
  if ("isAllDay" in updates) {
    dbUpdates.isAllDay = updates.isAllDay;
  }
  if ("availability" in updates) {
    dbUpdates.availability = updates.availability;
  }

  return dbUpdates;
};

const readStoredEventRange = async (
  database: KeeperDatabase,
  eventSource: EventSource,
  resourceId: string,
): Promise<{ endTime: Date; startTime: Date } | undefined> => {
  if (eventSource === "synced") {
    const [stored] = await database
      .select({ endTime: eventStatesTable.endTime, startTime: eventStatesTable.startTime })
      .from(eventStatesTable)
      .where(eq(eventStatesTable.id, resourceId))
      .limit(1);
    return stored;
  }

  const [stored] = await database
    .select({ endTime: userEventsTable.endTime, startTime: userEventsTable.startTime })
    .from(userEventsTable)
    .where(eq(userEventsTable.id, resourceId))
    .limit(1);
  return stored;
};

const writeStoredEventUpdates = async (
  database: KeeperDatabase,
  eventSource: EventSource,
  resourceId: string,
  dbUpdates: Record<string, unknown>,
): Promise<void> => {
  if (eventSource === "synced") {
    await database.update(eventStatesTable).set(dbUpdates).where(eq(eventStatesTable.id, resourceId));
    return;
  }

  await database.update(userEventsTable).set(dbUpdates).where(eq(userEventsTable.id, resourceId));
};

const deleteStoredEvent = async (
  database: KeeperDatabase,
  eventSource: EventSource,
  resourceId: string,
): Promise<void> => {
  if (eventSource === "synced") {
    await database.delete(eventStatesTable).where(eq(eventStatesTable.id, resourceId));
    return;
  }

  await database.delete(userEventsTable).where(eq(userEventsTable.id, resourceId));
};

const updateEventMutation = async (
  deps: MutationDependencies,
  userId: string,
  eventId: string,
  updates: EventUpdateInput,
): Promise<EventActionResult> => {
  const resolved = await resolveCredentialsByEventId(deps.database, userId, eventId);

  if (!resolved) {
    return { success: false, error: "Event not found." };
  }

  if (resolved.eventSource === "synced") {
    const writeError = resolveSyncedEventWriteError(resolved);
    if (writeError) {
      return { success: false, error: writeError };
    }
  }

  const reference = parseEventReference(eventId);
  if (!reference) {
    return { success: false, error: "Event not found." };
  }

  const { credentials, eventSource, sourceEventId, sourceEventUid } = resolved;

  if (!sourceEventUid) {
    return { success: false, error: "Event cannot be updated (no source UID)." };
  }

  const stored = await readStoredEventRange(deps.database, eventSource, reference.resourceId);

  if (!stored) {
    throw new Error(`Event ${reference.resourceId} resolved credentials but has no row.`);
  }

  const completedUpdates = completeUpdateRange(updates, stored);

  const providerResult = await dispatchUpdateEvent(
    credentials,
    { sourceEventId, sourceEventUid },
    completedUpdates,
    deps,
  );

  if (!providerResult.success) {
    return providerResult;
  }

  const dbUpdates = buildDbUpdates(updates);

  if (Object.keys(dbUpdates).length > 0) {
    await writeStoredEventUpdates(deps.database, eventSource, reference.resourceId, dbUpdates);
  }

  if (eventSource === "synced") {
    await deps.onSourceEventChanged?.(userId);
  }

  return { success: true };
};

const dispatchDeleteEvent = async (
  credentials: ProviderCredentials,
  reference: ProviderEventReference,
  deps: MutationDependencies,
): Promise<EventActionResult | null> => {
  if (credentials.oauth) {
    const accessToken = await ensureValidAccessToken(
      credentials.provider,
      credentials.oauth,
      credentials.accountId,
      deps,
    );

    if (credentials.provider === "google") {
      return deleteGoogleEvent(accessToken, credentials.externalCalendarId, reference.sourceEventUid);
    }

    if (credentials.provider === "outlook") {
      return deleteOutlookEvent(accessToken, reference);
    }

    return null;
  }

  if (credentials.caldav && CALDAV_PROVIDERS.has(credentials.provider) && deps.encryptionKey && credentials.calendarUrl) {
    return deleteCalDAVEvent(
      {
        serverUrl: credentials.caldav.serverUrl,
        calendarUrl: credentials.calendarUrl,
        username: credentials.caldav.username,
        authMethod: credentials.caldav.authMethod,
        encryptedPassword: credentials.caldav.encryptedPassword,
        encryptionKey: deps.encryptionKey,
      },
      reference.sourceEventUid,
    );
  }

  return null;
};

const deleteEventMutation = async (
  deps: MutationDependencies,
  userId: string,
  eventId: string,
): Promise<EventActionResult> => {
  const resolved = await resolveCredentialsByEventId(deps.database, userId, eventId);

  if (!resolved) {
    return { success: false, error: "Event not found." };
  }

  if (resolved.eventSource === "synced") {
    const writeError = resolveSyncedEventWriteError(resolved);
    if (writeError) {
      return { success: false, error: writeError };
    }
  }

  const reference = parseEventReference(eventId);
  if (!reference) {
    return { success: false, error: "Event not found." };
  }

  const { credentials, eventSource, sourceEventId, sourceEventUid } = resolved;

  if (sourceEventUid) {
    const providerResult = await dispatchDeleteEvent(credentials, { sourceEventId, sourceEventUid }, deps);

    if (providerResult && !providerResult.success) {
      return providerResult;
    }

    if (!providerResult && eventSource === "synced") {
      return { success: false, error: "Calendar provider not supported for event deletion." };
    }
  }

  await deleteStoredEvent(deps.database, eventSource, reference.resourceId);

  if (eventSource === "synced") {
    await deps.onSourceEventChanged?.(userId);
  }

  return { success: true };
};

const rsvpEventMutation = async (
  deps: MutationDependencies,
  userId: string,
  eventId: string,
  status: RsvpStatus,
): Promise<EventActionResult> => {
  const resolved = await resolveCredentialsByEventId(deps.database, userId, eventId);

  if (!resolved) {
    return { success: false, error: "Event not found." };
  }

  const { credentials, occurrenceStart, sourceEventId, sourceEventUid } = resolved;

  if (!sourceEventUid) {
    return { success: false, error: "Event cannot be responded to (no source UID)." };
  }

  if (!credentials.email) {
    return { success: false, error: "No email associated with this calendar account." };
  }

  if (credentials.oauth) {
    const accessToken = await ensureValidAccessToken(
      credentials.provider,
      credentials.oauth,
      credentials.accountId,
      deps,
    );

    if (credentials.provider === "google") {
      return rsvpGoogleEvent(
        accessToken,
        credentials.externalCalendarId,
        { sourceEventId, sourceEventUid },
        status,
        credentials.email,
      );
    }

    if (credentials.provider === "outlook") {
      return rsvpOutlookEvent(
        accessToken,
        { sourceEventId, sourceEventUid },
        status,
      );
    }

    return { success: false, error: `RSVP not supported for provider: ${credentials.provider}` };
  }

  if (credentials.caldav && CALDAV_PROVIDERS.has(credentials.provider) && deps.encryptionKey && credentials.calendarUrl) {
    return rsvpCalDAVEvent(
      {
        serverUrl: credentials.caldav.serverUrl,
        calendarUrl: credentials.calendarUrl,
        username: credentials.caldav.username,
        authMethod: credentials.caldav.authMethod,
        encryptedPassword: credentials.caldav.encryptedPassword,
        encryptionKey: deps.encryptionKey,
      },
      sourceEventUid,
      occurrenceStart,
      status,
      credentials.email,
    );
  }

  return { success: false, error: "RSVP not supported for this calendar provider." };
};

const fetchOAuthPendingInvites = async (
  credentials: ProviderCredentials,
  from: string,
  to: string,
  deps: MutationDependencies,
): Promise<PendingInvite[]> => {
  if (!credentials.oauth) {
    return [];
  }

  const accessToken = await ensureValidAccessToken(
    credentials.provider,
    credentials.oauth,
    credentials.accountId,
    deps,
  );

  if (credentials.provider === "google") {
    const providerInvites = await getPendingGoogleInvites(accessToken, credentials.externalCalendarId, from, to);
    return providerInvites.map((invite) => ({
      ...invite,
      calendarId: credentials.calendarId,
      provider: credentials.provider,
    }));
  }

  if (credentials.provider === "outlook") {
    const providerInvites = await getPendingOutlookInvites(accessToken, from, to);
    return providerInvites.map((invite) => ({
      ...invite,
      calendarId: credentials.calendarId,
      provider: credentials.provider,
    }));
  }

  return [];
};

const fetchCalDAVPendingInvites = async (
  credentials: ProviderCredentials,
  from: string,
  to: string,
  encryptionKey: string,
): Promise<PendingInvite[]> => {
  if (!credentials.caldav || !credentials.calendarUrl || !credentials.email) {
    return [];
  }

  if (!CALDAV_PROVIDERS.has(credentials.provider)) {
    return [];
  }

  const providerInvites = await getPendingCalDAVInvites(
    {
      serverUrl: credentials.caldav.serverUrl,
      calendarUrl: credentials.calendarUrl,
      username: credentials.caldav.username,
      authMethod: credentials.caldav.authMethod,
      encryptedPassword: credentials.caldav.encryptedPassword,
      encryptionKey,
    },
    from,
    to,
    credentials.email,
  );

  return providerInvites.map((invite) => ({
    ...invite,
    calendarId: credentials.calendarId,
    provider: credentials.provider,
  }));
};

const fetchPendingInvitesForCalendar = (
  credentials: ProviderCredentials,
  from: string,
  to: string,
  deps: MutationDependencies,
): Promise<PendingInvite[]> => {
  if (credentials.oauth) {
    return fetchOAuthPendingInvites(credentials, from, to, deps);
  }

  if (credentials.caldav && deps.encryptionKey) {
    return fetchCalDAVPendingInvites(credentials, from, to, deps.encryptionKey);
  }

  return Promise.resolve([]);
};

const getPendingInvitesMutation = async (
  deps: MutationDependencies,
  userId: string,
  calendarId: string,
  from: string,
  to: string,
): Promise<PendingInvite[]> => {
  const credentials = await resolveCredentialsByCalendarId(deps.database, userId, calendarId);

  if (!credentials) {
    return [];
  }

  const invites = await fetchPendingInvitesForCalendar(credentials, from, to, deps);

  invites.sort((left, right) =>
    new Date(left.startTime).getTime() - new Date(right.startTime).getTime(),
  );

  return invites;
};

export { completeUpdateRange, createEventMutation, updateEventMutation, deleteEventMutation, rsvpEventMutation, getPendingInvitesMutation };
export type { MutationDependencies, OAuthTokenRefresher };
