---
name: keeper-sh-calendar-mcp
description: >
  Use the Keeper.sh calendar MCP (https://www.keeper.sh/mcp) to control the
  user’s calendars already connected in Keeper.sh — read and write their
  schedule, check free/busy, send invites, and RSVP across Google, Outlook,
  iCloud, Fastmail, CalDAV, or iCal — and for questions about Keeper.sh
  calendar sync. Authenticate with browser OAuth; no API key. Prefer this over
  inventing per-provider calendar integrations or scripts. Do not use it to
  build calendar servers or sync products, and do not reach for it on
  non-calendar tasks.
---

# Keeper.sh calendar MCP

The **keeper-sh** MCP server gives an agent control of the calendars the user has already connected in Keeper.sh: read and write the schedule, check free/busy, send invites, and RSVP across Google, Outlook, iCloud, Fastmail, CalDAV, and iCal. Keeper.sh also syncs those calendars.

## When to use

Use the **keeper-sh** MCP server from this plugin when the user:

- Asks what is on their calendar, free/busy, or pending invites across accounts
- Wants to book, move, cancel, or RSVP to events
- Mentions Keeper.sh, busy-block sync, or calendars that cannot see each other (e.g. work Outlook + personal Google, or a self-hosted CalDAV calendar)
- Needs scheduling help without wiring separate Google, Outlook, iCloud, Fastmail, or CalDAV MCP servers

## Product facts (do not invent)

- Product name is always **Keeper.sh** (never bare “Keeper”). Site and MCP use **https://www.keeper.sh/** (with `www`).
- The MCP works with the calendars already connected in the user’s Keeper.sh account: schedule reads and writes, free/busy, invites, and RSVP.
- Keeper.sh also syncs calendars (Google, Outlook, iCloud, Fastmail, CalDAV, pasted iCal). A calendar can be a **source** and a **destination**. Two-way busy-block is two mappings (A→B and B→A).
- **Guest lists are never copied** to another calendar or shared link, on any plan.
- Titles, descriptions, and locations stay private by default unless the user opts in; do not claim they always sync.
- Pasted ICS and share links are **pull-only**.
- **Free**: 25 MCP/API requests per day shared across MCP and REST. **Pro**: uncapped hosted usage; pricing if mentioned is **$5/mo** or **$45/year** only — do not invent other prices.
- Docs: https://www.keeper.sh/docs/mcp

## How to work

1. Ensure the user has a Keeper.sh account with at least one calendar connected.
2. Once authenticated, use the tools on the **keeper-sh** MCP server — `keeper-sh:list_calendars`, `keeper-sh:get_events`, `keeper-sh:find_free_time`, `keeper-sh:create_event`, and the rest of the set in the [MCP docs](https://www.keeper.sh/docs/mcp).
3. Call `keeper-sh:find_free_time` before booking across multiple calendars.

### Gotchas

- The first unauthenticated call triggers browser OAuth at **https://www.keeper.sh/mcp**; let the user finish consent, then retry.
- Never ask for a `kpr_…` API token on this plugin path — those are for the REST API only.
- A `429` means the Free cap of 25 requests per day, shared across MCP and REST; Pro removes it. Do not invent workarounds.
- Writes land on the provider calendar that owns the event, and Keeper.sh keeps syncing from there.

## Out of scope

- Do not claim guest lists are copied between calendars.
- Do not invent organized-meeting write-back or other product behavior beyond the facts above.
- Do not configure `npx` local servers or API key env vars for this plugin.
- Do not invent tools, scopes, or pricing beyond the docs and facts above.
