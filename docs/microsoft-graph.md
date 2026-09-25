# Microsoft Graph with a per-account Client ID

Open **Connect Microsoft Graph (custom Client ID)** in Keeper. Enter your application
Client ID and tenant (common, organizations, consumers, a tenant GUID or tenant domain).
Keeper uses the Microsoft global cloud Graph API. Sovereign-cloud endpoints and
application-only access are not part of this user device-code connection.

Register a public client application in Microsoft Entra, enable **Allow public client
flows**, and allow delegated Graph permissions **Calendars.ReadWrite** and **User.Read**.
Keeper also requests **offline_access** for refresh tokens. No client secret or redirect
URI is required for device-code authentication. Your application's supported account
types and tenant policy must allow the account signing in. A Client ID alone does not
grant calendar access: the user must approve the requested permissions on Microsoft.

The application ID field has no hardcoded default. Device/token endpoints are derived
from the tenant on login.microsoftonline.com, and the API is graph.microsoft.com/v1.0.
Pending device sessions are encrypted, user-bound, throttled and time-limited in Redis.
Tokens are obtained server-side and are never accepted from or returned to the browser.

After sign-in, Keeper imports the account's calendars using its existing Outlook/Graph
engine. Accounts therefore appear as **Outlook**. Configure directions, ranges and
copied fields in calendar settings. Existing EWS and Google connections are independent.

Migration **0095_graph-client-config.sql** adds optional microsoftClientId and
microsoftTenant fields to oauth_credentials. Each account's OAuth credential retains its
chosen application, used for refreshes during source ingestion, rediscovery, destination
writes, API mutations and push channel management. Existing accounts with no override
continue to use the administrator's MICROSOFT_CLIENT_ID/MICROSOFT_CLIENT_SECRET.
OAuth tokens use Keeper's existing OAuth credential storage; only temporary device
sessions use the encrypted Redis session store.

Reconnect detects this metadata and reopens the Graph form with the saved parameters.
The authenticated Microsoft user must match the original account for reconnection.
For an already-connected Microsoft mailbox, signing in again updates its existing
credential instead of adding an independent copy under a different application.

Validation covers configuration, session ownership/expiry, chosen-application token
refresh and rotation, account import, rejection of browser-injected tokens and foreign
reconnects, and existing OAuth/EWS regression tests.

References:
- https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code
- https://learn.microsoft.com/en-us/graph/permissions-reference

## Configurable scopes

The OAuth scopes field is explicit and independent of the Client ID. The connection form starts with empty fields; callers that omit scopes currently
receive the standard Graph permissions from the API. Applications with preauthorized grants may require
`openid profile offline_access`; consult their documentation. No application ID
is recognized specially or silently assigned different permissions.
The chosen scopes are saved for reconnection by migration 0096. Existing connections
continue refreshing without a new scope request; legacy accounts without saved scopes
must choose the appropriate scopes when reconnecting.


## Atomic connection save

Calendar access is validated before replacing credentials. Credentials, account and
calendar changes commit in a single database transaction. A failed import rolls
back these writes, and background jobs start only after commit. The device session
is retained on failure so the user can retry before it expires. The configured
Client ID, tenant and scopes are not altered by this save process.

## Scope and interoperability

This connector supports delegated device-code sign-in in Microsoft's global cloud.
Sovereign clouds and application-only Graph authentication are not implemented.
Scopes, tenant and Client ID are supplied by the user; there is no special case
for a particular application. CalDAV is a separate protocol: its existing connector
and authentication are unchanged by this Graph connection.

EWS and Graph share encrypted device-session storage, expiry, throttling and locking
while retaining separate session namespaces and protocol-specific validation.

New EWS mirror events carry the same Keeper category that Graph recognizes. EWS
also recognizes this category when reading Graph-created copies. Older EWS copies
with only an extended ownership property are not automatically migrated and can
still appear as sources through Graph. Do not configure parallel EWS and Graph
destinations for the same mailbox when testing; each link can create its own copy.
A complete mesh between distinct calendars requires explicit links because Keeper
copies are not forwarded transitively.

## Reproducing validation

From each indicated package directory, using Bun 1.3.11:

```sh
# packages/calendar
TZ=UTC bun x --bun vitest run tests/providers/ews tests/providers/graph tests/providers/caldav tests/core/oauth
# services/api
bun x --bun vitest run tests/routes/api/sources/ews tests/routes/api/sources/graph tests/utils/ews-account-display.test.ts tests/utils/ews-oauth-session.test.ts tests/utils/graph-oauth-session.test.ts tests/utils/graph-atomic-import.test.ts
# packages/database, using a disposable PostgreSQL instance
MIGRATION_TEST_DATABASE_URL=postgresql://... bun x --bun vitest run --config vitest.migrations.config.ts
```

On the combined EWS + Graph branch, 486 calendar tests, 38 API tests and 22
PostgreSQL 17 migration tests passed. Migration coverage includes upgrading from
schema 0093, preserving existing credentials, nullable Graph defaults and rerunning
after custom metadata has been saved. Atomic-import tests inject failures through
a transaction double; they are not a real-database transaction integration test.

TypeScript and module lint pass for calendar, database, sync, API, cron and web;
the repository unused-code check passes. Provider APIs are simulated in these
automated checks (except the local HTTPS NTLM fixture); successful tests do not
prove compatibility with all tenant/application policies. GitHub CI must be
checked separately on the pull request.
