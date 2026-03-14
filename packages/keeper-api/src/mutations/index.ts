import { userEventsTable } from "@keeper.sh/database/schema";
import { eq } from "drizzle-orm";
import type { KeeperDatabase, KeeperEvent } from "../types";
import type {
  EventInput,
  EventUpdateInput,
  EventActionResult,
  EventCreateResult,
  RsvpStatus,
} from "../mutation-types";
import { resolveCredentialsByCalendarId, resolveCredentialsByUserEventId } from "./resolve-credentials";
import { getEvent } from "../queries/get-event";
import {
  createGoogleEvent,
  updateGoogleEvent,
  deleteGoogleEvent,
  rsvpGoogleEvent,
} from "./providers/google";
import {
  createOutlookEvent,
  updateOutlookEvent,
  deleteOutlookEvent,
  rsvpOutlookEvent,
} from "./providers/outlook";
import {
  createCalDAVEvent,
  updateCalDAVEvent,
  deleteCalDAVEvent,
  rsvpCalDAVEvent,
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

const createEventMutation = async (
  deps: MutationDependencies,
  userId: string,
  input: EventInput,
): Promise<EventCreateResult> => {
  const credentials = await resolveCredentialsByCalendarId(deps.database, userId, input.calendarId);

  if (!credentials) {
    return { success: false, error: "Calendar not found or requires reauthentication." };
  }

  let sourceEventUid: string | undefined;

  if (credentials.oauth) {
    const accessToken = await ensureValidAccessToken(
      credentials.provider,
      credentials.oauth,
      deps.oauthTokenRefresher,
    );

    if (credentials.provider === "google") {
      const result = await createGoogleEvent(accessToken, credentials.externalCalendarId, input);
      if (!result.success) {
        return result;
      }
      sourceEventUid = result.sourceEventUid;
    } else if (credentials.provider === "outlook") {
      const result = await createOutlookEvent(accessToken, input);
      if (!result.success) {
        return result;
      }
      sourceEventUid = result.sourceEventUid;
    } else {
      return { success: false, error: `Unsupported OAuth provider: ${credentials.provider}` };
    }
  } else if (credentials.caldav && CALDAV_PROVIDERS.has(credentials.provider) && deps.encryptionKey && credentials.calendarUrl) {
    const result = await createCalDAVEvent(
      {
        serverUrl: credentials.caldav.serverUrl,
        calendarUrl: credentials.calendarUrl,
        username: credentials.caldav.username,
        encryptedPassword: credentials.caldav.encryptedPassword,
        encryptionKey: deps.encryptionKey,
      },
      input,
    );
    if (!result.success) {
      return result;
    }
    sourceEventUid = result.sourceEventUid;
  } else {
    return { success: false, error: "Calendar provider not supported for event creation." };
  }

  const [inserted] = await deps.database
    .insert(userEventsTable)
    .values({
      calendarId: input.calendarId,
      userId,
      sourceEventUid: sourceEventUid ?? null,
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
  return { success: true, event: event ?? undefined };
};

const updateEventMutation = async (
  deps: MutationDependencies,
  userId: string,
  eventId: string,
  updates: EventUpdateInput,
): Promise<EventActionResult> => {
  const resolved = await resolveCredentialsByUserEventId(deps.database, userId, eventId);

  if (!resolved) {
    return { success: false, error: "Event not found." };
  }

  const { credentials, sourceEventUid } = resolved;

  if (!sourceEventUid) {
    return { success: false, error: "Event cannot be updated (no source UID)." };
  }

  if (credentials.oauth) {
    const accessToken = await ensureValidAccessToken(
      credentials.provider,
      credentials.oauth,
      deps.oauthTokenRefresher,
    );

    if (credentials.provider === "google") {
      const result = await updateGoogleEvent(accessToken, credentials.externalCalendarId, sourceEventUid, updates);
      if (!result.success) {
        return result;
      }
    } else if (credentials.provider === "outlook") {
      const result = await updateOutlookEvent(accessToken, sourceEventUid, updates);
      if (!result.success) {
        return result;
      }
    } else {
      return { success: false, error: `Unsupported OAuth provider: ${credentials.provider}` };
    }
  } else if (credentials.caldav && CALDAV_PROVIDERS.has(credentials.provider) && deps.encryptionKey && credentials.calendarUrl) {
    const result = await updateCalDAVEvent(
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
    if (!result.success) {
      return result;
    }
  } else {
    return { success: false, error: "Calendar provider not supported for event updates." };
  }

  const dbUpdates: Record<string, unknown> = {};
  if (updates.title !== undefined) {
    dbUpdates.title = updates.title;
  }
  if (updates.description !== undefined) {
    dbUpdates.description = updates.description;
  }
  if (updates.location !== undefined) {
    dbUpdates.location = updates.location;
  }
  if (updates.startTime !== undefined) {
    dbUpdates.startTime = new Date(updates.startTime);
  }
  if (updates.endTime !== undefined) {
    dbUpdates.endTime = new Date(updates.endTime);
  }
  if (updates.isAllDay !== undefined) {
    dbUpdates.isAllDay = updates.isAllDay;
  }
  if (updates.availability !== undefined) {
    dbUpdates.availability = updates.availability;
  }

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
  const resolved = await resolveCredentialsByUserEventId(deps.database, userId, eventId);

  if (!resolved) {
    return { success: false, error: "Event not found." };
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
  const resolved = await resolveCredentialsByUserEventId(deps.database, userId, eventId);

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

export { createEventMutation, updateEventMutation, deleteEventMutation, rsvpEventMutation };
export type { MutationDependencies, OAuthTokenRefresher };
