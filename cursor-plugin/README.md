# Keeper.sh (Cursor plugin)

Marketplace package that wires Cursor to the hosted [Keeper.sh](https://www.keeper.sh/) MCP server so an agent can read and write the calendars you have connected in Keeper.sh.

## Install (once listed)

1. Open the [Cursor Marketplace](https://cursor.com/marketplace) and install **keeper-sh**, or search for Keeper.sh in **Customize → Plugins**.
2. When prompted, complete OAuth in the browser at `https://www.keeper.sh/mcp` — there is no API key to paste and no `npx` process to run.
3. Ask the agent something like “what is on my calendar tomorrow?” so it can call the MCP tools.

Until this package is listed, you can still point an MCP client at `https://www.keeper.sh/mcp` using the same OAuth flow. Docs: [https://www.keeper.sh/docs/mcp](https://www.keeper.sh/docs/mcp).

Marketplace submission (maintainers): [cursor.com/marketplace/publish](https://cursor.com/marketplace/publish).

## What the MCP does

Keeper.sh syncs calendars across Google Calendar, Outlook, iCloud, Fastmail, CalDAV, and pasted iCal so each calendar shows you busy at the same times. The MCP exposes that merged view to assistants over streamable HTTP:

- List calendars and accounts
- Read events, counts, and pending invites
- Create, update, delete, and RSVP to events
- Find free time across synced calendars
- Trigger or pause sync

Writes go through to the provider that owns the calendar. Full tool list and REST equivalents: [docs/mcp](https://www.keeper.sh/docs/mcp).

## Auth

- **OAuth 2.1 in the browser** — dynamic client registration, no app registration step, no API key in this plugin.
- First unauthenticated request returns `401` with resource metadata; the client completes consent at Keeper.sh.
- Optional dashboard API tokens (`kpr_…`) exist for the REST API; this plugin does **not** require or configure them.

## Product context (busy-block sync)

Keeper.sh syncs calendars so each one shows you busy at the same times — Google, Outlook, iCloud, Fastmail, CalDAV, and pasted iCal. A calendar can be a **source** and a **destination**. Two-way busy-block is two mappings (A→B and B→A). Guest lists are **never** copied. Titles, descriptions, and locations stay private by default unless you opt in. Pasted ICS and share links are pull-only.

The MCP is how an agent works with the calendars already connected to your Keeper.sh account.

## Limits

- **Free**: MCP and REST API together are capped at **25 requests per day** (`429` after that).
- **Pro**: uncapped API/MCP usage on the hosted product (Pro is $5/mo or $45/year). Self-hosted instances without commercial mode are treated as Pro.

## Package layout

```text
cursor-plugin/
├── plugin.json          # Agent Plugins manifest (name: keeper-sh)
├── mcp.json             # Hosted MCP: https://www.keeper.sh/mcp
├── skills/              # When to use the Keeper.sh calendar MCP
├── assets/              # Logo copied from the monorepo web assets
├── README.md
└── LICENSE              # MIT for this plugin package (product is AGPL)
```

## Links

- Product: [https://www.keeper.sh/](https://www.keeper.sh/)
- MCP docs: [https://www.keeper.sh/docs/mcp](https://www.keeper.sh/docs/mcp)
- Source monorepo: [https://github.com/ridafkih/keeper.sh](https://github.com/ridafkih/keeper.sh)
