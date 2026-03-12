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

interface KeeperCalendar {
  id: string;
  name: string;
  provider: string;
  account: string;
}

interface KeeperMcpToolset {
  list_calendars: KeeperMcpToolDefinition<KeeperCalendar[]>;
  get_event_count: KeeperMcpToolDefinition<{ count: number }>;
  get_events: KeeperMcpToolDefinition<KeeperEvent[]>;
}

const eventRangeSchema = {
  from: z.string().datetime(),
  to: z.string().datetime(),
} satisfies Record<string, z.ZodTypeAny>;

const isEventRangeInput = (
  input: Record<string, unknown>,
): input is Record<string, unknown> & { from: string; to: string } =>
  typeof input.from === "string" && typeof input.to === "string";

const toCalendar = (source: KeeperSource): KeeperCalendar => ({
  id: source.id,
  name: source.name,
  provider: source.providerName,
  account: source.accountLabel,
});

const createKeeperMcpToolset = (readModels: KeeperApi): KeeperMcpToolset => ({
  list_calendars: {
    title: "List calendars",
    description:
      "List all calendars the user has connected to Keeper, including provider name and account.",
    execute: async ({ userId }) => {
      const sources = await readModels.listSources(userId);
      return sources.map((source) => toCalendar(source));
    },
  },
  get_event_count: {
    title: "Get event count",
    description: "Get the total number of calendar events synced to Keeper.",
    execute: async ({ userId }) => {
      const count = await readModels.getEventCount(userId);
      return { count };
    },
  },
  get_events: {
    title: "Get events",
    description:
      "Get calendar events within a date range. Provide ISO 8601 datetimes for 'from' and 'to' (e.g. 2025-06-01T00:00:00Z).",
    inputSchema: eventRangeSchema,
    execute: ({ userId }, input) => {
      if (!input || !isEventRangeInput(input)) {
        throw new Error("'from' and 'to' ISO datetime strings are required");
      }
      return readModels.getEventsInRange(userId, input);
    },
  },
});

export { createKeeperMcpToolset };
export type { KeeperCalendar, KeeperMcpToolDefinition, KeeperMcpToolset, KeeperToolContext };
