import { z } from "zod";
import { ADDITIVE, DESTRUCTIVE, apiFetch, pickProvided, requireString } from "../tool-api";
import type { KeeperMcpToolDefinition } from "../tool-api";

const keeperCalendarLinkSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  name: z.string(),
  url: z.string().nullable(),
});
type KeeperCalendarLink = z.infer<typeof keeperCalendarLinkSchema>;

interface KeeperCalendarLinkToolset {
  add_calendar_link: KeeperMcpToolDefinition<KeeperCalendarLink>;
  remove_calendar_link: KeeperMcpToolDefinition<{ removed: boolean }>;
}

const createCalendarLinkToolset = (): KeeperCalendarLinkToolset => ({
  add_calendar_link: {
    title: "Add calendar link",
    annotations: ADDITIVE,
    description:
      "Subscribe to a read-only calendar from its iCal (ICS) link, so its events can be synced to other calendars. Each link counts as one linked account on the plan.",
    inputSchema: {
      url: z.string().url().describe("The calendar's iCal (ICS) URL"),
      name: z.string().optional().describe("Name for the calendar. Defaults to the name in the feed"),
    },
    execute: (context, input) => {
      const url = requireString(input, "url");
      return apiFetch(context, "/api/v1/ics", keeperCalendarLinkSchema, {
        method: "POST",
        body: JSON.stringify({ url, ...pickProvided(input, ["name"]) }),
      });
    },
  },
  remove_calendar_link: {
    title: "Remove calendar link",
    annotations: DESTRUCTIVE,
    description:
      "Remove a calendar added from an iCal link and stop syncing it. Only works on calendar links, not on calendars from a signed-in account.",
    inputSchema: {
      calendarId: z.string().uuid().describe("The calendar link's ID returned by list_calendars or add_calendar_link"),
    },
    execute: async (context, input) => {
      const calendarId = requireString(input, "calendarId");
      await apiFetch(context, `/api/v1/ics/${calendarId}`, z.unknown(), { method: "DELETE" });
      return { removed: true };
    },
  },
});

export { createCalendarLinkToolset };
export type { KeeperCalendarLink, KeeperCalendarLinkToolset };
