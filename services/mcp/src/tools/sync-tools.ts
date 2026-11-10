import { z } from "zod";
import {
  EXCLUDABLE_AVAILABILITY_DEFINITIONS,
  MAX_EXCLUDE_TITLE_KEYWORDS,
  MAX_EXCLUDE_TITLE_KEYWORD_LENGTH,
  SYNC_RANGE_DEFINITIONS,
} from "@keeper.sh/data-schemas";
import {
  ADDITIVE,
  DESTRUCTIVE,
  READ_ONLY,
  apiFetch,
  pickProvided,
  requireString,
  ToolInputError,
  requireStringArray,
} from "../tool-api";
import type { KeeperMcpToolDefinition } from "../tool-api";

const keeperSyncSchema = z.object({
  sourceCalendarId: z.string(),
  destinationCalendarId: z.string(),
});
type KeeperSync = z.infer<typeof keeperSyncSchema>;

const keeperSyncDestinationsSchema = z.object({
  calendarId: z.string(),
  destinationCalendarIds: z.array(z.string()),
});
type KeeperSyncDestinations = z.infer<typeof keeperSyncDestinationsSchema>;

const keeperCalendarSettingsSchema = z.record(z.string(), z.unknown());
type KeeperCalendarSettings = z.infer<typeof keeperCalendarSettingsSchema>;

const keeperCalendarRefreshSchema = z.record(z.string(), z.unknown());
type KeeperCalendarRefresh = z.infer<typeof keeperCalendarRefreshSchema>;

const syncRangeSchema = z.enum(SYNC_RANGE_DEFINITIONS.map(({ value }) => value));
const excludableAvailabilitySchema = z.enum(
  EXCLUDABLE_AVAILABILITY_DEFINITIONS.map(({ value }) => value),
);

const CALENDAR_SETTING_FIELDS = [
  "customEventName",
  "excludeAllDayEvents",
  "excludeAvailabilities",
  "excludeEventDescription",
  "excludeEventLocation",
  "excludeEventName",
  "excludeFocusTime",
  "excludeOutOfOffice",
  "excludeTitleKeywords",
  "markEventsAsPrivate",
  "disableEventReminders",
  "syncFutureRange",
  "syncHistoricRange",
  "treatFullDayTimedEventsAsAllDay",
] as const;

const calendarIdSchema = z.string().uuid().describe("The calendar ID returned by list_calendars");

const calendarSettingsPath = (calendarId: string): string =>
  `/api/v1/calendars/${calendarId}/settings`;

interface KeeperSyncToolset {
  list_syncs: KeeperMcpToolDefinition<KeeperSync[]>;
  set_sync_destinations: KeeperMcpToolDefinition<KeeperSyncDestinations>;
  get_calendar_settings: KeeperMcpToolDefinition<KeeperCalendarSettings>;
  update_calendar_settings: KeeperMcpToolDefinition<KeeperCalendarSettings>;
  rename_calendar: KeeperMcpToolDefinition<KeeperCalendarSettings>;
  refresh_calendars: KeeperMcpToolDefinition<KeeperCalendarRefresh>;
}

const createSyncToolset = (): KeeperSyncToolset => ({
  list_syncs: {
    title: "List syncs",
    annotations: READ_ONLY,
    description:
      "List which calendars sync into which. Each entry pairs a source calendar with a destination calendar that receives copies of its events. IDs match list_calendars.",
    execute: async (context) => {
      const { mappings } = await apiFetch(
        context,
        "/api/v1/mappings",
        z.object({ mappings: z.array(keeperSyncSchema) }),
      );
      return mappings;
    },
  },
  set_sync_destinations: {
    title: "Set sync destinations",
    annotations: DESTRUCTIVE,
    description:
      "Set the calendars a calendar copies its events to, replacing its current destinations. Pass an empty list to stop syncing it anywhere. Copies already made on a removed destination stay there. The Free plan limits how many syncs you can have.",
    inputSchema: {
      calendarId: calendarIdSchema.describe("The source calendar ID returned by list_calendars"),
      destinationCalendarIds: z
        .array(z.string().uuid())
        .describe("Every calendar that should receive copies, from list_calendars"),
    },
    execute: async (context, input) => {
      const calendarId = requireString(input, "calendarId");
      const destinationCalendarIds = requireStringArray(input, "destinationCalendarIds");
      await apiFetch(context, `/api/v1/calendars/${calendarId}/destinations`, z.unknown(), {
        method: "PUT",
        body: JSON.stringify({ calendarIds: destinationCalendarIds }),
      });
      return { calendarId, destinationCalendarIds };
    },
  },
  get_calendar_settings: {
    title: "Get calendar settings",
    annotations: READ_ONLY,
    description:
      "Get a calendar's sync settings: how its copies are titled, which events and details are left out, the sync window, and the calendars it syncs to (destinationIds) and from (sourceIds).",
    inputSchema: {
      calendarId: calendarIdSchema,
    },
    execute: (context, input) => {
      const calendarId = requireString(input, "calendarId");
      return apiFetch(context, calendarSettingsPath(calendarId), keeperCalendarSettingsSchema);
    },
  },
  update_calendar_settings: {
    title: "Update calendar settings",
    annotations: DESTRUCTIVE,
    description:
      "Change how a calendar's events are copied to its destinations. Only the fields you provide change. These settings require a Pro plan.",
    inputSchema: {
      calendarId: calendarIdSchema,
      customEventName: z
        .string()
        .optional()
        .describe("Title for copies. Supports the {{event_name}} and {{calendar_name}} templates"),
      excludeAllDayEvents: z.boolean().optional().describe("Leave out all-day events"),
      excludeAvailabilities: z
        .array(excludableAvailabilitySchema)
        .optional()
        .describe("Leave out events with these availabilities. Tentative is only supported on Outlook and calendar links"),
      excludeEventDescription: z.boolean().optional().describe("Leave descriptions off copies"),
      excludeEventLocation: z.boolean().optional().describe("Leave locations off copies"),
      excludeEventName: z.boolean().optional().describe("Leave event titles off copies"),
      excludeFocusTime: z.boolean().optional().describe("Leave out focus time events"),
      excludeOutOfOffice: z.boolean().optional().describe("Leave out out-of-office events"),
      excludeTitleKeywords: z
        .array(z.string().min(1).max(MAX_EXCLUDE_TITLE_KEYWORD_LENGTH))
        .max(MAX_EXCLUDE_TITLE_KEYWORDS)
        .optional()
        .describe("Leave out events whose title contains any of these keywords. Replaces the current list"),
      markEventsAsPrivate: z.boolean().optional().describe("Mark copies as private"),
      disableEventReminders: z.boolean().optional().describe("Turn off reminders on copies"),
      syncFutureRange: syncRangeSchema.optional().describe("How far ahead to copy events"),
      syncHistoricRange: syncRangeSchema.optional().describe("How far back to copy events"),
      treatFullDayTimedEventsAsAllDay: z
        .boolean()
        .optional()
        .describe("Copy timed events that span whole days as all-day events"),
    },
    execute: (context, input) => {
      const calendarId = requireString(input, "calendarId");
      const updates = pickProvided(input, CALENDAR_SETTING_FIELDS);
      if (Object.keys(updates).length === 0) {
        throw new ToolInputError("Provide at least one setting to update");
      }
      return apiFetch(context, calendarSettingsPath(calendarId), keeperCalendarSettingsSchema, {
        method: "PATCH",
        body: JSON.stringify(updates),
      });
    },
  },
  rename_calendar: {
    title: "Rename calendar",
    annotations: DESTRUCTIVE,
    description:
      "Rename a calendar in Keeper.sh. The name is also used for {{calendar_name}} in copy titles. The calendar keeps its name at the provider.",
    inputSchema: {
      calendarId: calendarIdSchema,
      name: z.string().trim().min(1).describe("The new name"),
    },
    execute: (context, input) => {
      const calendarId = requireString(input, "calendarId");
      const name = requireString(input, "name");
      return apiFetch(context, calendarSettingsPath(calendarId), keeperCalendarSettingsSchema, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      });
    },
  },
  refresh_calendars: {
    title: "Refresh calendars",
    annotations: ADDITIVE,
    description:
      "Re-discover the calendars on a connected account: imports calendars added at the provider, flags ones that are gone, and restores ones that came back. Without accountId, refreshes every account, at most once a minute.",
    inputSchema: {
      accountId: z
        .string()
        .uuid()
        .optional()
        .describe("The account ID returned by list_accounts. Omit to refresh every account"),
    },
    execute: (context, input) => {
      const { accountId } = pickProvided(input, ["accountId"]);
      if (typeof accountId === "string") {
        return apiFetch(context, `/api/v1/accounts/${accountId}/refresh`, keeperCalendarRefreshSchema, {
          method: "POST",
        });
      }
      return apiFetch(context, "/api/v1/accounts/refresh-calendars", keeperCalendarRefreshSchema, {
        method: "POST",
      });
    },
  },
});

export { createSyncToolset };
export type { KeeperCalendarRefresh, KeeperCalendarSettings, KeeperSync, KeeperSyncDestinations, KeeperSyncToolset };
