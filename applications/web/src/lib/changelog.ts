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
  {
    date: "2026-04-09",
    build: "Builds 2.3 – 2.9.34",
    features: [
      {
        slug: "2026-04-09-assistant-connector",
        title: "Connect Keeper.sh to Claude and other AI assistants",
        summary:
          "Keeper.sh can now be added as a connector in AI assistants such as Claude.",
        body: [
          "Once connected, the assistant can see which calendars you have linked, look up your events over a date range in a timezone you specify, and count how many events fall in that range.",
          "At launch this access was read-only: the assistant could look, but not change anything.",
        ],
        link: { label: "everything Keeper.sh does", to: "/features" },
      },
      {
        slug: "2026-04-09-assistant-actions",
        title: "Assistants can now book, change and reply to events",
        summary: "Assistant access grew past looking things up.",
        body: [
          "An assistant can create an event, edit one, delete one, see invitations waiting for a reply, RSVP to them, list your connected accounts, and fetch your combined calendar feed link.",
          "The same abilities are available directly as an API. A new API tokens page under Settings lets you create and revoke your own tokens. Free accounts include 25 calls a day, and Pro includes unlimited API and assistant access.",
        ],
        link: { label: "what Pro includes", to: "/pricing" },
      },
    ],
    added: [
      {
        id: "2026-04-09-cookie-consent",
        area: "Site",
        summary:
          "Visitors in the EU, EEA and UK are asked whether Keeper.sh may use analytics and advertising cookies, and the choice is remembered.",
      },
    ],
    improved: [
      {
        id: "2026-04-09-assistant-session-length",
        area: "Assistants",
        summary: "A connected assistant stays signed in considerably longer before it asks you to connect again.",
      },
      {
        id: "2026-04-09-destination-retries",
        area: "Syncing",
        summary:
          "A calendar you sync into that hits a passing error keeps retrying on the normal schedule instead of being switched off.",
      },
    ],
    fixed: [
      {
        id: "2026-04-09-claude-desktop-connect",
        area: "Assistants",
        summary: "Connecting Keeper.sh from Claude Desktop goes through, instead of failing before the approval screen.",
      },
      {
        id: "2026-04-09-event-thrash",
        area: "Syncing",
        summary: "Events no longer appear on your other calendars, vanish on the next sync, and come back again.",
      },
      {
        id: "2026-04-09-duplicate-copies",
        area: "Syncing",
        summary: "Copies of the same event no longer pile up, one more added on every sync.",
      },
      {
        id: "2026-04-09-windows-timezones",
        area: "Outlook",
        summary:
          "Calendars that label times the Microsoft way, such as Eastern Standard Time, now arrive at the right hour.",
      },
      {
        id: "2026-04-09-false-reconnect-prompts",
        area: "Connected accounts",
        summary: "An ordinary hiccup no longer flags a working account as needing to be reconnected.",
      },
      {
        id: "2026-04-09-dead-calendars",
        area: "Syncing",
        summary: "A calendar deleted at your provider is switched off instead of failing on every run.",
      },
      {
        id: "2026-04-09-google-error-bodies",
        area: "Google Calendar",
        summary: "An empty or cut-short error from Google no longer stops the whole sync.",
      },
      {
        id: "2026-04-09-calendar-list-fallback",
        area: "Connected accounts",
        summary: "Your calendar list still loads when a provider declines to hand it over.",
      },
      {
        id: "2026-04-09-checkout-window",
        area: "Billing",
        summary: "The checkout window on the upgrade page opens instead of coming up blank.",
      },
      {
        id: "2026-04-09-microsoft-365-connect",
        area: "Outlook",
        summary:
          "Starting a Microsoft 365 connection takes you to the Microsoft sign-in page instead of failing immediately.",
      },
      {
        id: "2026-04-09-caldav-changed-occurrence",
        area: "iCloud",
        summary: "An occurrence of a repeating meeting moved or retitled on a CalDAV calendar now comes across.",
      },
      {
        id: "2026-04-09-caldav-expand",
        area: "iCloud",
        summary: "CalDAV servers that return unusable data for repeating events, Lark among them, now sync.",
      },
      {
        id: "2026-04-09-google-multiple-destinations",
        area: "Google Calendar",
        summary: "One event copied into two Google calendars is no longer treated as a duplicate of itself.",
      },
    ],
  },
  {
    date: "2026-03-11",
    build: "Builds 2.1.8 – 2.2.20",
    features: [
      {
        slug: "2026-03-11-event-types",
        title: "All-day events, out of office and working location",
        summary:
          "All-day events now stay all-day when copied to another calendar, instead of turning into a timed block.",
        body: [
          "Events marked free stay free, across Google, Outlook and CalDAV.",
          "Out-of-office and working-elsewhere events from Google and Outlook are copied as the matching kind of entry, rather than a plain busy block.",
        ],
        link: { label: "everything Keeper.sh does", to: "/features" },
      },
    ],
    added: [],
    improved: [
      {
        id: "2026-03-11-settings-plan",
        area: "Billing",
        summary: "Your plan shows on the settings page as soon as it loads, instead of filling in a moment later.",
      },
      {
        id: "2026-03-11-www-redirect",
        area: "Site",
        summary: "keeper.sh without the www prefix redirects to the www address, so every link lands in the same place.",
      },
    ],
    fixed: [
      {
        id: "2026-03-11-page-scrolling",
        area: "Site",
        summary:
          "Marketing pages, the dashboard and long settings screens scroll again, and size themselves to the visible area on mobile.",
      },
      {
        id: "2026-03-11-touch-tooltips",
        area: "Site",
        summary: "Hover hints no longer stick to the screen on phones and tablets.",
      },
      {
        id: "2026-03-11-passkey-sign-in",
        area: "Sign-in",
        summary:
          "Passkey sign-in is only offered where it can complete, says why it failed, and leaves the password field in place for autofill.",
      },
      {
        id: "2026-03-11-header-flicker",
        area: "Site",
        summary: "A freshly loaded page shows the signed-in menu straight away, rather than the signed-out links first.",
      },
      {
        id: "2026-03-11-caldav-duplicates",
        area: "iCloud",
        summary: "Events written to a CalDAV calendar are matched to the copies already there instead of written twice.",
      },
      {
        id: "2026-03-11-calendar-names",
        area: "Google Calendar",
        summary:
          "A connected calendar keeps the name it had when you connected it, instead of being rewritten on every sync.",
      },
      {
        id: "2026-03-11-stale-calendar-settings",
        area: "Dashboard",
        summary:
          "Moving between calendars refills the details and destination list, instead of leaving the last one on screen.",
      },
      {
        id: "2026-03-11-caldav-original-name",
        area: "iCloud",
        summary: "The name a CalDAV calendar carries on its server is now shown in the calendar details.",
      },
      {
        id: "2026-03-11-caldav-reauth",
        area: "iCloud",
        summary:
          "A CalDAV account whose credentials are refused is marked as needing to be reconnected, instead of retrying forever.",
      },
      {
        id: "2026-03-11-write-only-calendars",
        area: "Syncing",
        summary: "A calendar you only write to is no longer read from as well.",
      },
      {
        id: "2026-03-11-ics-refresh-job",
        area: "Subscribed calendars",
        summary:
          "The refresh handles genuine subscription links only, instead of reading connected accounts as calendar files.",
      },
      {
        id: "2026-03-11-provider-timeouts",
        area: "Syncing",
        summary: "A request Google or Microsoft never answers is given up on after fifteen seconds, so the sync moves on.",
      },
      {
        id: "2026-03-11-exclude-toggles",
        area: "Syncing",
        summary:
          "The exclude toggles for all-day, focus time, out of office and working location apply to every calendar you sync into.",
      },
      {
        id: "2026-03-11-event-metadata-backfill",
        area: "Syncing",
        summary:
          "Events stored before all-day and event-type support arrived are matched to their incoming version, not deleted and recreated.",
      },
      {
        id: "2026-03-11-disabled-menu-rows",
        area: "Dashboard",
        summary: "A row inside a switched-off section now looks switched off.",
      },
      {
        id: "2026-03-11-sitemap-serving",
        area: "Site",
        summary: "The sitemap, llms.txt and llms-full.txt are published with the site and reachable again.",
      },
    ],
  },
  {
    date: "2026-03-10",
    build: "Builds 2.0 – 2.1.7",
    features: [
      {
        slug: "2026-03-10-new-website",
        title: "A new Keeper.sh website",
        summary: "The marketing site has been rebuilt from scratch.",
        body: [
          "A new landing page with illustrated explanations of how syncing works, a How it works walkthrough, an FAQ, refreshed pricing, and privacy and terms pages.",
          "Pages are rendered on the server, so they load quickly and read correctly when shared as links.",
        ],
        link: { label: "everything Keeper.sh does", to: "/features" },
      },
      {
        slug: "2026-03-10-rebuilt-dashboard",
        title: "A rebuilt dashboard",
        summary: "The whole signed-in experience is new.",
        body: [
          "Accounts and their calendars are browsed together, and every calendar has its own page where you set what it does.",
          "The old dashboard has been retired.",
        ],
        link: { label: "everything Keeper.sh does", to: "/features" },
      },
      {
        slug: "2026-03-10-custom-event-names",
        title: "Name your copied events however you like",
        summary: "Copied events can carry a name you write yourself.",
        body: [
          "Write {{event_name}} and {{calendar_name}} where you want them, and Keeper.sh fills them in for each event.",
          "The editor highlights the placeholders as you type, and shows a live preview.",
        ],
        link: { label: "everything Keeper.sh does", to: "/features" },
      },
    ],
    added: [
      {
        id: "2026-03-10-dark-mode",
        area: "Site",
        summary: "Keeper.sh follows your system's light or dark appearance, across the website and the dashboard.",
      },
      {
        id: "2026-03-10-passkeys",
        area: "Sign-in",
        summary:
          "A saved passkey is offered as soon as you focus the email field, and passkeys can be added and removed from settings.",
      },
      {
        id: "2026-03-10-forgot-password",
        area: "Sign-in",
        summary: "A Forgot password link emails you a reset link, and a screen for choosing a new password.",
      },
      {
        id: "2026-03-10-settings-page",
        area: "Account",
        summary:
          "Settings brings your account controls into one place: change your password, manage your passkeys, and delete your account.",
      },
      {
        id: "2026-03-10-event-graph",
        area: "Dashboard",
        summary:
          "The dashboard opens with a bar graph of your event activity over time, with a running total and a count for the day you hover.",
      },
      {
        id: "2026-03-10-event-detail-sync",
        area: "Syncing",
        summary: "On Pro, you decide per calendar whether an event's title, description and location travel with it.",
      },
      {
        id: "2026-03-10-feed-customisation",
        area: "Calendar feeds",
        summary:
          "You pick which calendars appear in your Keeper.sh link, and Pro adds control over names, descriptions, locations and all-day events.",
      },
      {
        id: "2026-03-10-feed-credentials",
        area: "Subscribed calendars",
        summary: "A calendar feed behind a username and password can be added by ticking a box and supplying them.",
      },
      {
        id: "2026-03-10-backfill-week",
        area: "Syncing",
        summary: "Syncing looks back seven days as well as forward, so events from earlier in the week come across.",
      },
      {
        id: "2026-03-10-post-connect-flow",
        area: "Dashboard",
        summary: "Connecting an account walks you straight into choosing which calendars to sync, and where their events go.",
      },
      {
        id: "2026-03-10-sync-indicator",
        area: "Dashboard",
        summary:
          "A live progress ring shows how many events have been processed, and when your calendars last finished syncing.",
      },
      {
        id: "2026-03-10-plan-limits",
        area: "Billing",
        summary:
          "Free covers two linked accounts, three sync connections and the aggregated calendar link; Pro lifts the limits and syncs every minute.",
      },
      {
        id: "2026-03-10-manage-plan",
        area: "Billing",
        summary:
          "The upgrade page has a monthly and yearly toggle, and Pro subscribers get a Manage plan option that opens their billing portal.",
      },
    ],
    improved: [
      {
        id: "2026-03-10-per-calendar-settings",
        area: "Dashboard",
        summary:
          "Each calendar has its own settings page, where you choose which calendars it sends events to and, on Pro, what is carried across.",
      },
    ],
    fixed: [
      {
        id: "2026-03-10-recurring-events",
        area: "Syncing",
        summary:
          "A repeating event whose first occurrence has passed is kept as long as it still has occurrences ahead, and its skipped dates are respected.",
      },
      {
        id: "2026-03-10-event-timezones",
        area: "Syncing",
        summary: "An event keeps the timezone it was created in, so it no longer shifts hours on the way to another calendar.",
      },
      {
        id: "2026-03-10-ics-all-day",
        area: "Subscribed calendars",
        summary: "All-day events published without an end time, holiday calendars among them, now come across.",
      },
      {
        id: "2026-03-10-past-events",
        area: "Syncing",
        summary: "Copies of events that have already started are left alone, instead of being deleted.",
      },
      {
        id: "2026-03-10-private-defaults",
        area: "Syncing",
        summary:
          "A newly connected calendar copies only the calendar's name onto the events it sends on; titles, descriptions and locations stay behind.",
      },
      {
        id: "2026-03-10-sync-without-mappings",
        area: "Syncing",
        summary: "A freshly connected calendar is picked up by the scheduled sync as soon as it can receive events.",
      },
      {
        id: "2026-03-10-stuck-indicator",
        area: "Dashboard",
        summary: "The sync indicator returns to idle when the work is done, instead of claiming a sync is still running.",
      },
      {
        id: "2026-03-10-destination-toggles",
        area: "Dashboard",
        summary: "Toggling destination calendars in quick succession applies your changes in order, instead of losing one.",
      },
      {
        id: "2026-03-10-duplicate-accounts",
        area: "Connected accounts",
        summary: "Two overlapping attempts to connect the same account leave you with one account, not two.",
      },
      {
        id: "2026-03-10-account-deletion",
        area: "Account",
        summary: "Deleting your account finishes cleanly when your billing record has already been removed.",
      },
      {
        id: "2026-03-10-passkey-support-check",
        area: "Sign-in",
        summary: "The sign-in page checks for passkey support first, and falls back to email and password.",
      },
      {
        id: "2026-03-10-graph-drag",
        area: "Dashboard",
        summary: "Dragging along the event graph on a phone reads daily counts instead of scrolling the page.",
      },
      {
        id: "2026-03-10-auth-state",
        area: "Site",
        summary:
          "The header follows your actual session, and the sign-in page sends you to your dashboard if you are already signed in.",
      },
    ],
  },
  {
    date: "2026-01-10",
    build: "Builds 1.7.1 – 1.11.5",
    features: [
      {
        slug: "2026-01-10-google-source",
        title: "Connect Google Calendar as a source",
        summary:
          "You can connect a Google account directly and pick which of its calendars Keeper.sh reads from, instead of finding and pasting a secret iCal link.",
        body: [
          "Connected calendars are pulled in on a schedule, and their busy time is copied to your destination calendars like any other source.",
          "Events Keeper.sh itself created are skipped, so a calendar used as both a source and a destination does not feed its own events back in.",
        ],
        link: { label: "everything Keeper.sh does", to: "/features" },
      },
      {
        slug: "2026-01-10-outlook-source",
        title: "Connect Outlook as a source",
        summary: "Outlook joins Google Calendar as a source you can connect with your account.",
        body: [
          "Sign in, choose the calendar you want read, and Keeper.sh keeps its busy time flowing to your destinations.",
          "Outlook was previously only available as a destination.",
        ],
        link: { label: "everything Keeper.sh does", to: "/features" },
      },
      {
        slug: "2026-01-10-caldav-source",
        title: "Connect iCloud, Fastmail, or any CalDAV calendar as a source",
        summary:
          "Alongside Google and Outlook, you can add an iCloud, Fastmail, or generic CalDAV calendar as a source by entering your address and an app password.",
        body: [
          "The connect dialog tells you where to generate that password for iCloud and Fastmail.",
          "Once connected, the calendar is synced on a schedule like any other source.",
        ],
        link: { label: "the calendars Keeper.sh works with", to: "/features" },
      },
    ],
    added: [
      {
        id: "2026-01-10-google-event-filters",
        area: "Google Calendar",
        summary:
          "When you add a Google source you can uncheck Focus Time, Out of Office and Working Location, so those blocks stay out of your other calendars.",
      },
      {
        id: "2026-01-10-cookie-consent",
        area: "Site",
        summary:
          "Visitors in the EU, EEA and UK are asked whether Keeper.sh may use cookies for analytics, with a link to the privacy policy.",
      },
    ],
    improved: [
      {
        id: "2026-01-10-immediate-source-sync",
        area: "Syncing",
        summary:
          "Adding a Google or Outlook calendar as a source starts a sync straight away, rather than waiting for the next scheduled run.",
      },
    ],
    fixed: [
      {
        id: "2026-01-10-reauth-prompt",
        area: "Connected accounts",
        summary:
          "A Google or Outlook account that stops accepting Keeper.sh is marked as needing to be reconnected, instead of failing quietly.",
      },
      {
        id: "2026-01-10-orphan-events",
        area: "Syncing",
        summary:
          "Events Keeper.sh left on a calendar that no longer match anything in your sources are removed, not just the ones in the past.",
      },
      {
        id: "2026-01-10-outlook-no-description",
        area: "Outlook",
        summary: "An event with no description no longer stops Outlook syncing in either direction.",
      },
      {
        id: "2026-01-10-failed-sync-progress",
        area: "Dashboard",
        summary: "A sync that runs into a problem ends the run, instead of showing progress that never finishes.",
      },
      {
        id: "2026-01-10-delete-without-password",
        area: "Account",
        summary: "Deleting your account only asks for a password when your account actually has one.",
      },
    ],
  },
  {
    date: "2025-12-30",
    build: "Builds 1.1.4 – 1.7",
    features: [
      {
        slug: "2025-12-30-add-calendar-link",
        title: "Add a calendar by pasting its link",
        summary: "Give a calendar a name, paste its iCal link, and Keeper.sh starts pulling in its events.",
        body: [
          "Added calendars are listed on the integrations page, and can be removed again at any time.",
          "Keeper.sh refetches them on a schedule, so what it holds stays in step with the calendar you pointed it at.",
        ],
        link: { label: "everything Keeper.sh does", to: "/features" },
      },
      {
        slug: "2025-12-30-google-calendar-destination",
        title: "Push your busy time into Google Calendar",
        summary: "Connect a Google account and Keeper.sh writes your combined busy time straight into that calendar.",
        body: [
          "Events Keeper.sh created are tracked, so as your sources change they are updated or removed at the other end.",
          "Your Google calendar stays an accurate picture, without you doing anything.",
        ],
        link: { label: "everything Keeper.sh does", to: "/features" },
      },
      {
        slug: "2025-12-30-one-calendar-link",
        title: "One calendar link for everything",
        summary: "Keeper.sh gives you a single iCal link that combines every calendar you have added.",
        body: [
          "Copy it from the integrations page, and subscribe to it anywhere that accepts a calendar URL.",
          "You get all of your busy time in one feed, instead of subscribing to each source separately.",
        ],
        link: { label: "everything Keeper.sh does", to: "/features" },
      },
    ],
    added: [
      {
        id: "2025-12-30-accounts",
        area: "Account",
        summary:
          "You can sign up with an email address and password, continue with Google, or sign in with a passkey, and reset a forgotten password.",
      },
      {
        id: "2025-12-30-agenda-view",
        area: "Dashboard",
        summary:
          "Your events read as a day-by-day agenda rather than a grid, with a colour dot per calendar and further days loading as you scroll.",
      },
      {
        id: "2025-12-30-outlook-destination",
        area: "Outlook",
        summary:
          "Outlook joins Google Calendar as a place to write your busy time to, for both work and personal Microsoft accounts.",
      },
      {
        id: "2025-12-30-caldav-destination",
        area: "iCloud",
        summary: "You can send your busy time to iCloud, Fastmail, or any other calendar that speaks CalDAV.",
      },
      {
        id: "2025-12-30-live-sync-status",
        area: "Dashboard",
        summary: "Each connected calendar shows what Keeper.sh is doing right now, and updates itself as the work happens.",
      },
      {
        id: "2025-12-30-plans",
        area: "Billing",
        summary:
          "A Free plan covers two calendar sources, one destination and the combined iCal feed; Pro lifts those limits and syncs every minute.",
      },
      {
        id: "2025-12-30-billing-history",
        area: "Billing",
        summary: "The billing page lists your past purchases, so you can see what you were charged and when.",
      },
      {
        id: "2025-12-30-source-destination-mapping",
        area: "Syncing",
        summary:
          "You can pick, per destination, which of your calendar sources feed it, so work and personal calendars stay apart.",
      },
      {
        id: "2025-12-30-reauth-badge",
        area: "Connected accounts",
        summary:
          "A connection that needs reconnecting is badged as such, with one click to fix it, and does not count against the Free plan limit.",
      },
      {
        id: "2025-12-30-feed-credentials",
        area: "Subscribed calendars",
        summary: "A calendar link that needs a username and password asks you for them, and uses them when fetching.",
      },
      {
        id: "2025-12-30-self-hosting",
        area: "Self-hosting",
        summary:
          "Keeper.sh can be self-hosted, with published container images, a documented compose setup, and an all-in-one image.",
      },
    ],
    improved: [
      {
        id: "2025-12-30-multiple-accounts",
        area: "Connected accounts",
        summary: "You can connect more than one account per provider, each with its own status and address.",
      },
      {
        id: "2025-12-30-pricing",
        area: "Billing",
        summary: "Pro dropped from $8 a month to $5, and from $48 a year to $42.",
      },
    ],
    fixed: [
      {
        id: "2025-12-30-outlook-to-outlook",
        area: "Outlook",
        summary: "Pushing busy time into an Outlook calendar that is also read as a source no longer piles up duplicates.",
      },
      {
        id: "2025-12-30-repush-deleted",
        area: "Syncing",
        summary:
          "An event deleted at the calendar it was pushed to is written again on the next sync, rather than leaving a hole.",
      },
      {
        id: "2025-12-30-google-collisions",
        area: "Google Calendar",
        summary: "Two busy periods sharing a slot no longer overwrite each other, and removed events are removed from Google.",
      },
      {
        id: "2025-12-30-sourceless-accounts",
        area: "Syncing",
        summary:
          "Someone with a connected destination but no sources is included in every sync run, so stale busy time is cleared.",
      },
      {
        id: "2025-12-30-pro-cadence",
        area: "Syncing",
        summary: "The Pro sync job runs at the intended once-a-minute interval.",
      },
      {
        id: "2025-12-30-status-flicker",
        area: "Dashboard",
        summary: "The sync status no longer flashes back to idle mid-sync, and a genuine count of zero shows as zero.",
      },
      {
        id: "2025-12-30-initial-status",
        area: "Dashboard",
        summary: "A calendar you just connected has a sync status straight away.",
      },
      {
        id: "2025-12-30-passkey-prompt",
        area: "Sign-in",
        summary: "Passkey sign-in no longer prompts twice, and takes you to your dashboard once you have authenticated.",
      },
      {
        id: "2025-12-30-live-status-connection",
        area: "Dashboard",
        summary: "Sync status updates in real time on the hosted site again.",
      },
      {
        id: "2025-12-30-icloud-sync",
        area: "iCloud",
        summary: "iCloud calendars sync again, and a full ten years of repeating events is read rather than a short window.",
      },
      {
        id: "2025-12-30-own-events-reimport",
        area: "Subscribed calendars",
        summary:
          "Events Keeper.sh created are ignored when importing, so a calendar it also writes to no longer inflates your busy time.",
      },
      {
        id: "2025-12-30-reset-password-page",
        area: "Account",
        summary: "The password reset page loads, so a reset link can be followed through to a new password.",
      },
      {
        id: "2025-12-30-header-auth-state",
        area: "Site",
        summary: "The site header follows your sign-in state, instead of needing a reload.",
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

