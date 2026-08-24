export type McpTool = {
  name: string;
  summary: string;
  arguments: string;
};

export type McpToolGroup = {
  title: string;
  description: string;
  tools: McpTool[];
};

export type RestEndpoint = {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  description: string;
};

export type OauthScope = {
  scope: string;
  description: string;
};

export const MCP_SERVER_URL = "https://www.keeper.sh/mcp";

export const MCP_TOOL_GROUPS: McpToolGroup[] = [
  {
    title: "Calendars and accounts",
    description:
      "What the user has connected. Most sessions start here, because every other tool takes a calendar ID.",
    tools: [
      {
        name: "list_calendars",
        summary:
          "Lists every calendar connected to Keeper.sh with its provider and the account it belongs to.",
        arguments: "No arguments",
      },
      {
        name: "list_accounts",
        summary: "Lists connected calendar accounts and the provider each one signs in with.",
        arguments: "No arguments",
      },
      {
        name: "get_ical_feed",
        summary:
          "Returns the URL of the shareable calendar link, for subscribing to it from another calendar app.",
        arguments: "No arguments",
      },
    ],
  },
  {
    title: "Reading events",
    description:
      "Reads across every synced calendar at once. Times come back localized to the timezone you pass in.",
    tools: [
      {
        name: "get_events",
        summary:
          "Returns the events in a date range, with their calendar, title, description, location, and times.",
        arguments: "from, to, timezone",
      },
      {
        name: "get_event",
        summary: "Returns one event by the ID that get_events reported.",
        arguments: "eventId",
      },
      {
        name: "get_event_count",
        summary:
          "Returns only how many events fall in a range, so a busy week can be measured without listing it.",
        arguments: "from and to, both optional",
      },
      {
        name: "get_pending_invites",
        summary: "Returns invitations on a calendar that have not been responded to yet.",
        arguments: "calendarId, from, to, timezone",
      },
    ],
  },
  {
    title: "Writing events",
    description:
      "Writes land on the provider the calendar belongs to, so a created event appears in Google Calendar, Outlook, or a CalDAV server the same as one made by hand.",
    tools: [
      {
        name: "create_event",
        summary:
          "Creates an event on a connected calendar. Pass a timezone so CalDAV providers show it in local time.",
        arguments: "calendarId, title, startTime, endTime, and optional description, location, isAllDay, availability, timezone",
      },
      {
        name: "update_event",
        summary: "Updates an existing event. Only the fields you send are changed.",
        arguments: "eventId, plus any fields to change",
      },
      {
        name: "delete_event",
        summary: "Deletes an event by ID.",
        arguments: "eventId",
      },
      {
        name: "rsvp_event",
        summary: "Responds to an invitation with accepted, declined, or tentative.",
        arguments: "eventId, rsvpStatus",
      },
    ],
  },
  {
    title: "Scheduling and sync",
    description:
      "Finding an open slot, and controlling when syncing happens.",
    tools: [
      {
        name: "find_free_time",
        summary:
          "Finds open slots of at least a given length across every synced calendar. Events marked free or working-elsewhere never block; busy, out-of-office, and all-day events do.",
        arguments:
          "from, to, timezone, durationMinutes, and optional workingHoursStart, workingHoursEnd, workingDays, calendarId, ignoreAllDayEvents, limit",
      },
      {
        name: "trigger_sync",
        summary:
          "Forces a sync now instead of waiting for the next pass. Throttled to one request per minute per user.",
        arguments: "No arguments",
      },
      {
        name: "pause_sync",
        summary:
          "Pauses or resumes one calendar without disconnecting it. Nothing is read from it or written to it while paused, and its stored events are kept.",
        arguments: "calendarId, paused",
      },
    ],
  },
];

export const MCP_OAUTH_SCOPES: OauthScope[] = [
  { scope: "keeper.read", description: "Required by every tool call. Without it the server answers 403." },
  { scope: "keeper.events.read", description: "Reading events and invitations." },
  { scope: "keeper.sources.read", description: "Reading the calendars events are copied from." },
  { scope: "keeper.destinations.read", description: "Reading the calendars events are copied into." },
  { scope: "keeper.mappings.read", description: "Reading which calendar is copied into which." },
  { scope: "keeper.sync-status.read", description: "Reading sync state and triggering a sync." },
];

export const REST_ENDPOINTS: RestEndpoint[] = [
  {
    method: "GET",
    path: "/api/v1/calendars",
    description: "List connected calendars. Accepts an optional comma-delimited provider filter.",
  },
  {
    method: "PATCH",
    path: "/api/v1/calendars/{calendarId}",
    description: "Pause or resume syncing for a calendar without disconnecting it.",
  },
  {
    method: "GET",
    path: "/api/v1/calendars/{calendarId}/invites",
    description: "List invitations on a calendar that have not been responded to, within a date range.",
  },
  {
    method: "GET",
    path: "/api/v1/accounts",
    description: "List connected accounts and how many calendars each one has.",
  },
  {
    method: "GET",
    path: "/api/v1/events",
    description:
      "List events in a date range. Accepts calendarId, availability, and isAllDay filters, and count=true to return only a count.",
  },
  {
    method: "POST",
    path: "/api/v1/events",
    description: "Create an event. Requires calendarId, title, startTime, and endTime.",
  },
  { method: "GET", path: "/api/v1/events/{id}", description: "Get a single event." },
  {
    method: "PATCH",
    path: "/api/v1/events/{id}",
    description: "Update an event's fields, or send rsvpStatus to respond to an invitation.",
  },
  { method: "DELETE", path: "/api/v1/events/{id}", description: "Delete an event." },
  {
    method: "GET",
    path: "/api/v1/events/free-time",
    description:
      "Find free slots of at least durationMinutes in a date range. Requires timezone, and accepts working-hours options.",
  },
  {
    method: "POST",
    path: "/api/v1/sync",
    description: "Trigger a sync immediately. Throttled to one request per minute per user.",
  },
  { method: "GET", path: "/api/v1/ical", description: "Get the URL of your iCal feed." },
];

export const MCP_CLIENT_CONFIG_SNIPPET = `{
  "mcpServers": {
    "keeper": {
      "type": "url",
      "url": "${MCP_SERVER_URL}"
    }
  }
}`;

export const MCP_DISCOVERY_SNIPPET = `curl https://www.keeper.sh/.well-known/oauth-protected-resource

{
  "resource": "https://www.keeper.sh/mcp",
  "authorization_servers": ["https://www.keeper.sh/api/auth"],
  "scopes_supported": ["keeper.read", "keeper.events.read", "..."]
}`;

export const REST_CURL_SNIPPET = `curl https://www.keeper.sh/api/v1/calendars \\
  -H "Authorization: Bearer kpr_..."`;

export const REST_FREE_TIME_SNIPPET = `curl -G https://www.keeper.sh/api/v1/events/free-time \\
  -H "Authorization: Bearer kpr_..." \\
  --data-urlencode "from=2026-09-07T00:00:00Z" \\
  --data-urlencode "to=2026-09-11T00:00:00Z" \\
  --data-urlencode "timezone=America/New_York" \\
  --data-urlencode "durationMinutes=45" \\
  --data-urlencode "workingHoursStart=09:00" \\
  --data-urlencode "workingHoursEnd=17:00" \\
  --data-urlencode "workingDays=1,2,3,4,5"`;

export const REST_CREATE_EVENT_SNIPPET = `curl -X POST https://www.keeper.sh/api/v1/events \\
  -H "Authorization: Bearer kpr_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "calendarId": "6f1c0c2e-1f5f-4a2f-9a1e-6a1b7f0c9d3e",
    "title": "Design review",
    "startTime": "2026-09-08T15:00:00Z",
    "endTime": "2026-09-08T15:45:00Z",
    "timezone": "America/New_York"
  }'`;
