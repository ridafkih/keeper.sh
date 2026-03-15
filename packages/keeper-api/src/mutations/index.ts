import { userEventsTable } from "@keeper.sh/database/schema";
import { eq } from "drizzle-orm";
import type { KeeperDatabase } from "../types";
import type {
  EventInput,
  EventUpdateInput,
  EventActionResult,
  EventCreateResult,
  PendingInvite,
  ProviderCredentials,
  RsvpStatus,
} from "../mutation-types";
import { resolveCredentialsByCalendarId, resolveCredentialsByEventId } from "./resolve-credentials";
import { getEvent } from "../queries/get-event";
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
  encryptionKey?: string;
}

const TOKEN_REFRESH_BUFFER_MS = 60_000;

const CALDAV_PROVIDERS = new Set(["caldav", "fastmail", "icloud"]);

const ensureValidAccessToken = async (
  provider: string,
  oauth: { accessToken: string; refreshToken: string; expiresAt: Date },
  refresher?: OAuthTokenRefresher,
): Promise<string> => {
  if (oauth.expiresAt.getTime() > Date.now() + TOKEN_REFRESH_BUFFER_MS) {
    return oauth.accessToken;
  }

  if (!refresher) {
    return oauth.accessToken;
  }

  const oauthProvider = refresher.getProvider(provider);
  if (!oauthProvider) {
    return oauth.accessToken;
  }

  const result = await oauthProvider.refreshAccessToken(oauth.refreshToken);
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
    deps.oauthTokenRefresher,
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
  sourceEventUid: string,
  updates: EventUpdateInput,
  deps: MutationDependencies,
): Promise<EventActionResult> => {
  if (credentials.oauth) {
    const accessToken = await ensureValidAccessToken(
      credentials.provider,
      credentials.oauth,
      deps.oauthTokenRefresher,
    );

    if (credentials.provider === "google") {
      return updateGoogleEvent(accessToken, credentials.externalCalendarId, sourceEventUid, updates);
    }

    if (credentials.provider === "outlook") {
      return updateOutlookEvent(accessToken, sourceEventUid, updates);
    }

    return { success: false, error: `Unsupported OAuth provider: ${credentials.provider}` };
  }

  if (credentials.caldav && CALDAV_PROVIDERS.has(credentials.provider) && deps.encryptionKey && credentials.calendarUrl) {
    return updateCalDAVEvent(
      {
        serverUrl: credentials.caldav.serverUrl,
        calendarUrl: credentials.calendarUrl,
        username: credentials.caldav.username,
        encryptedPassword: credentials.caldav.encryptedPassword,
        encryptionKey: deps.encryptionKey,
      },
      sourceEventUid,
      updates,
    );
  }

  return { success: false, error: "Calendar provider not supported for event updates." };
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
  if ("startTime" in updates) {
    dbUpdates.startTime = new Date(updates.startTime as string);
  }
  if ("endTime" in updates) {
    dbUpdates.endTime = new Date(updates.endTime as string);
  }
  if ("isAllDay" in updates) {
    dbUpdates.isAllDay = updates.isAllDay;
  }
  if ("availability" in updates) {
    dbUpdates.availability = updates.availability;
  }

  return dbUpdates;
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
    return { success: false, error: "Synced events cannot be updated. Only user-created events can be modified." };
  }

  const { credentials, sourceEventUid } = resolved;

  if (!sourceEventUid) {
    return { success: false, error: "Event cannot be updated (no source UID)." };
  }

  const providerResult = await dispatchUpdateEvent(credentials, sourceEventUid, updates, deps);

  if (!providerResult.success) {
    return providerResult;
  }

  const dbUpdates = buildDbUpdates(updates);

  if (Object.keys(dbUpdates).length > 0) {
    await deps.database
      .update(userEventsTable)
      .set(dbUpdates)
      .where(eq(userEventsTable.id, eventId));
  }

  return { success: true };
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
    return { success: false, error: "Synced events cannot be deleted. Only user-created events can be removed." };
  }

  const { credentials, sourceEventUid } = resolved;

  if (sourceEventUid) {
    if (credentials.oauth) {
      const accessToken = await ensureValidAccessToken(
        credentials.provider,
        credentials.oauth,
        deps.oauthTokenRefresher,
      );

      if (credentials.provider === "google") {
        const result = await deleteGoogleEvent(accessToken, credentials.externalCalendarId, sourceEventUid);
        if (!result.success) {
          return result;
        }
      } else if (credentials.provider === "outlook") {
        const result = await deleteOutlookEvent(accessToken, sourceEventUid);
        if (!result.success) {
          return result;
        }
      }
    } else if (credentials.caldav && CALDAV_PROVIDERS.has(credentials.provider) && deps.encryptionKey && credentials.calendarUrl) {
      const result = await deleteCalDAVEvent(
        {
          serverUrl: credentials.caldav.serverUrl,
          calendarUrl: credentials.calendarUrl,
          username: credentials.caldav.username,
          encryptedPassword: credentials.caldav.encryptedPassword,
          encryptionKey: deps.encryptionKey,
        },
        sourceEventUid,
      );
      if (!result.success) {
        return result;
      }
    }
  }

  await deps.database
    .delete(userEventsTable)
    .where(eq(userEventsTable.id, eventId));

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

  const { credentials, sourceEventUid } = resolved;

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
      deps.oauthTokenRefresher,
    );

    if (credentials.provider === "google") {
      return rsvpGoogleEvent(accessToken, credentials.externalCalendarId, sourceEventUid, status, credentials.email);
    }

    if (credentials.provider === "outlook") {
      return rsvpOutlookEvent(accessToken, sourceEventUid, status);
    }

    return { success: false, error: `RSVP not supported for provider: ${credentials.provider}` };
  }

  if (credentials.caldav && CALDAV_PROVIDERS.has(credentials.provider) && deps.encryptionKey && credentials.calendarUrl) {
    return rsvpCalDAVEvent(
      {
        serverUrl: credentials.caldav.serverUrl,
        calendarUrl: credentials.calendarUrl,
        username: credentials.caldav.username,
        encryptedPassword: credentials.caldav.encryptedPassword,
        encryptionKey: deps.encryptionKey,
      },
      sourceEventUid,
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
  refresher?: OAuthTokenRefresher,
): Promise<PendingInvite[]> => {
  if (!credentials.oauth) {
    return [];
  }

  const accessToken = await ensureValidAccessToken(
    credentials.provider,
    credentials.oauth,
    refresher,
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
    return fetchOAuthPendingInvites(credentials, from, to, deps.oauthTokenRefresher);
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

export { createEventMutation, updateEventMutation, deleteEventMutation, rsvpEventMutation, getPendingInvitesMutation };
export type { MutationDependencies, OAuthTokenRefresher };
