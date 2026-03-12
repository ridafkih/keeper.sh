import { z } from "zod";
import type {
  KeeperDestination,
  KeeperEvent,
  KeeperMapping,
  KeeperReadModels,
  KeeperSource,
  KeeperSyncStatus,
} from "./read-models";

interface KeeperToolContext {
  userId: string;
}

interface KeeperMcpToolDefinition<TResult, TInput = undefined> {
  description: string;
  title: string;
  inputSchema?: Record<string, z.ZodTypeAny>;
  execute: (context: KeeperToolContext, input?: TInput) => Promise<TResult>;
}

interface KeeperMcpEventRangeInput {
  from: string;
  to: string;
}

interface KeeperMcpToolset {
  list_sources: KeeperMcpToolDefinition<KeeperSource[]>;
  list_destinations: KeeperMcpToolDefinition<KeeperDestination[]>;
  list_mappings: KeeperMcpToolDefinition<KeeperMapping[]>;
  get_sync_status: KeeperMcpToolDefinition<KeeperSyncStatus[]>;
  get_event_count: KeeperMcpToolDefinition<number>;
  get_events_range: KeeperMcpToolDefinition<KeeperEvent[], KeeperMcpEventRangeInput>;
}

const eventRangeSchema = {
  from: z.string().datetime(),
  to: z.string().datetime(),
} satisfies Record<string, z.ZodTypeAny>;

const createKeeperMcpToolset = (readModels: KeeperReadModels): KeeperMcpToolset => ({
  list_sources: {
    title: "List sources",
    description: "List the signed-in Keeper user's connected source calendars.",
    execute: ({ userId }) => readModels.listSources(userId),
  },
  list_destinations: {
    title: "List destinations",
    description: "List the signed-in Keeper user's destination calendar accounts.",
    execute: ({ userId }) => readModels.listDestinations(userId),
  },
  list_mappings: {
    title: "List mappings",
    description: "List the signed-in Keeper user's source-to-destination sync mappings.",
    execute: ({ userId }) => readModels.listMappings(userId),
  },
  get_sync_status: {
    title: "Get sync status",
    description: "Get the current sync status for the signed-in Keeper user's destination calendars.",
    execute: ({ userId }) => readModels.getSyncStatuses(userId),
  },
  get_event_count: {
    title: "Get event count",
    description: "Count synced events available to the signed-in Keeper user.",
    execute: ({ userId }) => readModels.getEventCount(userId),
  },
  get_events_range: {
    title: "Get events in range",
    description: "List synced events for the signed-in Keeper user within an ISO datetime range.",
    inputSchema: eventRangeSchema,
    execute: ({ userId }, input) => {
      if (!input) {
        throw new Error("Event range is required");
      }

      return readModels.getEventsInRange(userId, input);
    },
  },
});

export { createKeeperMcpToolset };
export type {
  KeeperMcpEventRangeInput,
  KeeperMcpToolDefinition,
  KeeperMcpToolset,
  KeeperToolContext,
};
