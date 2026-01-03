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

By hosting Keeper yourself, you get all premium features for free, can guarantee data governance and autonomy, and it's fun. If you'll be self-hosting, please consider supporting me and development of the project by sponsoring me on GitHub.

There are five images currently available, two of them are designed for convenience, while the three are designed to serve the granular underlying services.

## Environment Variables

| Name | Service(s) | Description |
| - | - | - |
| DATABASE_URL | `api`, `cron` | PostgreSQL connection URL.<br><br>e.g. `postgres://user:pass@postgres:5432/keeper` |
| REDIS_URL | `api`, `cron` | Redis connection URL.<br><br>e.g. `redis://redis:6379` |
| WEBSOCKET_URL | `api` | The URL the front-end will attempt to connect to the WebSocket using.<br><br>e.g. `ws://localhost:3001/api/socket` |
| BETTER_AUTH_URL | `api` | The base URL of the front-end (used for auth redirects).<br><br>e.g. `http://localhost:3000` |
| BETTER_AUTH_SECRET | `api` | Secret key for session signing.<br><br>e.g. `openssl rand -base64 32` |
| API_PORT | `api` | Port the Bun API listens on. Defaults to `3001` in container images. |
| API_URL | `web` | The URL the Next.js backend uses to proxy requests to the Bun API.<br><br>e.g. `http://api:3001` |
| NEXT_PUBLIC_COMMERCIAL_MODE | `web` | Toggle commercial mode in the web UI (`true`/`false`). |
| NEXT_PUBLIC_POLAR_PRO_MONTHLY_PRODUCT_ID | `web` | Optional. Polar monthly product ID to power in-app upgrade links. |
| NEXT_PUBLIC_POLAR_PRO_YEARLY_PRODUCT_ID | `web` | Optional. Polar yearly product ID to power in-app upgrade links. |
| NEXT_PUBLIC_VISITORS_NOW_TOKEN | `web` | Optional. [visitors.now](https://visitors.now) token for analytics tracking |
| COMMERCIAL_MODE | `api`, `cron` | Enable Polar billing flow. Set to `true` if using Polar for subscriptions. |
| POLAR_ACCESS_TOKEN | `api`, `cron` | Optional. Polar API token for subscription management. |
| POLAR_MODE | `api`, `cron` | Optional. Polar environment, `sandbox` or `production`. |
| POLAR_WEBHOOK_SECRET | `api` | Optional. Secret to verify Polar webhooks. |
| ENCRYPTION_KEY | `api`, `cron` | Key for encrypting CalDAV credentials at rest.<br><br>e.g. `openssl rand -base64 32` |
| RESEND_API_KEY | `api` | Optional. API key for sending emails via Resend. |
| PASSKEY_RP_ID | `api` | Optional. Relying party ID for passkey authentication. |
| PASSKEY_RP_NAME | `api` | Optional. Relying party display name for passkeys. |
| PASSKEY_ORIGIN | `api` | Optional. Origin allowed for passkey flows (e.g., `https://keeper.example.com`). |
| GOOGLE_CLIENT_ID | `api`, `cron` | Optional. Required for Google Calendar integration. |
| GOOGLE_CLIENT_SECRET | `api`, `cron` | Optional. Required for Google Calendar integration. |
| MICROSOFT_CLIENT_ID | `api`, `cron` | Optional. Required for Microsoft Outlook integration. |
| MICROSOFT_CLIENT_SECRET | `api`, `cron` | Optional. Required for Microsoft Outlook integration. |
| TRUSTED_ORIGINS | `api` | Optional. Comma-separated list of additional trusted origins for CSRF protection.<br><br>e.g. `http://192.168.1.100,http://keeper.local,https://keeper.example.com` |

> [!NOTE]
> - `keeper-standalone` auto-configures everything, putting both the Next.js and Bun API behind a single port so you don't have to worry about the `API_URL` and `WEBSOCKET_URL` environment variables.
> - `keeper-services` and individual images require setting `WEBSOCKET_URL` unless you use a reverse proxy to intercept calls from `/api*` on the Next.js origin to the Bun API.

## Images

| Tag | Description | Included Services |
| - | - | - |
| `keeper-standalone:latest` | The "standalone" image is everything you need to get up and running with Keeper with as little configuration as possible. | `keeper-web`, `keeper-api`, `keeper-cron`, `redis`, `postgresql`, `caddy` |
| `keeper-services:latest` | If you'd like for the Redis & Database to exist outside of the container, you can use the "services" image to launch without them included in the image. | `keeper-web`, `keeper-api`, `keeper-cron` |
| `keeper-web:latest` | An image containing the Next.js interface. | `keeper-web` |
| `keeper-api:latest` | An image containing the Bun API service. | `keeper-api` |
| `keeper-cron:latest` | An image containing the Bun cron service. | `keeper-cron` |

## Prerequisites

### Docker & Docker Compose

In order to install Docker Compose, please refer to the [official Docker documentation.](https://docs.docker.com/compose/install/).

### Google OAuth Credentials

> [!TIP]
>
> This is optional, although you will not be able to set Google Calendar as a destination without this.

Reference the [official Google Cloud Platform documentation](https://support.google.com/cloud/answer/15549257) to generate valid credentials for Google OAuth. You must grant your consent screen the `calendar.events` and `userInfo.email` scopes.

Once this is configured, set the client ID and client secret as the `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` environment variables at runtime.

### Microsoft Azure Credentials

> [!TIP]
>
> Once again, this is optional. If you do not configure this, you will not be able to configure Microsoft Outlook as a destination.

Microsoft does not appear to do documentation well, the best I could find for non-legacy instructions on configuring OAuth is this [community thread.](https://learn.microsoft.com/en-us/answers/questions/4705805/how-to-set-up-oauth-2-0-for-outlook). The required scopes are `Calendars.ReadWrite`, `User.Read`, and `offline_access`. The client ID and secret for Microsoft go into the `MICROSOFT_CLIENT_ID` and `MICROSOFT_CLIENT_SECRET` environment variables respectively.

## Standalone Container

While you'd typically want to run containers granularly, if you just want to get up and running, a convenience image `keeper-standalone:latest` has been provided. This container contains the `cron`, `web`, `api`, services as well as a configured `redis`, `database`, and `caddy` instance that puts everything behind the same port. While this is the easiest way to spin up Keeper, it is not recognized as best-practice.

### Generate `keeper-standalone` Environment Variables

The following will generate a `.env` file that contains the key used to generate sessions, as well as the key that is used to encrypt CalDAV credentials at rest.

> [!IMPORTANT]
>
> If you plan on accessing Keeper from a URL _other than_ http://localhost,
> you will need to set the `TRUSTED_ORIGINS` environment variable. This should
> be a comma-delimited list of protocol-hostname inclusive origins you will be using.
>
> Here is an example where we would be accessing Keeper from the LAN IP and where we
> are routing Keeper through a reverse proxy that hosts it at https://keeper.example.com/
> ```bash
> TRUSTED_ORIGINS=http://10.0.0.2:3000,https://keeper.example.com
> ```
> 
> Without this, you will fail CSRF checks on the `better-auth` package.

```bash
cat > .env << EOF
# BETTER_AUTH_SECRET and ENCRYPTION_KEY are required.
# TRUSTED_ORIGINS is required if you plan on accessing Keeper from an
# origin other than http://localhost/
BETTER_AUTH_SECRET=$(openssl rand -base64 32)
ENCRYPTION_KEY=$(openssl rand -base64 32)
TRUSTED_ORIGINS=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
EOF
```

### Run `keeper-standalone` with Docker

If you'd like to just run using the Docker CLI, you can use the following command. I would however recommend [using a compose.yaml](#run-standalone-with-docker-compose) file.

```bash
docker run -d \
  -p 80:80 \
  -v keeper-data:/var/lib/postgresql/data \
  --env-file .env \
  ghcr.io/ridafkih/keeper-standalone:latest
```

### Run `keeper-standalone` with Docker Compose

If you'd prefer to use a `compose.yaml` file, the following is an example. Remember to [populate your .env file first](#generate-keeper-standalone-environment-variables).

```yaml
services:
  keeper:
    image: ghcr.io/ridafkih/keeper-standalone:latest
    ports:
      - "80:80"
    volumes:
      - keeper-data:/var/lib/postgresql/data
    environment:
      BETTER_AUTH_SECRET: ${BETTER_AUTH_SECRET}
      ENCRYPTION_KEY: ${ENCRYPTION_KEY}
      TRUSTED_ORIGINS: ${TRUSTED_ORIGINS}
      COMMERCIAL_MODE: false
      GOOGLE_CLIENT_ID: ${GOOGLE_CLIENT_ID:-}
      GOOGLE_CLIENT_SECRET: ${GOOGLE_CLIENT_SECRET:-}
      MICROSOFT_CLIENT_ID: ${MICROSOFT_CLIENT_ID:-}
      MICROSOFT_CLIENT_SECRET: ${MICROSOFT_CLIENT_SECRET:-}

volumes:
  keeper-data:
```

Once that's configured, you can launch Keeper using the following command.

```bash
docker compose up -d
```

With all said and done, you can access Keeper at http://localhost/. You can use a reverse-proxy like Nginx or Caddy to put Keeper behind a domain on your network.

## Collective Services Image

If you'd like to bring your own Redis and PostgreSQL, you can use the `keeper-services` image. This contains the `cron`, `web` and `api` services in one.

### Generate `keeper-services` Environment Variables

```bash
cat > .env << EOF
# DATABASE_URL, REDIS_URL, and WEBSOCKET_URL are required.
# *_CLIENT_ID and *_CLIENT_SECRET are optional.
BETTER_AUTH_SECRET=$(openssl rand -base64 32)
ENCRYPTION_KEY=$(openssl rand -base64 32)
DATABASE_URL=postgres://keeper:keeper@postgres:5432/keeper
REDIS_URL=redis://redis:6379
WEBSOCKET_URL=ws://localhost:3001/api/socket
BETTER_AUTH_URL=http://localhost:3000
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
EOF
```

### Run `keeper-services` with Docker Compose

Once you've populated your environment variables, you can choose to run `redis` and `postgres` alongside the `keeper-services` image to get up and running.

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

  keeper:
    image: ghcr.io/ridafkih/keeper-services:latest
    environment:
      DATABASE_URL: ${DATABASE_URL}
      REDIS_URL: ${REDIS_URL}
      WEBSOCKET_URL: ${WEBSOCKET_URL}
      BETTER_AUTH_URL: ${BETTER_AUTH_URL}
      BETTER_AUTH_SECRET: ${BETTER_AUTH_SECRET}
      ENCRYPTION_KEY: ${ENCRYPTION_KEY}
      COMMERCIAL_MODE: false
      GOOGLE_CLIENT_ID: ${GOOGLE_CLIENT_ID:-}
      GOOGLE_CLIENT_SECRET: ${GOOGLE_CLIENT_SECRET:-}
      MICROSOFT_CLIENT_ID: ${MICROSOFT_CLIENT_ID:-}
      MICROSOFT_CLIENT_SECRET: ${MICROSOFT_CLIENT_SECRET:-}
    ports:
      - "3000:3000"
      - "3001:3001"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy

volumes:
  postgres-data:
  redis-data:
```

> [!IMPORTANT]
>
> Next.js backend is serverless. It does not support WebSocket servers or long-lived connections. Because of this, we host the WebSocket server on the Bun API on port `3001`. If you run into issues with CORS, I'd recommend putting a reverse proxy in front of Next.js. [See this Caddyfile for an example of what this might look like.](./packages/standalone/rootfs/etc/caddy/Caddyfile).

Once that's configured, you can launch Keeper using the following command.

```bash
docker compose up -d
```

## Individual Service Images

While running services individually is considered best-practice, it is verbose and more complicated to configure. Each service is hosted in its own image.

### Generate Individual Service Environment Variables

```bash
cat > .env << EOF
# The only optional variables are *_CLIENT_ID, *_CLIENT_SECRET
BETTER_AUTH_SECRET=$(openssl rand -base64 32)
ENCRYPTION_KEY=$(openssl rand -base64 32)
API_URL=http://api:3001
WEBSOCKET_URL=ws://localhost:3001/api/socket
POSTGRES_USER=keeper
POSTGRES_PASSWORD=keeper
POSTGRES_DB=keeper
REDIS_URL=redis://redis:6379
BETTER_AUTH_URL=http://localhost:3000
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
EOF
```

### Configure Individual Service `compose.yaml`

```yaml
services:
  postgres:
    image: postgres:17
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
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
      WEBSOCKET_URL: ${WEBSOCKET_URL}
      BETTER_AUTH_URL: ${BETTER_AUTH_URL}
      BETTER_AUTH_SECRET: ${BETTER_AUTH_SECRET}
      ENCRYPTION_KEY: ${ENCRYPTION_KEY}
      COMMERCIAL_MODE: false
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
      API_URL: ${API_URL}
    ports:
      - "3000:3000"
    depends_on:
      api:
        condition: service_started

volumes:
  postgres-data:
  redis-data:
```

Once that's configured, you can launch Keeper using the following command.

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
