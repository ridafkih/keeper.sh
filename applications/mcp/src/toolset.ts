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
  timezone: z.string().describe("IANA timezone identifier (e.g. America/New_York)"),
} satisfies Record<string, z.ZodTypeAny>;

const isEventRangeInput = (
  input: Record<string, unknown>,
): input is Record<string, unknown> & { from: string; to: string; timezone: string } =>
  typeof input.from === "string" && typeof input.to === "string" && typeof input.timezone === "string";

const normalizeTimezoneOffset = (raw: string): string => {
  if (raw === "") {
    return "+00:00";
  }
  if (raw.includes(":")) {
    return raw.padStart(6, "+0");
  }
  return `${raw.padStart(3, "+0")}:00`;
};

const toLocalizedTime = (utcIso: string, timeZone: string): string => {
  const date = new Date(utcIso);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "shortOffset",
  }).formatToParts(date);

  const getPartValue = (type: Intl.DateTimeFormatPartTypes): string => {
    const part = parts.find((part) => part.type === type);
    if (!part) {
      return "";
    }
    return part.value;
  };

  const offset = getPartValue("timeZoneName").replace("GMT", "");
  const normalizedOffset = normalizeTimezoneOffset(offset);

  const year = getPartValue("year");
  const month = getPartValue("month");
  const day = getPartValue("day");
  const hour = getPartValue("hour");
  const minute = getPartValue("minute");
  const second = getPartValue("second");

  return `${year}-${month}-${day}T${hour}:${minute}:${second}${normalizedOffset}`;
};

const localizeEvent = (event: KeeperEvent, timeZone: string) => ({
  ...event,
  startTime: toLocalizedTime(event.startTime, timeZone),
  endTime: toLocalizedTime(event.endTime, timeZone),
});

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
      "Get calendar events within a date range. Provide ISO 8601 datetimes for 'from' and 'to', and an IANA timezone (e.g. America/New_York) to localize event times.",
    inputSchema: eventRangeSchema,
    execute: async ({ userId }, input) => {
      if (!input || !isEventRangeInput(input)) {
        throw new Error("'from', 'to', and 'timezone' are required");
      }
      const events = await readModels.getEventsInRange(userId, input);
      return events.map((event) => localizeEvent(event, input.timezone));
    },
  },
});

export { createKeeperMcpToolset };
export type { KeeperCalendar, KeeperMcpToolDefinition, KeeperMcpToolset, KeeperToolContext };
