import { z } from "zod";
import { SYNC_RANGE_DEFINITIONS } from "@keeper.sh/data-schemas";
import {
  ADDITIVE,
  DESTRUCTIVE,
  READ_ONLY,
  apiFetch,
  pickProvided,
  requireString,
  ToolInputError,
} from "../tool-api";
import type { KeeperMcpToolDefinition } from "../tool-api";

const keeperCalendarSettingsSchema = z.record(z.string(), z.unknown());
type KeeperCalendarSettings = z.infer<typeof keeperCalendarSettingsSchema>;

const keeperCalendarRefreshSchema = z.record(z.string(), z.unknown());
type KeeperCalendarRefresh = z.infer<typeof keeperCalendarRefreshSchema>;

const syncRangeSchema = z.enum(SYNC_RANGE_DEFINITIONS.map(({ value }) => value));

const CALENDAR_SETTING_FIELDS = [
  "disableEventReminders",
  "syncFutureRange",
  "syncHistoricRange",
  "treatFullDayTimedEventsAsAllDay",
] as const;

const calendarIdSchema = z.string().uuid().describe("The calendar ID returned by list_calendars");

const calendarSettingsPath = (calendarId: string): string =>
  `/api/v1/calendars/${calendarId}/settings`;

interface KeeperSyncToolset {
  get_calendar_settings: KeeperMcpToolDefinition<KeeperCalendarSettings>;
  update_calendar_settings: KeeperMcpToolDefinition<KeeperCalendarSettings>;
  rename_calendar: KeeperMcpToolDefinition<KeeperCalendarSettings>;
  refresh_calendars: KeeperMcpToolDefinition<KeeperCalendarRefresh>;
}

const createSyncToolset = (): KeeperSyncToolset => ({
  get_calendar_settings: {
    title: "Get calendar settings",
    annotations: READ_ONLY,
    description:
      "Get a calendar's own settings: its sync window, whether whole-day timed events copy as all-day, and whether copies keep reminders. How copies are titled, filtered and shared is set on each sync, not here.",
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
      "Change a calendar's own settings: its sync window, whole-day timed events, and reminders on copies. Only the fields you provide change. These settings require a Pro plan.",
    inputSchema: {
      calendarId: calendarIdSchema,
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
export type { KeeperCalendarRefresh, KeeperCalendarSettings, KeeperSyncToolset };
