import { getEventCount } from "./queries/get-event-count";
import { getEventsInRange, normalizeEventRange } from "./queries/get-events-in-range";
import { getSyncStatuses } from "./queries/get-sync-statuses";
import { listDestinations } from "./queries/list-destinations";
import { listMappings } from "./queries/list-mappings";
import { listSources } from "./queries/list-sources";
import type { KeeperApi, KeeperDatabase } from "./types";

const createKeeperApi = (database: KeeperDatabase): KeeperApi => ({
  listSources: (userId) => listSources(database, userId),
  listDestinations: (userId) => listDestinations(database, userId),
  listMappings: (userId) => listMappings(database, userId),
  getEventsInRange: (userId, range) => getEventsInRange(database, userId, range),
  getEventCount: (userId) => getEventCount(database, userId),
  getSyncStatuses: (userId) => getSyncStatuses(database, userId),
});

export { createKeeperApi, normalizeEventRange };
