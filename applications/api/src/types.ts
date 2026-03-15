import type { BunSQLDatabase } from "drizzle-orm/bun-sql";

type KeeperDatabase = BunSQLDatabase;

export type { KeeperDatabase };
export type {
  KeeperApi,
  KeeperDestination,
  KeeperEvent,
  KeeperEventFilters,
  KeeperEventRangeInput,
  KeeperMapping,
  KeeperSource,
  KeeperSyncStatus,
} from "@keeper.sh/data-schemas";
export type {
  EventInput,
  EventUpdateInput,
  EventActionResult,
  EventCreateResult,
  PendingInvite,
  ProviderCredentials,
  RsvpStatus,
} from "@keeper.sh/data-schemas";
