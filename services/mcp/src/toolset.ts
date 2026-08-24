import { z } from "zod";

const keeperEventSchema = z.object({
  id: z.string(),
  eventStateId: z.string().uuid().nullable(),
  startTime: z.string(),
  endTime: z.string(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  location: z.string().nullable(),
  calendarId: z.string(),
  calendarName: z.string(),
  calendarProvider: z.string(),
  calendarUrl: z.string().nullable(),
});

type KeeperEvent = z.infer<typeof keeperEventSchema>;

interface KeeperToolContext {
  bearerToken: string;
  apiBaseUrl: string;
}

interface KeeperMcpToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint?: boolean;
  openWorldHint: boolean;
}

interface KeeperMcpToolDefinition<TResult> {
  description: string;
  title: string;
  annotations: KeeperMcpToolAnnotations;
  inputSchema?: Record<string, z.ZodTypeAny>;
  execute: (context: KeeperToolContext, input?: Record<string, unknown>) => Promise<TResult>;
}

const READ_ONLY: KeeperMcpToolAnnotations = {
  readOnlyHint: true,
  openWorldHint: false,
};

const ADDITIVE: KeeperMcpToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: false,
};

const DESTRUCTIVE: KeeperMcpToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  openWorldHint: false,
};

const keeperCalendarSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: z.string(),
  account: z.string(),
});
type KeeperCalendar = z.infer<typeof keeperCalendarSchema>;

const keeperFreeSlotSchema = z.object({
  start: z.string(),
  end: z.string(),
  durationMinutes: z.number(),
});

const keeperFreeTimeSchema = z.object({
  from: z.string(),
  to: z.string(),
  timezone: z.string(),
  durationMinutes: z.number(),
  slots: z.array(keeperFreeSlotSchema),
});
type KeeperFreeTime = z.infer<typeof keeperFreeTimeSchema>;

const keeperSyncTriggerSchema = z.object({
  triggered: z.boolean(),
  sourcesRefreshed: z.number(),
});
type KeeperSyncTrigger = z.infer<typeof keeperSyncTriggerSchema>;

const keeperCalendarPauseSchema = z.object({
  calendarId: z.string(),
  paused: z.boolean(),
});
type KeeperCalendarPause = z.infer<typeof keeperCalendarPauseSchema>;

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
  find_free_time: KeeperMcpToolDefinition<KeeperFreeTime>;
  trigger_sync: KeeperMcpToolDefinition<KeeperSyncTrigger>;
  pause_sync: KeeperMcpToolDefinition<KeeperCalendarPause>;
}

const isErrorResponse = (value: unknown): value is { error: string } =>
  typeof value === "object" && value !== null && "error" in value && typeof value.error === "string";

const apiFetchRaw = async (
  context: KeeperToolContext,
  path: string,
  options?: RequestInit,
): Promise<unknown> => {
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
    const body: unknown = await response.json().catch(() => null);
    if (isErrorResponse(body)) {
      throw new Error(body.error);
    }
    throw new Error(response.statusText);
  }

  if (response.status === 204) {
    return {};
  }

  return response.json();
};

const apiFetch = async <TResult>(
  context: KeeperToolContext,
  path: string,
  schema: z.ZodType<TResult>,
  options?: RequestInit,
): Promise<TResult> => {
  const raw = await apiFetchRaw(context, path, options);
  return schema.parse(raw);
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

const TIMEZONE_OFFSET_PATTERN = /^([+-]?)(\d{1,2})(?::?(\d{2}))?$/;
const UTC_OFFSET = "+00:00";
const DEFAULT_MINUTES = "00";

const normalizeTimezoneOffset = (raw: string): string => {
  if (raw === "") {
    return UTC_OFFSET;
  }
  const match = TIMEZONE_OFFSET_PATTERN.exec(raw);
  if (!match) {
    return raw;
  }
  let sign: "+" | "-" = "+";
  if (match[1] === "-") {
    sign = "-";
  }
  const hours = (match[2] ?? "00").padStart(2, "0");
  const minutes = (match[3] ?? DEFAULT_MINUTES).padStart(2, "0");
  return `${sign}${hours}:${minutes}`;
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

const FREE_TIME_OPTIONAL_PARAMS = [
  "workingHoursStart",
  "workingHoursEnd",
  "workingDays",
  "calendarId",
  "ignoreAllDayEvents",
  "limit",
] as const;

const toParamValue = (value: unknown): string | null => {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
};

const buildFreeTimeParams = (
  input: Record<string, unknown> & { from: string; to: string; timezone: string },
  durationMinutes: number,
): URLSearchParams =>
  new URLSearchParams([
    ["from", input.from],
    ["to", input.to],
    ["timezone", input.timezone],
    ["durationMinutes", String(durationMinutes)],
    ...FREE_TIME_OPTIONAL_PARAMS.flatMap((key) => {
      const value = toParamValue(input[key]);
      if (value === null) {
        return [];
      }
      return [[key, value] satisfies [string, string]];
    }),
  ]);

const localizeFreeTime = (freeTime: KeeperFreeTime): KeeperFreeTime => ({
  ...freeTime,
  slots: freeTime.slots.map((slot) => ({
    ...slot,
    start: toLocalizedTime(slot.start, freeTime.timezone),
    end: toLocalizedTime(slot.end, freeTime.timezone),
  })),
});

const createKeeperMcpToolset = (): KeeperMcpToolset => ({
  list_calendars: {
    title: "List calendars",
    annotations: READ_ONLY,
    description:
      "List all calendars the user has connected to Keeper.sh, including provider name and account.",
    execute: (context) => apiFetch(context, "/api/v1/calendars", z.array(keeperCalendarSchema)),
  },
  get_event_count: {
    title: "Get event count",
    annotations: READ_ONLY,
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
      return apiFetch(context, `/api/v1/events?${params}`, z.object({ count: z.number() }));
    },
  },
  get_events: {
    title: "Get events",
    annotations: READ_ONLY,
    description:
      "Get calendar events within a date range. Provide ISO 8601 datetimes for 'from' and 'to', and an IANA timezone (e.g. America/New_York) to localize event times.",
    inputSchema: eventRangeSchema,
    execute: async (context, input) => {
      if (!input || !isEventRangeInput(input)) {
        throw new Error("'from', 'to', and 'timezone' are required");
      }
      const params = new URLSearchParams({ from: input.from, to: input.to });
      const events = await apiFetch(context, `/api/v1/events?${params}`, z.array(keeperEventSchema));
      return events.map((event) => localizeEvent(event, input.timezone));
    },
  },
  get_event: {
    title: "Get event",
    annotations: READ_ONLY,
    description: "Get a single calendar event by its ID.",
    inputSchema: {
      eventId: z.string().describe("The event ID returned by get_events"),
    },
    execute: (context, input) => {
      if (!input?.eventId || typeof input.eventId !== "string") {
        throw new Error("'eventId' is required");
      }
      return apiFetch(context, `/api/v1/events/${input.eventId}`, keeperEventSchema);
    },
  },
  create_event: {
    title: "Create event",
    annotations: ADDITIVE,
    description:
      "Create a new calendar event on a connected calendar. Requires calendarId, title, startTime, and endTime. Pass an IANA timezone so the event renders in local time on CalDAV calendars (iCloud, Fastmail) instead of GMT.",
    inputSchema: {
      calendarId: z.string().uuid().describe("The calendar to create the event on"),
      title: z.string().describe("Event title"),
      description: z.string().optional().describe("Event description"),
      location: z.string().optional().describe("Event location"),
      startTime: z.string().datetime().describe("Start time in ISO 8601 format"),
      endTime: z.string().datetime().describe("End time in ISO 8601 format"),
      isAllDay: z.boolean().optional().describe("Whether the event is all-day"),
      availability: z.enum(["busy", "free"]).optional().describe("Availability status"),
      timezone: z
        .string()
        .optional()
        .describe("IANA timezone identifier (e.g. America/New_York) the event's local time is in"),
    },
    execute: (context, input) => {
      if (!input?.calendarId || !input?.title || !input?.startTime || !input?.endTime) {
        throw new Error("'calendarId', 'title', 'startTime', and 'endTime' are required");
      }
      return apiFetch(context, "/api/v1/events", keeperEventSchema, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
  },
  update_event: {
    title: "Update event",
    annotations: DESTRUCTIVE,
    description:
      "Update an existing calendar event. Only provided fields are updated.",
    inputSchema: {
      eventId: z.string().describe("The event ID returned by get_events"),
      title: z.string().optional().describe("Updated event title"),
      description: z.string().optional().describe("Updated event description"),
      location: z.string().optional().describe("Updated event location"),
      startTime: z.string().datetime().optional().describe("Updated start time"),
      endTime: z.string().datetime().optional().describe("Updated end time"),
      isAllDay: z.boolean().optional().describe("Whether the event is all-day"),
      availability: z.enum(["busy", "free"]).optional().describe("Updated availability"),
      timezone: z
        .string()
        .optional()
        .describe("IANA timezone identifier (e.g. America/New_York) the event's local time is in"),
    },
    execute: (context, input) => {
      if (!input?.eventId || typeof input.eventId !== "string") {
        throw new Error("'eventId' is required");
      }
      const { eventId, ...updates } = input;
      return apiFetch(context, `/api/v1/events/${eventId}`, keeperEventSchema, {
        method: "PATCH",
        body: JSON.stringify(updates),
      });
    },
  },
  delete_event: {
    title: "Delete event",
    annotations: DESTRUCTIVE,
    description: "Delete a calendar event by its ID.",
    inputSchema: {
      eventId: z.string().describe("The event ID returned by get_events"),
    },
    execute: async (context, input) => {
      if (!input?.eventId || typeof input.eventId !== "string") {
        throw new Error("'eventId' is required");
      }
      await apiFetchRaw(context, `/api/v1/events/${input.eventId}`, {
        method: "DELETE",
      });
      return { deleted: true };
    },
  },
  rsvp_event: {
    title: "Respond to event invite",
    annotations: DESTRUCTIVE,
    description:
      "Respond to a calendar event invitation. Set rsvpStatus to 'accepted', 'declined', or 'tentative'.",
    inputSchema: {
      eventId: z.string().describe("The event ID returned by get_events"),
      rsvpStatus: z.enum(["accepted", "declined", "tentative"]).describe("The RSVP response"),
    },
    execute: (context, input) => {
      if (!input?.eventId || typeof input.eventId !== "string") {
        throw new Error("'eventId' is required");
      }
      if (!input?.rsvpStatus || typeof input.rsvpStatus !== "string") {
        throw new Error("'rsvpStatus' is required");
      }
      return apiFetch(context, `/api/v1/events/${input.eventId}`, z.object({ rsvpStatus: z.string() }), {
        method: "PATCH",
        body: JSON.stringify({ rsvpStatus: input.rsvpStatus }),
      });
    },
  },
  get_pending_invites: {
    title: "Get pending invites",
    annotations: READ_ONLY,
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
      return apiFetch(context, `/api/v1/calendars/${input.calendarId}/invites?${params}`, z.array(z.unknown()));
    },
  },
  list_accounts: {
    title: "List accounts",
    annotations: READ_ONLY,
    description: "List all connected calendar accounts with provider information.",
    execute: (context) => apiFetch(context, "/api/v1/accounts", z.array(z.unknown())),
  },
  get_ical_feed: {
    title: "Get iCal feed URL",
    annotations: READ_ONLY,
    description: "Get the user's iCal feed URL for subscribing in other calendar apps.",
    execute: (context) => apiFetch(context, "/api/v1/ical", z.object({ url: z.string() })),
  },
  find_free_time: {
    title: "Find free time",
    annotations: READ_ONLY,
    description:
      "Find open slots of at least 'durationMinutes' across every synced calendar in a date range. Events marked free or working-elsewhere never block; busy, out-of-office, and all-day events do. Optionally restrict candidates to working hours and weekdays in the given timezone. Returned slots are localized to that timezone.",
    inputSchema: {
      ...eventRangeSchema,
      durationMinutes: z
        .number()
        .int()
        .positive()
        .describe("Minimum length of a usable slot, in minutes"),
      workingHoursStart: z
        .string()
        .optional()
        .describe("Local start of the working day as 24-hour HH:MM (e.g. 09:00)"),
      workingHoursEnd: z
        .string()
        .optional()
        .describe("Local end of the working day as 24-hour HH:MM (e.g. 17:00)"),
      workingDays: z
        .string()
        .optional()
        .describe("Comma-separated local weekdays to consider, 0 for Sunday through 6 for Saturday"),
      calendarId: z
        .string()
        .optional()
        .describe("Comma-separated calendar IDs to consider instead of every calendar"),
      ignoreAllDayEvents: z
        .boolean()
        .optional()
        .describe("Treat all-day events as non-blocking"),
      limit: z.number().int().positive().optional().describe("Maximum number of slots to return"),
    },
    execute: async (context, input) => {
      if (!input || !isEventRangeInput(input)) {
        throw new Error("'from', 'to', and 'timezone' are required");
      }
      if (typeof input.durationMinutes !== "number") {
        throw new TypeError("'durationMinutes' is required");
      }
      const params = buildFreeTimeParams(input, input.durationMinutes);
      const freeTime = await apiFetch(
        context,
        `/api/v1/events/free-time?${params}`,
        keeperFreeTimeSchema,
      );
      return localizeFreeTime(freeTime);
    },
  },
  trigger_sync: {
    title: "Trigger sync",
    annotations: ADDITIVE,
    description:
      "Force Keeper.sh to sync now: clears the ingest backoff on every active source so they are polled on the next pass, and immediately enqueues a push to every destination calendar. Throttled to one request per minute per user.",
    execute: (context) =>
      apiFetch(context, "/api/v1/sync", keeperSyncTriggerSchema, { method: "POST" }),
  },
  pause_sync: {
    title: "Pause or resume calendar sync",
    annotations: DESTRUCTIVE,
    description:
      "Pause or resume syncing for a single calendar without disconnecting it. A paused calendar is neither polled for new events nor pushed to, in both directions, and its stored events are kept. Set paused to false to resume.",
    inputSchema: {
      calendarId: z.string().uuid().describe("The calendar ID returned by list_calendars"),
      paused: z.boolean().describe("True to pause syncing, false to resume"),
    },
    execute: (context, input) => {
      if (!input?.calendarId || typeof input.calendarId !== "string") {
        throw new Error("'calendarId' is required");
      }
      if (typeof input.paused !== "boolean") {
        throw new TypeError("'paused' is required");
      }
      return apiFetch(
        context,
        `/api/v1/calendars/${input.calendarId}`,
        keeperCalendarPauseSchema,
        {
          method: "PATCH",
          body: JSON.stringify({ paused: input.paused }),
        },
      );
    },
  },
});

export { createKeeperMcpToolset, normalizeTimezoneOffset, toLocalizedTime };
export type {
  KeeperCalendar,
  KeeperCalendarPause,
  KeeperFreeTime,
  KeeperMcpToolDefinition,
  KeeperMcpToolset,
  KeeperSyncTrigger,
  KeeperToolContext,
};
