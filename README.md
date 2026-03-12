![](./applications/canary-web/public/open-graph.png)

# About

Keeper is a simple & open-source calendar syncing tool. It allows you to pull events from remotely hosted iCal or ICS links, and push them to one or many calendars so the time slots can align across them all.

# Features

- Aggregating calendar events from remote sources
- Event content agnostic syncing engine
- Push aggregate events to one or more calendars
- MCP (Model Context Protocol) server for AI agent calendar access
- Open source under AGPL-3.0
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
3. **The MCP server provides read-only access** to calendar data. AI agents can list calendars and query events but cannot create, modify, or delete them.

# Cloud Hosted

I've made Keeper easy to self-host, but whether you simply want to support the project or don't want to deal with the hassle or overhead of configuring and running your own infrastructure cloud hosting is always an option.

Head to [keeper.sh](https://keeper.sh) to get started with the cloud-hosted version. Use code `README` for 25% off.

|                       | Free       | Pro (Cloud-Hosted) | Pro (Self-Hosted) |
| --------------------- | ---------- | ------------------ | ----------------- |
| **Monthly Price**     | $0 USD     | $5 USD             | $0                |
| **Annual Price**      | $0 USD     | $42 USD (-30%)     | $0                |
| **Refresh Interval**  | 30 minutes | 1 minute           | 1 minute          |
| **Source Limit**      | 2          | ∞                  | ∞                 |
| **Destination Limit** | 1          | ∞                  | ∞                 |

# Self Hosted

By hosting Keeper yourself, you get all premium features for free, can guarantee data governance and autonomy, and it's fun. If you'll be self-hosting, please consider supporting me and development of the project by sponsoring me on GitHub.

There are six images currently available, two of them are designed for convenience, while the four are designed to serve the granular underlying services.

> [!NOTE]
>
> **Migrating from a previous version?** If you are upgrading from the older Next.js-based release, see the [migration guide](https://github.com/ridafkih/keeper.sh/issues/140) for environment variable changes. The new web server will also print a migration notice at startup if it detects old environment variables.

## Environment Variables

| Name                           | Service(s)    | Description                                                                                                                                                         |
| ------------------------------ | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DATABASE_URL                   | `api`, `cron`, `mcp` | PostgreSQL connection URL.<br><br>e.g. `postgres://user:pass@postgres:5432/keeper`                                                                                  |
| REDIS_URL                      | `api`, `cron` | Redis connection URL.<br><br>e.g. `redis://redis:6379`                                                                                                              |
| BETTER_AUTH_URL                | `api`, `mcp`  | The base URL used for auth redirects.<br><br>e.g. `http://localhost:3000`                                                                                           |
| BETTER_AUTH_SECRET             | `api`, `mcp`  | Secret key for session signing.<br><br>e.g. `openssl rand -base64 32`                                                                                               |
| API_PORT                       | `api`         | Port the Bun API listens on. Defaults to `3001` in container images.                                                                                                |
| VITE_API_URL                   | `web`         | The URL the web server uses to proxy requests to the Bun API.<br><br>e.g. `http://api:3001`                                                                         |
| COMMERCIAL_MODE                | `api`, `cron` | Enable Polar billing flow. Set to `true` if using Polar for subscriptions.                                                                                          |
| POLAR_ACCESS_TOKEN             | `api`, `cron` | Optional. Polar API token for subscription management.                                                                                                              |
| POLAR_MODE                     | `api`, `cron` | Optional. Polar environment, `sandbox` or `production`.                                                                                                             |
| POLAR_WEBHOOK_SECRET           | `api`         | Optional. Secret to verify Polar webhooks.                                                                                                                          |
| ENCRYPTION_KEY                 | `api`, `cron` | Key for encrypting CalDAV credentials at rest.<br><br>e.g. `openssl rand -base64 32`                                                                                |
| RESEND_API_KEY                 | `api`         | Optional. API key for sending emails via Resend.                                                                                                                    |
| PASSKEY_RP_ID                  | `api`         | Optional. Relying party ID for passkey authentication.                                                                                                              |
| PASSKEY_RP_NAME                | `api`         | Optional. Relying party display name for passkeys.                                                                                                                  |
| PASSKEY_ORIGIN                 | `api`         | Optional. Origin allowed for passkey flows (e.g., `https://keeper.example.com`).                                                                                    |
| GOOGLE_CLIENT_ID               | `api`, `cron` | Optional. Required for Google Calendar integration.                                                                                                                 |
| GOOGLE_CLIENT_SECRET           | `api`, `cron` | Optional. Required for Google Calendar integration.                                                                                                                 |
| MICROSOFT_CLIENT_ID            | `api`, `cron` | Optional. Required for Microsoft Outlook integration.                                                                                                               |
| MICROSOFT_CLIENT_SECRET        | `api`, `cron` | Optional. Required for Microsoft Outlook integration.                                                                                                               |
| TRUSTED_ORIGINS                | `api`         | Optional. Comma-separated list of additional trusted origins for CSRF protection.<br><br>e.g. `http://192.168.1.100,http://keeper.local,https://keeper.example.com` |
| MCP_PUBLIC_URL                 | `api`, `mcp`  | Optional. Public URL of the MCP resource. Enables OAuth on the API and identifies the MCP server to clients.<br><br>e.g. `https://keeper.example.com/mcp`           |
| VITE_MCP_URL                   | `web`         | Optional. Internal URL the web server uses to proxy `/mcp` requests to the MCP service.<br><br>e.g. `http://mcp:3002`                                              |
| MCP_PORT                       | `mcp`         | Optional. Port the MCP server listens on.<br><br>e.g. `3002`                                                                                                       |

The following environment variables are baked into the web image at **build time**. They are pre-configured in the official Docker images and only need to be set if you are building from source.

| Name                              | Description                                                        |
| --------------------------------- | ------------------------------------------------------------------ |
| VITE_COMMERCIAL_MODE              | Toggle commercial mode in the web UI (`true`/`false`).             |
| VITE_POLAR_PRO_MONTHLY_PRODUCT_ID | Optional. Polar monthly product ID to power in-app upgrade links.  |
| VITE_POLAR_PRO_YEARLY_PRODUCT_ID  | Optional. Polar yearly product ID to power in-app upgrade links.   |
| VITE_VISITORS_NOW_TOKEN           | Optional. [visitors.now](https://visitors.now) token for analytics |
| VITE_GOOGLE_ADS_ID                | Optional. Google Ads conversion tracking ID (e.g., `AW-123456789`) |
| VITE_GOOGLE_ADS_CONVERSION_LABEL  | Optional. Google Ads conversion label for purchase tracking        |

> [!NOTE]
>
> - `keeper-standalone` auto-configures everything internally — both the web server and Bun API sit behind a single Caddy reverse proxy on port `80`.
> - `keeper-services` runs the web, API, and cron services inside one container. The web server proxies `/api` requests internally, so only port `3000` needs to be exposed.
> - For individual images, only the `web` container needs to be exposed. The API is accessed internally via `VITE_API_URL`.

## Images

| Tag                        | Description                                                                                                                                              | Included Services                                                         |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `keeper-standalone:latest` | The "standalone" image is everything you need to get up and running with Keeper with as little configuration as possible.                                | `keeper-web`, `keeper-api`, `keeper-cron`, `redis`, `postgresql`, `caddy` |
| `keeper-services:latest`   | If you'd like for the Redis & Database to exist outside of the container, you can use the "services" image to launch without them included in the image. | `keeper-web`, `keeper-api`, `keeper-cron`                                 |
| `keeper-web:latest`        | An image containing the Vite SSR web interface.                                                                                                          | `keeper-web`                                                              |
| `keeper-api:latest`        | An image containing the Bun API service.                                                                                                                 | `keeper-api`                                                              |
| `keeper-cron:latest`       | An image containing the Bun cron service.                                                                                                                | `keeper-cron`                                                             |
| `keeper-mcp:latest`        | An image containing the MCP server for AI agent calendar access. Optional — only needed if using MCP clients.                                            | `keeper-mcp`                                                              |

## Prerequisites

### Docker & Docker Compose

In order to install Docker Compose, please refer to the [official Docker documentation.](https://docs.docker.com/compose/install/).

### Google OAuth Credentials

> [!TIP]
>
> This is optional, although you will not be able to set Google Calendar as a destination without this.

Reference the [official Google Cloud Platform documentation](https://support.google.com/cloud/answer/15549257) to generate valid credentials for Google OAuth. You must grant your consent screen the `calendar.events`, `calendar.calendarlist.readonly`, and `userinfo.email` scopes.

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
>
> ```bash
> TRUSTED_ORIGINS=http://10.0.0.2,https://keeper.example.com
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
# DATABASE_URL and REDIS_URL are required.
# *_CLIENT_ID and *_CLIENT_SECRET are optional.
BETTER_AUTH_SECRET=$(openssl rand -base64 32)
ENCRYPTION_KEY=$(openssl rand -base64 32)
DATABASE_URL=postgres://keeper:keeper@postgres:5432/keeper
REDIS_URL=redis://redis:6379
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
      BETTER_AUTH_URL: ${BETTER_AUTH_URL}
      BETTER_AUTH_SECRET: ${BETTER_AUTH_SECRET}
      ENCRYPTION_KEY: ${ENCRYPTION_KEY}
      GOOGLE_CLIENT_ID: ${GOOGLE_CLIENT_ID:-}
      GOOGLE_CLIENT_SECRET: ${GOOGLE_CLIENT_SECRET:-}
      MICROSOFT_CLIENT_ID: ${MICROSOFT_CLIENT_ID:-}
      MICROSOFT_CLIENT_SECRET: ${MICROSOFT_CLIENT_SECRET:-}
    ports:
      - "3000:3000"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy

volumes:
  postgres-data:
  redis-data:
```

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
VITE_API_URL=http://api:3001
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
      BETTER_AUTH_URL: ${BETTER_AUTH_URL}
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
      VITE_API_URL: ${VITE_API_URL}
      ENV: production
      PORT: 3000
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

# MCP (Model Context Protocol)

Keeper includes an optional MCP server that lets AI agents (such as Claude) access your calendar data through a standardized protocol. The MCP server authenticates via OAuth 2.1 with a consent flow hosted by the web application.

## Available Tools

| Tool              | Description                                                                                          |
| ----------------- | ---------------------------------------------------------------------------------------------------- |
| `list_calendars`  | List all calendars connected to Keeper, including provider name and account.                          |
| `get_events`      | Get calendar events within a date range. Accepts ISO 8601 datetimes and an IANA timezone identifier. |
| `get_event_count` | Get the total number of calendar events synced to Keeper.                                            |

## Connecting an MCP Client

To connect an MCP-compatible client (e.g. Claude Code, Claude Desktop), point it at your MCP server URL. The client will be guided through the OAuth consent flow to authorize read access to your calendar data.

Example Claude Code MCP configuration:

```json
{
  "mcpServers": {
    "keeper": {
      "type": "url",
      "url": "https://keeper.example.com/mcp"
    }
  }
}
```

## Self-Hosted MCP Setup

> [!NOTE]
>
> MCP is fully optional. All MCP-related environment variables are optional across every service and image. If they are not set, Keeper starts normally without MCP functionality. Existing self-hosted deployments are unaffected.

The MCP server is proxied through the web service at `/mcp`, the same way the API is proxied at `/api`. MCP is **not** bundled in the `keeper-standalone` or `keeper-services` convenience images — run the `keeper-mcp` image as a separate container alongside them.

To enable MCP on a self-hosted instance:

1. Run the `keeper-mcp` container with `MCP_PORT`, `MCP_PUBLIC_URL`, `DATABASE_URL`, `BETTER_AUTH_SECRET`, and `BETTER_AUTH_URL`.
2. Set `MCP_PUBLIC_URL` on the `api` service to the same value (e.g. `https://keeper.example.com/mcp`).
3. Set `VITE_MCP_URL` on the `web` service to the internal URL of the MCP container (e.g. `http://mcp:3002`).

# Modules

## Applications

1. [@keeper.sh/api](./applications/api)
2. [@keeper.sh/cron](./applications/cron)
3. [@keeper.sh/mcp](./applications/mcp)
4. [canary-web](./applications/canary-web)
5. @keeper.sh/cli _(Coming Soon)_
6. @keeper.sh/mobile _(Coming Soon)_
7. @keeper.sh/ssh _(Coming Soon)_

## Modules

1. [@keeper.sh/auth](./packages/auth)
1. [@keeper.sh/auth-plugin-username-only](./packages/auth-plugin-username-only)
1. [@keeper.sh/broadcast](./packages/broadcast)
1. [@keeper.sh/broadcast-client](./packages/broadcast-client)
1. [@keeper.sh/calendar](./packages/calendar)
1. [@keeper.sh/constants](./packages/constants)
1. [@keeper.sh/data-schemas](./packages/data-schemas)
1. [@keeper.sh/database](./packages/database)
1. [@keeper.sh/date-utils](./packages/date-utils)
1. [@keeper.sh/encryption](./packages/encryption)
1. [@keeper.sh/env](./packages/env)
1. [@keeper.sh/fixtures](./packages/fixtures)
1. [@keeper.sh/keeper-api](./packages/keeper-api)
1. [@keeper.sh/oauth](./packages/oauth)
1. [@keeper.sh/oauth-google](./packages/oauth-google)
1. [@keeper.sh/oauth-microsoft](./packages/oauth-microsoft)
1. [@keeper.sh/premium](./packages/premium)
1. [@keeper.sh/provider-caldav](./packages/provider-caldav)
1. [@keeper.sh/provider-core](./packages/provider-core)
1. [@keeper.sh/provider-fastmail](./packages/provider-fastmail)
1. [@keeper.sh/provider-google-calendar](./packages/provider-google-calendar)
1. [@keeper.sh/provider-icloud](./packages/provider-icloud)
1. [@keeper.sh/provider-outlook](./packages/provider-outlook)
1. [@keeper.sh/provider-registry](./packages/provider-registry)
1. [@keeper.sh/pull-calendar](./packages/pull-calendar)
1. [@keeper.sh/sync-calendar](./packages/sync-calendar)
1. [@keeper.sh/sync-events](./packages/sync-events)
1. [@keeper.sh/typescript-config](./packages/typescript-config)
