/**
 * Every published change to Keeper.sh, newest release first.
 *
 * One dated release per publish. Each release carries one to three featured
 * entries, which get their own page under the slug, and a flat list
 * of smaller notes that stay on the hub with a stable anchor each.
 *
 * `plugins/sitemap.ts` and `plugins/feed.ts` read this file at build time, so it
 * stays free of imports and browser-only code.
 */

export interface ChangelogNote {
  /** Stable anchor on the hub, so a support reply can link to one line. */
  id: string;
  /** The word a reader uses for this part of the product, never a package name. */
  area: string;
  summary: string;
}

/** One link out of an entry, to the page that explains the capability in full. */
export type ChangelogLink =
  | { label: string; to: "/pricing" | "/features" }
  | { label: string; to: "/blog/$slug"; params: { slug: string } };

export interface ChangelogFeature {
  slug: string;
  title: string;
  /** First sentence of the entry, and its meta description. */
  summary: string;
  body: string[];
  link: ChangelogLink;
}

export interface ChangelogRelease {
  /** Publish date, ISO, newest first. */
  date: string;
  /** Build range, for the people who run their own copy. */
  build: string;
  features: ChangelogFeature[];
  added: ChangelogNote[];
  improved: ChangelogNote[];
  fixed: ChangelogNote[];
}

export const changelogReleases: ChangelogRelease[] = [
  {
    date: "2026-08-14",
    build: "Builds 2.14 – 2.15.1",
    features: [
      {
        slug: "2026-08-14-more-than-one-calendar-feed",
        title: "Publish more than one calendar feed",
        summary:
          "A calendar feed is a link other apps subscribe to, and you can now publish as many as you like.",
        body: [
          "Give each feed a name. Choose which calendars it covers, and how event names appear inside it.",
          "Every feed gets its own link, in a field you can select and copy. Free accounts keep one feed, and the rest come with a paid plan.",
        ],
        link: { label: "what a paid plan adds", to: "/pricing" },
      },
      {
        slug: "2026-08-14-assistant-schedule-tools",
        title: "Ask an assistant to find free time, sync now, or pause syncing",
        summary:
          "Three new tools let an assistant you have connected work with your schedule directly.",
        body: [
          "It can find open slots across a date range, in your own timezone and inside the hours you work.",
          "It can also start a sync on demand, or pause syncing for one calendar. Developers get the same three actions over the API.",
        ],
        link: { label: "everything Keeper.sh does", to: "/features" },
      },
    ],
    added: [
      {
        id: "2026-08-14-standalone-assistant-tools",
        area: "Self-hosting",
        summary:
          "Anyone running their own copy gets the same assistant tools, with nothing extra to run alongside it.",
      },
    ],
    improved: [
      {
        id: "2026-08-14-caldav-faster-sync",
        area: "iCloud",
        summary:
          "Syncing a busy iCloud or Fastmail calendar is quicker, because Keeper.sh now asks only for the copies it made.",
      },
      {
        id: "2026-08-14-finished-series-skipped",
        area: "Syncing",
        summary: "A repeating event that has already ended is no longer worked out again on every sync.",
      },
    ],
    fixed: [
      {
        id: "2026-08-14-api-offset-times",
        area: "API",
        summary: "Events created with a time offset rather than a Z now land at the time you gave.",
      },
      {
        id: "2026-08-14-api-recurrence-budget",
        area: "API",
        summary: "Reading a repeating series too large to expand now returns a clear explanation.",
      },
      {
        id: "2026-08-14-billing-plan-fallback",
        area: "Billing",
        summary: "A paid plan no longer shows as free when the billing provider is slow.",
      },
      {
        id: "2026-08-14-billing-button-flicker",
        area: "Billing",
        summary: "The subscription button no longer flickers between two labels while your details reload.",
      },
      {
        id: "2026-08-14-feed-horizon",
        area: "Calendar feeds",
        summary:
          "Your published feed now covers the full range you set, and no longer drops events once it grows large.",
      },
      {
        id: "2026-08-14-dashboard-half-hourly-errors",
        area: "Dashboard",
        summary:
          "Signed-in pages no longer fail, and scheduled syncing is no longer cut short, on a half-hourly cadence.",
      },
      {
        id: "2026-08-14-google-conference-details",
        area: "Google Calendar",
        summary: "Events copied to Google keep their meeting details instead of being rewritten every sync.",
      },
      {
        id: "2026-08-14-google-connect-tolerance",
        area: "Google Calendar",
        summary: "Connecting an account works when it has no readable calendars, or one calendar has no name.",
      },
      {
        id: "2026-08-14-caldav-plain-descriptions",
        area: "iCloud",
        summary:
          "Descriptions copied to iCloud and other CalDAV calendars arrive as plain readable text, not full of markup.",
      },
      {
        id: "2026-08-14-caldav-daylight-saving",
        area: "iCloud",
        summary:
          "Events on iCloud, Fastmail and other CalDAV calendars keep the right time across a daylight saving change.",
      },
      {
        id: "2026-08-14-caldav-large-import",
        area: "iCloud",
        summary: "Large CalDAV calendars, Zoho among them, import every event instead of stopping at a thousand.",
      },
      {
        id: "2026-08-14-caldav-deletions",
        area: "iCloud",
        summary: "Deleting an event removes it from iCloud and other CalDAV calendars instead of leaving it behind.",
      },
      {
        id: "2026-08-14-caldav-false-reconnect",
        area: "iCloud",
        summary: "A slow server or a timeout no longer asks you to reconnect a working CalDAV account.",
      },
      {
        id: "2026-08-14-outlook-throttling",
        area: "Outlook",
        summary: "Events no longer go missing when Microsoft rate-limits your mailbox. Writes wait and retry.",
      },
      {
        id: "2026-08-14-outlook-untitled-event",
        area: "Outlook",
        summary: "An event with no title no longer stops the whole calendar from being read.",
      },
      {
        id: "2026-08-14-outlook-scope-grants",
        area: "Outlook",
        summary: "A properly connected account no longer asks to be reconnected.",
      },
      {
        id: "2026-08-14-site-scroll-reset",
        area: "Site",
        summary: "Following a link from the bottom of a page opens the next page at the top.",
      },
      {
        id: "2026-08-14-ics-timezone-isolation",
        area: "Subscribed calendars",
        summary: "One event with an unreadable timezone no longer stops a whole subscribed calendar.",
      },
      {
        id: "2026-08-14-ics-first-import-range",
        area: "Subscribed calendars",
        summary: "The first import of a calendar you just added uses the range you configured.",
      },
      {
        id: "2026-08-14-zero-length-events",
        area: "Syncing",
        summary: "An event with no duration arrives on the other calendar instead of being retried forever.",
      },
      {
        id: "2026-08-14-all-day-anchoring",
        area: "Syncing",
        summary: "All-day events that came from a timed calendar are no longer deleted and recreated every sync.",
      },
    ],
  },
  {
    date: "2026-08-12",
    build: "Builds 2.13.6 – 2.13.8",
    features: [
      {
        slug: "2026-08-12-per-calendar-sync-window",
        title: "Choose how far back and how far ahead each calendar syncs",
        summary:
          "Set how much history and how much future each calendar syncs, from one week to two years.",
        body: [
          "You will find it under Sync Window on the calendar's page. Until you change it, Keeper.sh keeps one month of history and two years ahead.",
          "Custom ranges come with Pro. Narrowing a range removes the events outside it from that calendar.",
        ],
        link: { label: "what Pro includes", to: "/pricing" },
      },
    ],
    added: [
      {
        id: "2026-08-12-blog-feed",
        area: "Blog",
        summary: "The blog publishes a feed at /rss.xml, so you can follow it in a reader.",
      },
      {
        id: "2026-08-12-sync-explainer",
        area: "Blog",
        summary: "A long-form post covers what happens between two calendars, and where syncing usually goes wrong.",
      },
      {
        id: "2026-08-12-tools-roundup",
        area: "Blog",
        summary: "A roundup of nine calendar sync tools compares price, speed and detail, with a link for every figure.",
      },
      {
        id: "2026-08-12-provider-guides",
        area: "Guides",
        summary: "Two guides walk through connecting iCloud with Outlook, and Google Calendar with iCloud.",
      },
    ],
    improved: [
      {
        id: "2026-08-12-page-caching",
        area: "Site",
        summary: "Public pages are cached now, so they arrive noticeably quicker.",
      },
    ],
    fixed: [
      {
        id: "2026-08-12-blog-code-blocks",
        area: "Blog",
        summary: "Multi-line code blocks render as blocks instead of picking up inline styling.",
      },
      {
        id: "2026-08-12-blog-not-found",
        area: "Blog",
        summary: "A mistyped post address shows the normal not-found page instead of a blank one.",
      },
      {
        id: "2026-08-12-upgrade-migrations",
        area: "Self-hosting",
        summary: "Upgrading an install running roughly v2.10.2 through v2.12.2 works again, and finishes far faster.",
      },
      {
        id: "2026-08-12-muted-text-contrast",
        area: "Site",
        summary: "Faint dates and read-only fields are easier to read, and now meet WCAG AA.",
      },
      {
        id: "2026-08-12-oversized-series",
        area: "Syncing",
        summary: "One oversized repeating event no longer stops the rest of its calendar syncing.",
      },
    ],
  },
  {
    date: "2026-07-17",
    build: "Builds 2.12 – 2.13.5",
    features: [
      {
        slug: "2026-07-17-repeating-event-changes",
        title: "Changes to a repeating event now reach your other calendars",
        summary:
          "Change the repeat rule, skip a date, or move a repeating meeting to another timezone.",
        body: [
          "The change shows up in the calendars you sync into on the next run. The old pattern no longer stays put.",
          "Skipped dates stay skipped, and each occurrence keeps its own length.",
        ],
        link: {
          label: "how calendar sync works",
          params: { slug: "how-calendar-sync-actually-works" },
          to: "/blog/$slug",
        },
      },
    ],
    added: [],
    improved: [
      {
        id: "2026-07-17-isolated-calendar-runs",
        area: "Syncing",
        summary: "Each calendar you sync into runs on its own, so a slow one no longer holds up the rest.",
      },
    ],
    fixed: [
      {
        id: "2026-07-17-feed-free-time",
        area: "Calendar feeds",
        summary: "Events you marked as free show as free in the feed you share.",
      },
      {
        id: "2026-07-17-dashboard-stuck-indicator",
        area: "Dashboard",
        summary: "The home page no longer sits on Syncing long after a sync has finished.",
      },
      {
        id: "2026-07-17-google-delete-lookup",
        area: "Google Calendar",
        summary: "A deleted event is no longer left behind when the lookup that finds it fails.",
      },
      {
        id: "2026-07-17-caldav-rsvp-occurrence",
        area: "iCloud",
        summary: "Replying to one occurrence of a repeating invitation no longer changes the rest.",
      },
      {
        id: "2026-07-17-mailbox-org-connect",
        area: "mailbox.org",
        summary: "mailbox.org calendars connect on the first try.",
      },
      {
        id: "2026-07-17-outlook-series-id",
        area: "Outlook",
        summary: "An event with no series identifier no longer stops a sync.",
      },
      {
        id: "2026-07-17-outlook-stalled-request",
        area: "Outlook",
        summary: "A request that stops responding is given up on after 30 seconds, so the sync finishes.",
      },
      {
        id: "2026-07-17-moved-event-duplicate",
        area: "Syncing",
        summary: "A rescheduled event no longer leaves the old copy behind on your other calendars.",
      },
      {
        id: "2026-07-17-long-sync-lock",
        area: "Syncing",
        summary: "A sync running over two minutes keeps its claim on the calendar it is writing to.",
      },
    ],
  },
  {
    date: "2026-06-30",
    build: "Builds 2.10 – 2.12",
    features: [
      {
        slug: "2026-06-30-midnight-to-midnight-events",
        title: "Turn midnight-to-midnight events into all-day events",
        summary:
          "Some calendar links publish an all-day event as a timed one that runs from midnight to midnight.",
        body: [
          "It lands as a long block rather than a banner at the top of the day. Keeper.sh can now read those as real all-day events.",
          "Open the subscribed calendar in your dashboard and switch on Sync Full-Day Events as All-Day. It stays off until you turn it on, and it comes with Pro.",
        ],
        link: { label: "what Pro includes", to: "/pricing" },
      },
    ],
    added: [
      {
        id: "2026-06-30-assistant-timezone",
        area: "Assistants",
        summary: "An assistant can set an event's timezone, such as America/New_York, when it creates one.",
      },
    ],
    improved: [
      {
        id: "2026-06-30-directional-backoff",
        area: "Syncing",
        summary: "A calendar that keeps failing to fetch backs off and retries, while its events still go out.",
      },
    ],
    fixed: [
      {
        id: "2026-06-30-apple-repeat-rules",
        area: "Apple Calendar",
        summary: "A repeating event in your Keeper.sh feed expands properly instead of showing once.",
      },
      {
        id: "2026-06-30-apple-skipped-dates",
        area: "Apple Calendar",
        summary: "A skipped date no longer drops the whole repeating series from your feed.",
      },
      {
        id: "2026-06-30-feed-outlook-timezones",
        area: "Calendar feeds",
        summary: "Events in your Keeper.sh feed show at their local time in Outlook, not in UTC.",
      },
      {
        id: "2026-06-30-google-stuck-events",
        area: "Google Calendar",
        summary: "Events that failed to write on every single sync now go through.",
      },
      {
        id: "2026-06-30-caldav-event-timezones",
        area: "iCloud",
        summary: "Events written to iCloud, Fastmail and other CalDAV calendars keep their own timezone.",
      },
      {
        id: "2026-06-30-outlook-paging",
        area: "Outlook",
        summary: "Calendars that returned an error and never fetched any events now sync.",
      },
      {
        id: "2026-06-30-ics-fetch-failure",
        area: "Subscribed calendars",
        summary: "When a calendar link cannot be loaded, the events already synced from it are kept.",
      },
      {
        id: "2026-06-30-ics-lenient-dates",
        area: "Subscribed calendars",
        summary: "Calendar links that write dates in an unusual form now import.",
      },
      {
        id: "2026-06-30-missing-calendar-retry",
        area: "Syncing",
        summary: "A calendar your provider reports as missing is retried instead of being switched off.",
      },
      {
        id: "2026-06-30-content-edits",
        area: "Syncing",
        summary: "An edit to an event's title, description or location reaches your other calendars.",
      },
      {
        id: "2026-06-30-provider-timeouts",
        area: "Syncing",
        summary: "A slow provider no longer freezes a sync part-way through.",
      },
      {
        id: "2026-06-30-false-reauth-gate",
        area: "Syncing",
        summary: "An account wrongly flagged as needing reconnection keeps syncing.",
      },
    ],
  },
  {
    date: "2026-05-22",
    build: "Builds 2.9.x",
    features: [
      {
        slug: "2026-05-22-sync-on-connect",
        title: "Sync starts the moment you connect a calendar",
        summary: "You no longer wait for the next scheduled run after connecting an account.",
        body: [
          "Keeper.sh queues the first sync as soon as the account is added, so your events start arriving right away.",
        ],
        link: { label: "everything Keeper.sh does", to: "/features" },
      },
      {
        slug: "2026-05-22-digest-sign-in",
        title: "Connect a calendar server that uses digest sign-in",
        summary:
          "Keeper.sh now signs in to calendar servers that ask for digest sign-in, as well as the usual kind.",
        body: [
          "It remembers which one your server wants, so later syncs go straight through.",
          "A server that refused your details at the connect screen should now let you in.",
        ],
        link: { label: "the calendars Keeper.sh works with", to: "/features" },
      },
    ],
    added: [],
    improved: [
      {
        id: "2026-05-22-account-token-renewal",
        area: "Connected accounts",
        summary: "Access for each account is renewed one request at a time, so accounts stay signed in.",
      },
      {
        id: "2026-05-22-google-working-location",
        area: "Google Calendar",
        summary: "Google's working from home entries are always left out, and the option to include them is gone.",
      },
      {
        id: "2026-05-22-smaller-pages",
        area: "Google Calendar",
        summary: "Large Google and Outlook calendars are fetched in smaller pages, so they stall less often.",
      },
      {
        id: "2026-05-22-signup-spam-reminder",
        area: "Sign-up",
        summary: "The check your email screen reminds you to look in spam or junk.",
      },
      {
        id: "2026-05-22-unchanged-ics",
        area: "Subscribed calendars",
        summary: "A calendar link that comes back unchanged is no longer rebuilt from scratch.",
      },
      {
        id: "2026-05-22-more-syncs-at-once",
        area: "Syncing",
        summary: "Keeper.sh runs many more syncs at once, and a repeat sync replaces the one already waiting.",
      },
    ],
    fixed: [
      {
        id: "2026-05-22-account-deletion",
        area: "Account",
        summary: "You can delete your account when you signed in with Google or Microsoft.",
      },
      {
        id: "2026-05-22-assistant-time-bounds",
        area: "Assistants",
        summary: "A request for events between two times returns exactly that window.",
      },
      {
        id: "2026-05-22-assistant-offsets",
        area: "Assistants",
        summary: "Times read correctly in zones with a single-digit offset, such as Montevideo.",
      },
      {
        id: "2026-05-22-feed-recurring-events",
        area: "Calendar feeds",
        summary: "Repeating events show every occurrence in your Keeper.sh feed, not just the first.",
      },
      {
        id: "2026-05-22-feed-all-day",
        area: "Calendar feeds",
        summary: "All-day events read as all-day in the feed Keeper.sh publishes.",
      },
      {
        id: "2026-05-22-settings-serialisation",
        area: "Dashboard",
        summary: "Calendar and feed settings save the value you typed.",
      },
      {
        id: "2026-05-22-sync-progress",
        area: "Dashboard",
        summary: "Sync progress only moves forward, and reaches the end when the sync is done.",
      },
      {
        id: "2026-05-22-google-existing-copy",
        area: "Google Calendar",
        summary: "An event already sitting in the calendar you sync into is replaced with the current version.",
      },
      {
        id: "2026-05-22-google-rate-limits",
        area: "Google Calendar",
        summary: "Keeper.sh waits and retries the way Google asks when it is being rate limited.",
      },
      {
        id: "2026-05-22-caldav-false-reauth",
        area: "iCloud",
        summary: "Ordinary hiccups from a CalDAV server no longer ask you to reconnect.",
      },
      {
        id: "2026-05-22-outlook-chosen-calendar",
        area: "Outlook",
        summary: "Events land in the calendar you chose, not the default one, and stop repeating.",
      },
      {
        id: "2026-05-22-outlook-missing-email",
        area: "Outlook",
        summary: "An account that returns no email address now connects.",
      },
      {
        id: "2026-05-22-outlook-missing-identifier",
        area: "Outlook",
        summary: "Events no longer fail when Microsoft returns no identifier for them.",
      },
      {
        id: "2026-05-22-google-ics-links",
        area: "Subscribed calendars",
        summary: "Calendar links hosted by Google load again.",
      },
      {
        id: "2026-05-22-disabled-calendars",
        area: "Syncing",
        summary: "A calendar you turned off is no longer synced on every scheduled run.",
      },
    ],
  },
];

export const changelogFeatures: ChangelogFeature[] = changelogReleases.flatMap(
  (release) => release.features,
);

export function findChangelogFeature(slug: string): ChangelogFeature | undefined {
  return changelogFeatures.find((feature) => feature.slug === slug);
}

export function changelogReleaseOf(slug: string): ChangelogRelease | undefined {
  return changelogReleases.find((release) =>
    release.features.some((feature) => feature.slug === slug),
  );
}

/**
 * The entries either side of one, so a page reached cold from search has
 * somewhere to go next. `newer` is the entry published after this one.
 */
export function changelogFeatureNeighbours(slug: string): {
  newer: ChangelogFeature | undefined;
  older: ChangelogFeature | undefined;
} {
  const index = changelogFeatures.findIndex((feature) => feature.slug === slug);
  if (index === -1) {
    return { newer: undefined, older: undefined };
  }

  return {
    newer: changelogFeatures[index - 1],
    older: changelogFeatures[index + 1],
  };
}

export const changelogPaths: string[] = [
  "/changelog",
  ...changelogFeatures.map((feature) => `/changelog/${feature.slug}`),
];

