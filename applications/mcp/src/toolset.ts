import { z } from "zod";
import type { KeeperEvent } from "@keeper.sh/data-schemas";

interface KeeperToolContext {
  bearerToken: string;
  apiBaseUrl: string;
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
  get_event: KeeperMcpToolDefinition<KeeperEvent | { error: string }>;
  create_event: KeeperMcpToolDefinition<KeeperEvent | { error: string }>;
  update_event: KeeperMcpToolDefinition<KeeperEvent | { error: string }>;
  delete_event: KeeperMcpToolDefinition<{ deleted: boolean } | { error: string }>;
  get_pending_invites: KeeperMcpToolDefinition<unknown[]>;
  rsvp_event: KeeperMcpToolDefinition<{ rsvpStatus: string } | { error: string }>;
  list_accounts: KeeperMcpToolDefinition<unknown[]>;
  get_ical_feed: KeeperMcpToolDefinition<{ url: string }>;
}

const apiFetch = async <TResult>(
  context: KeeperToolContext,
  path: string,
  options?: RequestInit,
): Promise<TResult> => {
  const url = `${context.apiBaseUrl}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      "Authorization": `Bearer ${context.bearerToken}`,
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const message = (body as { error?: string })?.error ?? response.statusText;
    throw new Error(message);
  }

  if (response.status === 204) {
    return {} as TResult;
  }

  return response.json() as Promise<TResult>;
};

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
    const part = parts.find(({ type: expectedType }) => expectedType === type);
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

const createKeeperMcpToolset = (): KeeperMcpToolset => ({
  list_calendars: {
    title: "List calendars",
    description:
      "List all calendars the user has connected to Keeper, including provider name and account.",
    execute: (context) => apiFetch<KeeperCalendar[]>(context, "/api/v1/calendars"),
  },
  get_event_count: {
    title: "Get event count",
    description:
      "Get the number of calendar events. Optionally provide a date range with 'from' and 'to' ISO 8601 datetimes.",
    inputSchema: {
      from: z.string().datetime().optional().describe("Start of date range (ISO 8601)"),
      to: z.string().datetime().optional().describe("End of date range (ISO 8601)"),
    },
    execute: (context, input) => {
      const params = new URLSearchParams({ count: "true" });
      if (input?.from && typeof input.from === "string") {
        params.set("from", input.from);
      }
      if (input?.to && typeof input.to === "string") {
        params.set("to", input.to);
      }
      return apiFetch<{ count: number }>(context, `/api/v1/events?${params}`);
    },
  },
  get_events: {
    title: "Get events",
    description:
      "Get calendar events within a date range. Provide ISO 8601 datetimes for 'from' and 'to', and an IANA timezone (e.g. America/New_York) to localize event times.",
    inputSchema: eventRangeSchema,
    execute: async (context, input) => {
      if (!input || !isEventRangeInput(input)) {
        throw new Error("'from', 'to', and 'timezone' are required");
      }
      const params = new URLSearchParams({ from: input.from, to: input.to });
      const events = await apiFetch<KeeperEvent[]>(context, `/api/v1/events?${params}`);
      return events.map((event) => localizeEvent(event, input.timezone));
    },
  },
  get_event: {
    title: "Get event",
    description: "Get a single calendar event by its ID.",
    inputSchema: {
      eventId: z.string().uuid().describe("The event ID"),
    },
    execute: (context, input) => {
      if (!input?.eventId || typeof input.eventId !== "string") {
        throw new Error("'eventId' is required");
      }
      return apiFetch<KeeperEvent>(context, `/api/v1/events/${input.eventId}`);
    },
  },
  create_event: {
    title: "Create event",
    description:
      "Create a new calendar event on a connected calendar. Requires calendarId, title, startTime, and endTime.",
    inputSchema: {
      calendarId: z.string().uuid().describe("The calendar to create the event on"),
      title: z.string().describe("Event title"),
      description: z.string().optional().describe("Event description"),
      location: z.string().optional().describe("Event location"),
      startTime: z.string().datetime().describe("Start time in ISO 8601 format"),
      endTime: z.string().datetime().describe("End time in ISO 8601 format"),
      isAllDay: z.boolean().optional().describe("Whether the event is all-day"),
      availability: z.enum(["busy", "free"]).optional().describe("Availability status"),
    },
    execute: (context, input) => {
      if (!input?.calendarId || !input?.title || !input?.startTime || !input?.endTime) {
        throw new Error("'calendarId', 'title', 'startTime', and 'endTime' are required");
      }
      return apiFetch<KeeperEvent>(context, "/api/v1/events", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
  },
  update_event: {
    title: "Update event",
    description:
      "Update an existing calendar event. Only provided fields are updated.",
    inputSchema: {
      eventId: z.string().uuid().describe("The event ID to update"),
      title: z.string().optional().describe("Updated event title"),
      description: z.string().optional().describe("Updated event description"),
      location: z.string().optional().describe("Updated event location"),
      startTime: z.string().datetime().optional().describe("Updated start time"),
      endTime: z.string().datetime().optional().describe("Updated end time"),
      isAllDay: z.boolean().optional().describe("Whether the event is all-day"),
      availability: z.enum(["busy", "free"]).optional().describe("Updated availability"),
    },
    execute: (context, input) => {
      if (!input?.eventId || typeof input.eventId !== "string") {
        throw new Error("'eventId' is required");
      }
      const { eventId, ...updates } = input;
      return apiFetch<KeeperEvent>(context, `/api/v1/events/${eventId}`, {
        method: "PATCH",
        body: JSON.stringify(updates),
      });
    },
  },
  delete_event: {
    title: "Delete event",
    description: "Delete a calendar event by its ID.",
    inputSchema: {
      eventId: z.string().uuid().describe("The event ID to delete"),
    },
    execute: async (context, input) => {
      if (!input?.eventId || typeof input.eventId !== "string") {
        throw new Error("'eventId' is required");
      }
      await apiFetch(context, `/api/v1/events/${input.eventId}`, {
        method: "DELETE",
      });
      return { deleted: true };
    },
  },
  rsvp_event: {
    title: "Respond to event invite",
    description:
      "Respond to a calendar event invitation. Set rsvpStatus to 'accepted', 'declined', or 'tentative'.",
    inputSchema: {
      eventId: z.string().uuid().describe("The event ID to respond to"),
      rsvpStatus: z.enum(["accepted", "declined", "tentative"]).describe("The RSVP response"),
    },
    execute: (context, input) => {
      if (!input?.eventId || typeof input.eventId !== "string") {
        throw new Error("'eventId' is required");
      }
      if (!input?.rsvpStatus || typeof input.rsvpStatus !== "string") {
        throw new Error("'rsvpStatus' is required");
      }
      return apiFetch<{ rsvpStatus: string }>(context, `/api/v1/events/${input.eventId}`, {
        method: "PATCH",
        body: JSON.stringify({ rsvpStatus: input.rsvpStatus }),
      });
    },
  },
  get_pending_invites: {
    title: "Get pending invites",
    description:
      "Get calendar event invitations that have not been responded to within a date range for a specific calendar.",
    inputSchema: {
      calendarId: z.string().uuid().describe("The calendar ID to check for pending invites"),
      ...eventRangeSchema,
    },
    execute: (context, input) => {
      if (!input?.calendarId || typeof input.calendarId !== "string") {
        throw new Error("'calendarId' is required");
      }
      if (!input || !isEventRangeInput(input)) {
        throw new Error("'from', 'to', and 'timezone' are required");
      }
      const params = new URLSearchParams({ from: input.from, to: input.to });
      return apiFetch<unknown[]>(context, `/api/v1/calendars/${input.calendarId}/invites?${params}`);
    },
  },
  list_accounts: {
    title: "List accounts",
    description: "List all connected calendar accounts with provider information.",
    execute: (context) => apiFetch<unknown[]>(context, "/api/v1/accounts"),
  },
  get_ical_feed: {
    title: "Get iCal feed URL",
    description: "Get the user's iCal feed URL for subscribing in other calendar apps.",
    execute: (context) => apiFetch<{ url: string }>(context, "/api/v1/ical"),
  },
});

export { createKeeperMcpToolset };
export type { KeeperCalendar, KeeperMcpToolDefinition, KeeperMcpToolset, KeeperToolContext };
