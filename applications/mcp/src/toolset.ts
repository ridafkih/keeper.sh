import { z } from "zod";
import type {
  KeeperApi,
  KeeperEvent,
  KeeperSource,
} from "@keeper.sh/keeper-api";

interface KeeperToolContext {
  userId: string;
}

interface KeeperMcpToolDefinition<TResult> {
  description: string;
  title: string;
  inputSchema?: Record<string, z.ZodTypeAny>;
  execute: (context: KeeperToolContext, input?: Record<string, unknown>) => Promise<TResult>;
}

interface KeeperMcpToolset {
  list_calendars: KeeperMcpToolDefinition<KeeperSource[]>;
  get_event_count: KeeperMcpToolDefinition<number>;
  get_events: KeeperMcpToolDefinition<KeeperEvent[]>;
}

const eventRangeSchema = {
  from: z.string().datetime(),
  to: z.string().datetime(),
} satisfies Record<string, z.ZodTypeAny>;

const isEventRangeInput = (input: Record<string, unknown>): input is Record<string, unknown> & { from: string; to: string } => {
  if (typeof input.from !== "string") {
    return false;
  }
  if (typeof input.to !== "string") {
    return false;
  }
  return true;
};

const createKeeperMcpToolset = (readModels: KeeperApi): KeeperMcpToolset => ({
  list_calendars: {
    title: "List calendars",
    description: "List all calendars connected to your Keeper account, including provider and account details.",
    execute: ({ userId }) => readModels.listSources(userId),
  },
  get_event_count: {
    title: "Get event count",
    description: "Get the total number of synced calendar events available in your Keeper account.",
    execute: ({ userId }) => readModels.getEventCount(userId),
  },
  get_events: {
    title: "Get events",
    description: "List synced calendar events within an ISO 8601 datetime range (e.g. 2025-01-01T00:00:00Z to 2025-01-02T00:00:00Z).",
    inputSchema: eventRangeSchema,
    execute: ({ userId }, input) => {
      if (!input || !isEventRangeInput(input)) {
        throw new Error("Event range with 'from' and 'to' ISO datetime strings is required");
      }

      return readModels.getEventsInRange(userId, input);
    },
  },
});

export { createKeeperMcpToolset };
export type {
  KeeperMcpToolDefinition,
  KeeperMcpToolset,
  KeeperToolContext,
};
