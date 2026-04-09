import { getEventCount } from "./queries/get-event-count";
import { getEvent } from "./queries/get-event";
import { getEventsInRange, normalizeEventRange } from "./queries/get-events-in-range";
import { getSyncStatuses } from "./queries/get-sync-statuses";
import { listDestinations } from "./queries/list-destinations";
import { listMappings } from "./queries/list-mappings";
import { listSources } from "./queries/list-sources";
import {
  createEventMutation,
  updateEventMutation,
  deleteEventMutation,
  rsvpEventMutation,
  getPendingInvitesMutation,
} from "./mutations";
import type { OAuthTokenRefresher } from "./mutations";
import type { KeeperApi, KeeperDatabase } from "./types";

interface KeeperApiOptions {
  oauthTokenRefresher?: OAuthTokenRefresher;
  refreshLockStore?: import("@keeper.sh/calendar").RefreshLockStore | null;
  encryptionKey?: string;
}

const createKeeperApi = (database: KeeperDatabase, options?: KeeperApiOptions): KeeperApi => {
  const deps = {
    database,
    oauthTokenRefresher: options?.oauthTokenRefresher,
    refreshLockStore: options?.refreshLockStore,
    encryptionKey: options?.encryptionKey,
  };

  return {
    listSources: (userId) => listSources(database, userId),
    listDestinations: (userId) => listDestinations(database, userId),
    listMappings: (userId) => listMappings(database, userId),
    getEventsInRange: (userId, range, filters) => getEventsInRange(database, userId, range, filters),
    getEvent: (userId, eventId) => getEvent(database, userId, eventId),
    getEventCount: (userId, countOptions) => getEventCount(database, userId, countOptions),
    getSyncStatuses: (userId) => getSyncStatuses(database, userId),
    createEvent: (userId, input) => createEventMutation(deps, userId, input),
    updateEvent: (userId, eventId, updates) => updateEventMutation(deps, userId, eventId, updates),
    deleteEvent: (userId, eventId) => deleteEventMutation(deps, userId, eventId),
    rsvpEvent: (userId, eventId, status) => rsvpEventMutation(deps, userId, eventId, status),
    getPendingInvites: (userId, calendarId, from, to) => getPendingInvitesMutation(deps, userId, calendarId, from, to),
  };
};

export { createKeeperApi, normalizeEventRange };
export type { KeeperApiOptions };
