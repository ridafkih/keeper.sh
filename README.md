![]()

# About
Keeper is a simple & open-source calendar syncing tool. It allows you to pull events from remotely hosted iCal or ICS links, and push them to your main calendar so the time slots can align across all your calendars.

# Stack & Tooling

These are a few of the tools I want to give special mention to for making Keeper an absolute pleasure to build.

- [Next.js 16](https://nextjs.org/) for creating the web interface.
- [better-auth](http://better-auth.com/) for authentication and user management.
- [arktype](https://arktype.io/) for lovely data validation.
- [Polar](https://polar.sh/) for payments, usage and billing.
- [Drizzle ORM](https://orm.drizzle.team/) for interacting with databases.
- [Bun](https://bun.com/) for a speedy runtime and package manager.
- [Turborepo](https://turborepo.com/) for optimizing workflow management.
- [Docker](https://www.docker.com/) for containerization.
- [Redis](https://redis.io/) for a fast in-memory data store.
- [PostgreSQL](https://www.postgresql.org/) for the database.
- [Knip](https://knip.dev/) for dead code and misconfiguration detection.

# Features
- Aggregating calendar events from remote sources
- Event content agnostic syncing engine
- Push aggregate events to one or more calendars
- Open source under GPL-3.0
- Easy to self-host
- Easy-to-purge remote events

# Bug Reports & Feature Requests
If you encounter a bug or have an idea for a feature, you may [open an issue on GitHub](https://github.com/ridafkih/keeper.sh/issues) and it will be triaged and addressed as soon as possible.

# Contributing
High-value and high-quality contributions are appreciated. Before working on large features you intend to see merged, please open an issue first to discuss beforehand.

# Qs

## Why does this exist?

Because I needed it. Ever since starting [Sedna](https://sedna.sh/)—the AI governance platform—I've had to work across three calendars. One for my business, one for work, and one for personal. 

Meetings have landed on top of one-another a frustratingly high number of times.

## Why not use _this other service_?

I've probably tried it. It was probably too finicky, ended up making me waste hours of my time having to delete stale events it didn't seem to want to track anymore, or just didn't sync reliably.

## How does the syncing engine work?

Simply. It compares timeslots from the aggregate events of all your sources to events Keeper has created on the destination calendar, as identified by the `@keeper.sh` suffix on the event's remote UID. Keeper simply ensures that the correct number of events exist at any given timeslot.

# Considerations
1. **Keeper is timeslot first**, it does not consider nor does it sync summaries, descriptions, etc., if you need that I would recommend [OneCal](https://onecal.io/).
2. **Keeper only sources from remote and publicly available iCal/ICS URLs** at the moment, so that means that if your security policy does not permit these, another solution may suit you better.

# Modules

## Services

1. [@keeper.sh/api](./packages/api)
2. [@keeper.sh/cron](./packages/cron)

## Applications
1. @keeper.sh/cli _(Coming Soon)_
1. @keeper.sh/mobile _(Coming Soon)_
1. @keeper.sh/ssh _(Coming Soon)_
1. [@keeper.sh/web](./packages/web)

## Modules
1. [@keeper.sh/auth](./packages/auth)
1. [@keeper.sh/auth-plugin-username-only](./packages/auth-plugin-username-only)
1. [@keeper.sh/broadcast](./packages/broadcast)
1. [@keeper.sh/broadcast-client](./packages/broadcast-client)
1. [@keeper.sh/calendar](./packages/calendar)
1. [@keeper.sh/data-schemas](./packages/data-schemas)
1. [@keeper.sh/database](./packages/database)
1. [@keeper.sh/env](./packages/env)
1. @keeper.sh/eslint-config _(Coming Soon)_
1. [@keeper.sh/integration-google-calendar](./packages/integration-google-calendar)
1. [@keeper.sh/integrations](./packages/integrations)
1. [@keeper.sh/log](./packages/log)
1. [@keeper.sh/oauth-google](./packages/oauth-google)
1. [@keeper.sh/premium](./packages/premium)
1. [@keeper.sh/pull-calendar](./packages/pull-calendar)
1. [@keeper.sh/redis](./packages/redis)
1. [@keeper.sh/sync-calendar](./packages/sync-calendar)
1. [@keeper.sh/sync-events](./packages/sync-events)
1. [@keeper.sh/typescript-config](./packages/typescript-config)

# Cloud Hosted

I've made Keeper easy to self-host, but whether you simply want to support the project or don't want to deal with the hassle or overhead of configuring and running your own infrastructure cloud hosting is always an option.

Head to [keeper.sh](https://keeper.sh) to get started with the cloud-hosted version. Use code `README` for 25% off.

|  | Free | Pro (Cloud-Hosted) | Pro (Self-Hosted) |
| - | - | - | - |
| **Monthly Price** | $0 USD | $8 USD | $0 | 
| **Annual Price** | $0 USD | $48 USD (-50%) | $0 |
| **Refresh Interval** | 30 minutes | 1 minute | 1 minute
| **Source Limit** | 2 | ∞ | ∞
| **Destination Limit** | 1 | ∞ | ∞

# Self Hosted

By hosting Keeper yourself, you get all premium features for free, can guarantee data governance and autonomy, and it's fun.

If you'll be self-hosting, please consider supporting me and development of the project by sponsoring me on GitHub.

## Prerequisites

## Configuration

## Getting Started
