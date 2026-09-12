# Exchange EWS connector

Connect Exchange calendars using an administrator-supplied HTTPS endpoint. No
provider hostname, tenant, application ID or mailbox is preconfigured. The EWS
connector is independent of the Google Meet description change.

## Authentication

Choose one of these modes in **Connect Exchange EWS**:

- **OAuth2 user sign-in**: device authorization, followed by refresh tokens for
  background synchronization. Supply the device and token endpoints, Client ID,
  requested scopes and mailbox. Public clients do not need a client secret;
  confidential clients can supply one. The authorization server and application
  must support the flow and the required EWS permissions.
- **OAuth2 application**: client credentials, with Client ID, secret and scopes
  posted to the configured token endpoint (`client_secret_post`). The application
  must have permission to access the selected mailbox.
- **NTLM**: HTTPS with username and password, described below.

Basic authentication and manually pasted bearer tokens are not supported. OAuth2
SOAP requests use the Bearer authorization scheme. Connection fields are free
inputs; there is no application-specific Client ID or scope override.

Temporary device sessions are encrypted in Redis, bound to the Keeper user,
expire automatically and are consumed after saving. Private device codes and
access/refresh tokens remain on the server. Persisted EWS configuration is
encrypted using `ENCRYPTION_KEY`; token refresh and rotation use a database row
lock to coordinate API, ingestion and destination writes. Revoked refresh tokens
require reconnection.

## Configuration and connection

Supply the EWS HTTPS endpoint and authentication settings, then discover calendars.
Select at least one calendar before **Save connection**. Keeper preserves detected
read/write capabilities. Configure synchronization directions and copied fields in
the calendar settings after connecting. Reconnection replaces credentials for the
same connection identity; a different server, mailbox or application requires a
new connection.

Advanced fields include mailbox, impersonation, anchor mailbox and EWS schema
version (`Exchange2010_SP2`, `Exchange2013`, `Exchange2013_SP1`, `Exchange2016`;
default `Exchange2013`). Microsoft XML namespaces are protocol identifiers, not
network destinations.

Resource defaults are a 120-second minimum read interval, page size 100, request
budget 1000, 100 ms between requests, 30-second request timeout and 8 MiB response
limit. These are configurable. Effective synchronization frequency also depends on
Keeper's scheduler and retry backoff. Private hosts follow the existing
`BLOCK_PRIVATE_RESOLUTION` and `PRIVATE_RESOLUTION_WHITELIST` server policy.

## Synchronization behavior

The connector integrates discovery, periodic rediscovery, ingestion and destination
copy creation, updates and deletion. It handles all-day events and expanded
recurrences. Existing Keeper settings determine which fields are copied; enable
description copying to retain meeting links found in descriptions. Copies have no
attendees and do not send meeting invitations.

Keeper ownership markers identify copies and recover a successful creation after
an interruption. Foreign events are not deleted as Keeper copies. Deletions use
Deleted Items. Incomplete reads fail rather than authorize deletions from a partial
inventory. This is a copy synchronization connector, not a general meeting editor.

CalendarView reads use 365-day chunks and subdivide overflowing/incomplete chunks.
All chunks must succeed; boundary IDs are deduplicated. GetItem explicitly requests
StartTimeZone and EndTimeZone to interpret all-day dates correctly.

## Installation and upgrades

Install dependencies with `bun install --frozen-lockfile`, run the normal Keeper
migration mechanism, and rebuild the API, cron, worker and web services. Migration
`0094_configurable_ews.sql` adds encrypted credentials and calendar read-state
tables. Existing CalDAV and OAuth accounts keep their current credentials.

When rebasing onto a newer Keeper version, review migration numbering, generated
routes and shared ingestion integration, then rerun checks. This change is not an
automatically loadable plugin across arbitrary future releases.

## Validation

The EWS-only branch was checked with Bun 1.3.11 on macOS:

```sh
# From packages/calendar
TZ=UTC bun x --bun vitest run tests/providers/ews tests/providers/caldav tests/core/oauth
# From services/api
bun x --bun vitest run tests/routes/api/sources/ews tests/utils/ews-account-display.test.ts tests/utils/ews-oauth-session.test.ts
# From services/cron
bun x --bun vitest run tests/jobs/ingest-sources-selection.test.ts
# From packages/database, against a disposable PostgreSQL database
MIGRATION_TEST_DATABASE_URL=postgresql://... bun x --bun vitest run --config vitest.migrations.config.ts
```

Calendar/OAuth/CalDAV: 471 tests; EWS API: 23 tests; cron selection: 6 tests;
PostgreSQL 17 migrations: 21 tests (fresh schema, upgrades and idempotence).
TypeScript and module lint pass for calendar, database, sync, API, cron and web.
The repository unused-code check also passes. Provider tests mostly use simulated
EWS/OAuth responses; the NTLM transport suite additionally runs a real curl
handshake against a local HTTPS fixture. These checks do not establish compatibility
with every Exchange deployment. No personal account configuration or production
secrets are part of the contribution.

## NTLM authentication

Select **NTLM (username and password)** to connect an EWS server that supports
NTLM over HTTPS. Supply the EWS URL, username (email address or `DOMAIN\user`),
password, and optionally the mailbox to open. No provider hostname or account is
built into the connector. OAuth2 modes remain available; Basic is unsupported.

Example configuration (replace every example value):

```json
{
  "serverUrl": "https://exchange.example.org/EWS/Exchange.asmx",
  "auth": {
    "type": "ntlm",
    "username": "person@example.org",
    "password": "replace-with-password"
  },
  "mailbox": "person@example.org"
}
```

The complete configuration is encrypted using Keeper's encryption key in the
existing EWS credentials table. Credentials are supplied again when reconnecting;
passwords are never returned to the browser. No database migration is needed to
add NTLM to an installation already containing the EWS migration.

The API, cron and worker runtimes require `curl` with HTTPS and NTLM support on
PATH. Both container recipes already install curl and now check NTLM availability
at build time. For a source installation, verify `curl --version` includes NTLM.
The implementation uses one curl process per SOAP operation to preserve the NTLM
handshake connection. This adds a TLS/NTLM handshake per operation, so large
calendars can take longer than OAuth2; the existing sync interval, request budget,
page size and timeout settings remain configurable.

Passwords and SOAP bodies go through a pipe, not command arguments or files.
TLS certificate verification is required. Private-address restrictions and DNS
pinning follow Keeper's safe-fetch policy. The transport does not follow redirects,
fall back to Basic, automatically retry SOAP writes, or use ambient HTTP proxies.
For a private Exchange server, configure Keeper's server-side private-host policy;
TLS trust must be installed in the runtime rather than disabled in the form.

Regression tests include a real curl NTLM handshake against a loopback HTTPS
server, Basic-only refusal, private-address blocking, abort and response limits,
and encrypted connection persistence. The PEM files in tests/fixtures/ntlm are
public fixtures used exclusively by that loopback test, not production credentials.

## Deployment limits and existing copies

NTLM requires a direct HTTPS connection: explicit or environment HTTP proxies are
not supported. Install internal certificate authorities in the runtime trust store
and configure the private-host policy for internal servers. Do not disable TLS
verification to work around deployment configuration. OAuth endpoints and EWS
server URLs are independent, configurable values.

New copies are marked for recognition by both EWS and Graph. Copies created by
older EWS builds with only an extended property are not retroactively categorized.
Using EWS and Graph simultaneously for the same mailbox does not deduplicate
independent synchronization links; retain one destination link for that mailbox.
