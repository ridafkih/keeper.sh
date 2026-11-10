import { z } from "zod";
import {
  ADDITIVE,
  DESTRUCTIVE,
  READ_ONLY,
  apiFetch,
  pickProvided,
  requireString,
  requireStringArray,
} from "../tool-api";
import type { KeeperMcpToolDefinition } from "../tool-api";

const keeperIcalFeedSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string().optional(),
  isDefault: z.boolean(),
  includeEventName: z.boolean(),
  includeEventDescription: z.boolean(),
  includeEventLocation: z.boolean(),
  excludeAllDayEvents: z.boolean(),
  excludeFocusTime: z.boolean(),
  excludeOutOfOffice: z.boolean(),
  customEventName: z.string(),
  calendarIds: z.array(z.string()).optional(),
});
type KeeperIcalFeed = z.infer<typeof keeperIcalFeedSchema>;

const FEED_UPDATE_FIELDS = [
  "name",
  "includeEventName",
  "includeEventDescription",
  "includeEventLocation",
  "excludeAllDayEvents",
  "excludeFocusTime",
  "excludeOutOfOffice",
  "customEventName",
] as const;

const feedIdSchema = z.string().uuid().describe("The feed ID returned by list_ical_feeds");

const feedPath = (feedId: string): string => `/api/v1/ical/feeds/${feedId}`;

interface KeeperIcalFeedToolset {
  list_ical_feeds: KeeperMcpToolDefinition<KeeperIcalFeed[]>;
  create_ical_feed: KeeperMcpToolDefinition<KeeperIcalFeed>;
  update_ical_feed: KeeperMcpToolDefinition<KeeperIcalFeed>;
  set_ical_feed_calendars: KeeperMcpToolDefinition<{ feedId: string; calendarIds: string[] }>;
  delete_ical_feed: KeeperMcpToolDefinition<{ deleted: boolean }>;
}

const createIcalFeedToolset = (): KeeperIcalFeedToolset => ({
  list_ical_feeds: {
    title: "List iCal feeds",
    annotations: READ_ONLY,
    description:
      "List the iCal feeds Keeper.sh publishes from your calendars, with each feed's subscription URL, settings and calendar IDs. Every account has a default feed. Any calendar app can subscribe to a feed's URL.",
    execute: (context) => apiFetch(context, "/api/v1/ical/feeds", z.array(keeperIcalFeedSchema)),
  },
  create_ical_feed: {
    title: "Create iCal feed",
    annotations: ADDITIVE,
    description:
      "Create a new iCal feed with its own subscription URL. It starts with no calendars; add them with set_ical_feed_calendars. The Free plan limits how many feeds you can have.",
    inputSchema: {
      name: z.string().trim().min(1).describe("Name for the feed"),
    },
    execute: (context, input) => {
      const name = requireString(input, "name");
      return apiFetch(context, "/api/v1/ical/feeds", keeperIcalFeedSchema, {
        method: "POST",
        body: JSON.stringify({ name }),
      });
    },
  },
  update_ical_feed: {
    title: "Update iCal feed",
    annotations: DESTRUCTIVE,
    description:
      "Rename an iCal feed or change what its events show. Only the fields you provide change. Changing anything other than the name requires a Pro plan.",
    inputSchema: {
      feedId: feedIdSchema,
      name: z.string().trim().min(1).optional().describe("New name for the feed"),
      includeEventName: z.boolean().optional().describe("Show event titles"),
      includeEventDescription: z.boolean().optional().describe("Show event descriptions"),
      includeEventLocation: z.boolean().optional().describe("Show event locations"),
      excludeAllDayEvents: z.boolean().optional().describe("Leave out all-day events"),
      excludeFocusTime: z.boolean().optional().describe("Leave out focus time events"),
      excludeOutOfOffice: z.boolean().optional().describe("Leave out out-of-office events"),
      customEventName: z
        .string()
        .optional()
        .describe("Title for events when titles are hidden. Supports the {{event_name}} and {{calendar_name}} templates"),
    },
    execute: (context, input) => {
      const feedId = requireString(input, "feedId");
      const updates = pickProvided(input, FEED_UPDATE_FIELDS);
      if (Object.keys(updates).length === 0) {
        throw new Error("Provide at least one field to update");
      }
      return apiFetch(context, feedPath(feedId), keeperIcalFeedSchema, {
        method: "PATCH",
        body: JSON.stringify(updates),
      });
    },
  },
  set_ical_feed_calendars: {
    title: "Set iCal feed calendars",
    annotations: DESTRUCTIVE,
    description:
      "Set which calendars an iCal feed publishes, replacing its current list. Pass an empty list to publish none.",
    inputSchema: {
      feedId: feedIdSchema,
      calendarIds: z
        .array(z.string().uuid())
        .describe("Every calendar the feed should publish, from list_calendars"),
    },
    execute: async (context, input) => {
      const feedId = requireString(input, "feedId");
      const calendarIds = requireStringArray(input, "calendarIds");
      await apiFetch(context, `${feedPath(feedId)}/calendars`, z.unknown(), {
        method: "PUT",
        body: JSON.stringify({ calendarIds }),
      });
      return { calendarIds, feedId };
    },
  },
  delete_ical_feed: {
    title: "Delete iCal feed",
    annotations: DESTRUCTIVE,
    description:
      "Delete an iCal feed. Its URL stops working for every subscriber. The default feed cannot be deleted.",
    inputSchema: {
      feedId: feedIdSchema,
    },
    execute: async (context, input) => {
      const feedId = requireString(input, "feedId");
      await apiFetch(context, feedPath(feedId), z.unknown(), { method: "DELETE" });
      return { deleted: true };
    },
  },
});

export { createIcalFeedToolset };
export type { KeeperIcalFeed, KeeperIcalFeedToolset };
