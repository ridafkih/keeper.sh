![](https://github.com/user-attachments/assets/09996180-326b-4081-b12b-f00393d1aa6e#gh-light-mode-only)
![](https://github.com/user-attachments/assets/10546b8e-639d-44d1-a79d-b49a65f09724#gh-dark-mode-only)

# About
Keeper is a simple & open-source calendar syncing tool. It allows you to pull events from remotely hosted iCal or ICS links, and push them to your main calendar so the time slots can align across all your calendars.

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

- If we have a local event but no corresponding "source → destination" mapping for an event, we push the event to the destination calendar.
- If we have a mapping for an event, but the source ID is not present on the source any longer, we delete the event from the destination.
- Any events with markers of having been created by Keeper, but with no corresponding local tracking, we remove it. This is only done for backwards compatibility.

Events are flagged as having been created by Keeper either using a `@keeper.sh` suffix on the remote UID, or in the case of a platform like Outlook that doesn't support custom UIDs, we just put it in a `"keeper.sh"` category.

# Considerations
1. **Keeper tracks timeslots, not event details**, summaries, descriptions, etc., for now. If you need that I would recommend [OneCal](https://onecal.io/).
2. **Keeper only sources from remote and publicly available iCal/ICS URLs** at the moment, so that means that if your security policy does not permit these, another solution may suit you better.

# Cloud Hosted

I've made Keeper easy to self-host, but whether you simply want to support the project or don't want to deal with the hassle or overhead of configuring and running your own infrastructure cloud hosting is always an option.

Head to [keeper.sh](https://keeper.sh) to get started with the cloud-hosted version. Use code `README` for 25% off.

|  | Free | Pro (Cloud-Hosted) | Pro (Self-Hosted) |
| - | - | - | - |
| **Monthly Price** | $0 USD | $5 USD | $0 | 
| **Annual Price** | $0 USD | $42 USD (-30%) | $0 |
| **Refresh Interval** | 30 minutes | 1 minute | 1 minute
| **Source Limit** | 2 | ∞ | ∞
| **Destination Limit** | 1 | ∞ | ∞

# Self Hosted

By hosting Keeper yourself, you get all premium features for free, can guarantee data governance and autonomy, and it's fun.

If you'll be self-hosting, please consider supporting me and development of the project by sponsoring me on GitHub.

## Prerequisites

- Docker and Docker Compose
- (Optional) Google OAuth credentials for Google Calendar integration
- (Optional) Microsoft OAuth credentials for Outlook integration
- (Optional) Resend API key for email notifications

## Getting Started

### Generate Secrets

Running the following command will populate a `.env` file for you with required secrets for the Docker Compose configuration.

```bash
cat > .env << EOF
DOMAIN=localhost
BETTER_AUTH_SECRET=$(openssl rand -base64 32)
ENCRYPTION_KEY=$(openssl rand -base64 32)
EOF
```

### Configuring Providers

If you'd like to configure optional providers, you can refer to the [Google OAuth documentation](https://developers.google.com/identity/protocols/oauth2) on configuring your Google client ID and secret, and Outlook's documentation can be found on the [Microsoft documentation website](https://learn.microsoft.com/en-us/entra/architecture/auth-oauth2) where you can learn to configure Entra ID in the Azure portal to get your Microsoft client ID and secret.

Once you've acquired them, simply add them to the environment variables to make them available as destinations.

```bash
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
```

### Create `compose.yaml`

Adjacent to the `.env` file you've created, create your `compose.yaml` which will define all the services required to run Keeper.

```yaml
services:
  postgres:
    image: postgres:17
    environment:
      POSTGRES_USER: keeper
      POSTGRES_PASSWORD: keeper
      POSTGRES_DB: keeper
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U keeper -d keeper"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    volumes:
      - redis-data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5

  api:
    image: ghcr.io/ridafkih/keeper-api:latest
    environment:
      API_PORT: 3001
      DATABASE_URL: postgres://keeper:keeper@postgres:5432/keeper
      REDIS_URL: redis://redis:6379
      BETTER_AUTH_URL: http://${DOMAIN:-localhost}:3000
      BETTER_AUTH_SECRET: ${BETTER_AUTH_SECRET}
      ENCRYPTION_KEY: ${ENCRYPTION_KEY}
      COMMERCIAL_MODE: false
      PASSKEY_RP_ID: ${DOMAIN:-localhost}
      PASSKEY_RP_NAME: Keeper
      PASSKEY_ORIGIN: http://${DOMAIN:-localhost}:3000
      GOOGLE_CLIENT_ID: ${GOOGLE_CLIENT_ID:-}
      GOOGLE_CLIENT_SECRET: ${GOOGLE_CLIENT_SECRET:-}
      MICROSOFT_CLIENT_ID: ${MICROSOFT_CLIENT_ID:-}
      MICROSOFT_CLIENT_SECRET: ${MICROSOFT_CLIENT_SECRET:-}
    ports:
      - "3001:3001"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy

  cron:
    image: ghcr.io/ridafkih/keeper-cron:latest
    environment:
      DATABASE_URL: postgres://keeper:keeper@postgres:5432/keeper
      REDIS_URL: redis://redis:6379
      BETTER_AUTH_URL: http://${DOMAIN:-localhost}:3000
      BETTER_AUTH_SECRET: ${BETTER_AUTH_SECRET}
      ENCRYPTION_KEY: ${ENCRYPTION_KEY}
      GOOGLE_CLIENT_ID: ${GOOGLE_CLIENT_ID:-}
      GOOGLE_CLIENT_SECRET: ${GOOGLE_CLIENT_SECRET:-}
      MICROSOFT_CLIENT_ID: ${MICROSOFT_CLIENT_ID:-}
      MICROSOFT_CLIENT_SECRET: ${MICROSOFT_CLIENT_SECRET:-}
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy

  web:
    image: ghcr.io/ridafkih/keeper-web:latest
    environment:
      API_URL: http://api:3001
    ports:
      - "3000:3000"
    depends_on:
      api:
        condition: service_started

volumes:
  postgres-data:
  redis-data:
```

### Start Keeper

Once this is done, Keeper will be available at `http://localhost:3000` or the custom domain you've set. You can pair this configuration with a reverse-proxy. I personally use, prefer and recommend [Caddy](https://caddyserver.com/) as it has a great configuration system and automatically manages certificates for you.

```bash
docker compose up -d
```

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
1. [@keeper.sh/destination-providers](./packages/destination-providers)
1. [@keeper.sh/destination-metadata](./packages/destination-metadata)
1. [@keeper.sh/encryption](./packages/encryption)
1. [@keeper.sh/env](./packages/env)
1. @keeper.sh/eslint-config _(Coming Soon)_
1. [@keeper.sh/integration-caldav](./packages/integration-caldav)
1. [@keeper.sh/integration-fastmail](./packages/integration-fastmail)
1. [@keeper.sh/integration-google-calendar](./packages/integration-google-calendar)
1. [@keeper.sh/integration-icloud](./packages/integration-icloud)
1. [@keeper.sh/integration-outlook](./packages/integration-outlook)
1. [@keeper.sh/integrations](./packages/integrations)
1. [@keeper.sh/log](./packages/log)
1. [@keeper.sh/oauth-google](./packages/oauth-google)
1. [@keeper.sh/oauth-microsoft](./packages/oauth-microsoft)
1. [@keeper.sh/premium](./packages/premium)
1. [@keeper.sh/pull-calendar](./packages/pull-calendar)
1. [@keeper.sh/redis](./packages/redis)
1. [@keeper.sh/sync-calendar](./packages/sync-calendar)
1. [@keeper.sh/sync-events](./packages/sync-events)
1. [@keeper.sh/typescript-config](./packages/typescript-config)
