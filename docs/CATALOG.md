# Wide Event Catalog

This is the implementation specification for observability in Keeper. `docs/LOGGING.md` defines the philosophy. This document defines what we actually emit, why, and how.

## What we need to answer

Before defining fields and events, we define the questions. Every field in every event exists to answer one of these questions. If a field does not help answer any of these, it should not exist.

### Incident response

- **"A user says sync is broken."** → Find all work done for this user in the last hour. See which calendars, which providers, which direction (ingest vs push), what errors. Determine if it is a user-specific issue (bad credentials, deleted calendar) or systemic (provider outage, rate limiting).

- **"Push destinations stopped."** → See if jobs are being enqueued by cron, picked up by the worker, completing, timing out, or stalling. Determine if it is a queue issue, a worker crash, or a specific user blocking the pipeline.

- **"Error rate spiked."** → Group errors by slug, then by provider, then by user. Determine blast radius. Is it one user with 50 calendars all failing, or 50 users each with one failure?

- **"A request is slow."** → See how long was spent in the database, in external APIs, in authentication. Find the bottleneck without reconstructing a trace.

- **"52 out of 649 events failed to push."** → See which error slugs are responsible, how many of each, and whether it is one type of failure repeated or many distinct issues.

### Product understanding

- **"How healthy is sync?"** → Events ingested per cycle, events pushed per cycle, error rate by provider, sync latency distribution.

- **"Are users experiencing degradation?"** → Error rate by user plan (free vs pro), error rate by account age (new users vs established), which providers cause the most friction.

- **"What is driving cost?"** → API call volume by provider, rate limit proximity, queue depth, job duration distribution.

### Debugging unknowns

These are questions we have not thought to ask yet. They are answered by high-cardinality, high-dimensionality data. The more context each event carries, the more unknown questions become answerable after the fact.

---

## Field schema

Fields are organized by what question they answer, not by where in the code they are set. The same field name is used in every service, every event, without exception.

### Service identity: "Which deployment emitted this?"

These fields are set once at service startup by the logging library. They appear on every event automatically and are never set per-event.

| Field | Type | Description |
|-------|------|-------------|
| `service` | string | `"keeper-api"`, `"keeper-cron"`, `"keeper-worker"`, `"keeper-mcp"`, `"keeper-web"` |
| `version` | string | Package version at build time |
| `commit_hash` | string | Git SHA at build time |
| `environment` | string | `"production"` or `"development"` |
| `instance_id` | string | Process ID or container instance identifier |

### Identity: "What happened?"

| Field | Type | Description |
|-------|------|-------------|
| `operation.name` | string | Primary grouping key. What this work is. |
| `operation.type` | string | Category of work: `http`, `job`, `lifecycle`, `webhook`, `connection`, `mcp` |
| `request.id` | string | UUID for this unit of work. Propagated via `x-request-id` across services. |
| `correlation.id` | string | Links related events across services. The producer generates the ID (cron generates it when enqueueing, API generates it when spawning a background task) and includes it in the job payload or task arguments. The consumer reads it from the payload and sets it on its events. This is not automatic — it must be explicitly passed through the boundary between producer and consumer. |
| `outcome` | string | `"success"`, `"error"`, or `"partial"`. Partial means the operation completed but with degraded results (e.g., 597 events synced, 52 failed). |
| `status_code` | number | HTTP status or equivalent (200, 400, 500) |
| `duration_ms` | number | Wall clock time for the entire unit of work |

### Who: "Which user is affected?"

| Field | Type | Description |
|-------|------|-------------|
| `user.id` | string | The user this work is for. Present on every event where the user is known, regardless of auth method or service. |
| `user.plan` | string | `"free"` or `"pro"` — different SLAs, different business impact |
| `user.account_age_days` | number | Days since signup. New-user failures are onboarding bugs. |

The `user` namespace is exclusively for properties of the user. Counts of users processed in a batch job (how many users were found for syncing) use a different namespace — `batch.user_count` — not `user.count`. The `user` fields describe who the user is, not how many there are.

### What went wrong: "Why did it fail?"

There are two error mechanisms, used for different situations.

**`widelog.errorFields()`** is for the primary error that determines the outcome of the entire unit of work. When a source ingestion fails or an API request throws, the error that caused the failure is recorded via `errorFields()`. There is one primary error per event.

| Field | Type | Description |
|-------|------|-------------|
| `error.slug` | string | Static, alertable identifier. Never contains dynamic values. |
| `error.name` | string | Error class name |
| `error.message` | string | Human-readable detail (may be dynamic) |
| `error.retriable` | boolean | Can this succeed on automatic retry? |
| `error.requires_reauth` | boolean | Does this error require the user to reconnect their account? |

**`widelog.error()`** is for individual item-level failures within a larger operation. When syncing 1000 events to a destination and 52 fail, each failure is recorded via `widelog.error()`. The error parser registered with `widelog.errors()` maps each error to a slug, and widelogger aggregates them into a structured summary.

| Field | Type | Description |
|-------|------|-------------|
| `sync.failures.slugs` | string[] | Deduplicated list of error slugs that occurred |
| `sync.failures.counts` | object | Map of slug to occurrence count: `{ "sync-push-conflict": 2, "provider-api-error": 1 }` |
| `sync.failures.total` | number | Total number of individual item failures |

The error parser is registered once per context and is reused across all `widelog.error()` calls. It receives the raw error and returns a slug string. The parser is where application-specific error classification lives — the logging library handles the aggregation.

### Provider context: "Which integration is involved?"

This is the most important debugging dimension for a calendar sync product. Almost every interesting question starts with "which provider?"

| Field | Type | Description |
|-------|------|-------------|
| `provider.name` | string | `"google"`, `"outlook"`, `"icloud"`, `"caldav"`, `"ical"` |
| `provider.account_id` | string | The calendar account ID within Keeper |
| `provider.calendar_id` | string | The specific calendar being operated on |
| `provider.external_calendar_id` | string | The calendar ID on the provider's side |
| `provider.api_status` | number | HTTP status from the provider API (if applicable) |

### Sync context: "What moved?"

| Field | Type | Description |
|-------|------|-------------|
| `sync.direction` | string | `"ingest"` (pull from provider) or `"push"` (write to provider) |
| `sync.events_added` | number | Events successfully created |
| `sync.events_removed` | number | Events successfully deleted |
| `sync.events_failed` | number | Events that failed (total count, matches `sync.failures.total` when failures exist) |
| `sync.calendars_processed` | number | How many calendars were synced in this job |
| `sync.calendars_skipped` | number | Calendars skipped (locked, disabled, auth error) |
| `sync.superseded` | boolean | Was this job cancelled by a newer one? |

### HTTP context: "What request was made?"

| Field | Type | Description |
|-------|------|-------------|
| `http.method` | string | GET, POST, PATCH, DELETE |
| `http.path` | string | URL pathname |
| `http.user_agent` | string | User-Agent header |

### Auth context: "How did they authenticate?"

| Field | Type | Description |
|-------|------|-------------|
| `auth.method` | string | `"session"`, `"api_token"`, `"mcp_token"` |
| `auth.duration_ms` | number | Time spent resolving authentication |
| `auth.session_age_ms` | number | How long ago the session was created. Present on session-based auth. |
| `auth.token_age_ms` | number | How long ago the API/MCP token was created. Present on token-based auth. |
| `auth.claimed_user_id` | string | The user ID extracted from an expired or invalid credential. Present on failed auth where a user identity could be determined from the credential even though it was rejected. Enables debugging "whose expired token is generating 401s?" |

### Rate limiting: "Are we near the limit?"

| Field | Type | Description |
|-------|------|-------------|
| `rate_limit.limit` | number | Total allowed |
| `rate_limit.remaining` | number | Remaining |
| `rate_limit.exceeded` | boolean | Was the limit hit? |

### Job context: "Which background job is this?"

| Field | Type | Description |
|-------|------|-------------|
| `job.id` | string | BullMQ job ID |
| `job.name` | string | Job name |
| `job.superseded_id` | string | ID of the job this one cancelled |

### Performance: "Where was time spent?"

These fields require instrumenting the database, Redis, and HTTP clients to count and time their operations within the widelogger context. They are not included in the initial implementation — they are a future enhancement that requires wrapping the underlying clients. The field names are defined here so they are consistent when added.

| Field | Type | Description |
|-------|------|-------------|
| `stats.database_query_count` | number | Database queries executed |
| `stats.database_query_duration_ms` | number | Total time in database |
| `stats.api_call_count` | number | External API calls made |
| `stats.api_call_duration_ms` | number | Total time in external APIs |
| `stats.redis_call_count` | number | Redis commands issued |

---

## Error slugs

Error slugs are the most important field for operational alerting. Each slug is a static string defined at the throw site. Alerts and dashboards are built on slugs, never on error messages.

Error slugs appear in two places on a wide event:

1. **`error.slug`** — the primary error that failed the unit of work (set via `errorFields()`)
2. **`sync.failures.slugs`** / **`sync.failures.counts`** — individual item-level failures aggregated within a successful or partially-successful unit of work (set via `error()`)

A single event can have both. A calendar sync that succeeds overall (`outcome: "success"`) but has 3 individual event push failures will have no `error.slug` but will have `sync.failures.total: 3` with the breakdown by slug. A calendar sync that fails entirely (`outcome: "error"`) will have `error.slug` set to whatever caused the top-level failure.

### Provider errors

| Slug | Meaning | Retriable | Requires Reauth |
|------|---------|-----------|-----------------|
| `provider-auth-failed` | OAuth token rejected, credentials invalid | No | Yes |
| `provider-token-refresh-failed` | Refresh token rejected (invalid_grant) | No | Yes |
| `provider-scope-insufficient` | Token lacks required OAuth scope | No | Yes |
| `provider-calendar-not-found` | Calendar deleted on provider side | No | No |
| `provider-rate-limited` | Provider rate limit hit | Yes | No |
| `provider-api-error` | Unclassified provider API error | Depends | No |
| `provider-api-timeout` | Provider API call timed out | Yes | No |
| `provider-response-invalid` | Provider returned unparseable response | Yes | No |

### Sync errors

| Slug | Meaning | Retriable | Requires Reauth |
|------|---------|-----------|-----------------|
| `sync-push-failed` | Failed to write event to destination | Depends | No |
| `sync-push-conflict` | Event already exists on destination (409) | No | No |
| `sync-delete-failed` | Failed to delete event from destination | Depends | No |
| `sync-job-stalled` | Worker job detected as stalled | No | No |
| `sync-job-timeout` | Job exceeded deadline | Yes | No |

### User errors

| Slug | Meaning | Retriable | Requires Reauth |
|------|---------|-----------|-----------------|
| `auth-session-expired` | User session no longer valid | No | No |
| `auth-token-invalid` | API token not found or expired | No | No |
| `rate-limit-exceeded` | Daily API usage limit hit | Yes | No |
| `account-limit-reached` | User at max accounts for plan | No | No |
| `source-limit-reached` | User at max sources for plan | No | No |
| `duplicate-source` | Calendar already connected | No | No |

### Infrastructure errors

| Slug | Meaning | Retriable | Requires Reauth |
|------|---------|-----------|-----------------|
| `redis-timeout` | Redis command timed out | Yes | No |
| `webhook-signature-invalid` | Billing webhook failed verification | No | No |

---

## The error parser

Every service that uses `widelog.error()` registers an error parser via `widelog.errors()`. The parser is application-specific — it knows about the error classes in the codebase and maps them to slugs from the table above.

```typescript
widelog.errors((error) => {
  if (error instanceof Error && "status" in error) {
    const status = error.status;
    if (status === 409) return "sync-push-conflict";
    if (status === 429) return "provider-rate-limited";
    if (status === 404) return "provider-calendar-not-found";
  }

  if (error instanceof Error && error.message.includes("timeout")) {
    return "provider-api-timeout";
  }

  return "provider-api-error";
});
```

The parser runs during `flush()`, not when `widelog.error()` is called. This means:
- Errors are accumulated as raw values during processing
- Classification happens once at emission time
- The parser can be changed between flushes if needed (though in practice it is set once per context)

The aggregated output on the wide event looks like:

```json
{
  "sync": {
    "failures": {
      "slugs": ["sync-push-conflict", "provider-api-error"],
      "counts": {
        "sync-push-conflict": 48,
        "provider-api-error": 4
      },
      "total": 52
    },
    "events_added": 597,
    "events_removed": 0,
    "events_failed": 52
  }
}
```

This answers "52 events failed: 48 were conflicts (harmless, the events already exist), 4 were API errors (worth investigating)" — without emitting 52 separate events.

---

## Events by service

### keeper-api

The API service has one primary boundary: the `withWideEvent` middleware. Every HTTP request passes through it. One event per request.

#### What every API event includes

Every API request event carries: service identity, identity fields, HTTP context, `duration_ms`, `outcome`, `status_code`. Authenticated requests additionally carry: user context (`user.id`, `user.plan`, `user.account_age_days`), auth context (`auth.method`, `auth.duration_ms`). V1 API requests additionally carry: rate limit context.

#### Domain-specific enrichment

Beyond the universal fields, specific operations add domain context:

| Operation group | Additional context |
|----------------|-------------------|
| Source CRUD | `provider.name`, `provider.account_id`, `provider.calendar_id` |
| Calendar listing | `provider.name`, calendar count returned, fallback used (scope insufficient) |
| OAuth callbacks | `provider.name`, whether tokens were obtained, whether calendars were imported |
| Destination CRUD | `provider.name`, `provider.account_id` |
| Event CRUD (v1) | `provider.name`, `provider.calendar_id`, event action (create/update/delete/rsvp) |
| Webhook (Polar) | Webhook event type, subscription ID, resulting plan |
| Feedback | Feedback type (feedback/bug report) |

#### Auth requests

Auth protocol requests (`/api/auth/*`) are a separate boundary from regular API requests. They handle login, OAuth flows, and session management. One event per auth request with: service identity, identity fields, HTTP context, `duration_ms`, `outcome`.

#### WebSocket connections

WebSocket open/close are separate events. Each carries: `user.id`, `duration_ms`, `outcome`. These are legitimate separate units of work — a connection is not an HTTP request, it is a persistent channel with its own lifecycle.

#### Background tasks

Async work spawned from request handlers (destination sync triggers, source import jobs) emits separate events. Each carries: `correlation.id` linking back to the originating request, `user.id`, `provider.name`, `duration_ms`, `outcome`. These are separate units of work because they outlive the HTTP request that triggered them.

---

### keeper-cron

#### ingest-sources

Runs every minute. Pulls events from all external calendar providers into the database.

The unit of work for ingestion is syncing one source — not the entire sweep. Each source has its own user, its own provider, its own credentials, its own calendar. A Google calendar failing and an iCloud calendar succeeding are unrelated operations. Aggregating them into one event loses the context that makes debugging possible.

The job uses `widelog.set().sticky()` to set fields common to the entire cron run (operation identity, sync direction), then flushes one event per source with full per-source context. Aggregates (total events added across all sources, total errors) are derived at query time from the individual events, not pre-computed.

```
for each source:
  context:
    widelog.set("operation.name", "ingest-source")
    widelog.set("operation.type", "job")
    widelog.set("sync.direction", "ingest")
    widelog.set("user.id", source.userId)
    widelog.set("provider.name", source.provider)
    widelog.set("provider.account_id", source.accountId)
    widelog.set("provider.calendar_id", source.calendarId)
    widelog.set("provider.external_calendar_id", source.externalCalendarId)

    try:
      widelog.time.measure("duration_ms"):
        sync the source
        widelog.set("sync.events_added", result.eventsAdded)
        widelog.set("sync.events_removed", result.eventsRemoved)
        widelog.set("outcome", "success")
    catch:
      widelog.errorFields(error, { slug, retriable, requiresReauth })
      widelog.set("outcome", "error")
    finally:
      widelog.flush()
```

**What each event captures:**
- `user.id`, `provider.name`, `provider.account_id`, `provider.calendar_id`, `provider.external_calendar_id`
- `sync.direction` = `"ingest"`
- `sync.events_added`, `sync.events_removed`
- On failure: `error.slug`, `error.name`, `error.message`, `error.retriable`, `error.requires_reauth`
- `duration_ms`, `outcome`

**Questions this answers:**
- "Is ingestion healthy?" → Count events by `outcome`, group by `provider.name`
- "Why is this user's calendar stale?" → Filter by `user.id`, see each source's event
- "Is Google down?" → Filter `provider.name = "google"` and `outcome = "error"`, check for spike
- "Which accounts need reauthentication?" → Filter `error.requires_reauth = true`
- "How many events did we ingest this hour?" → Sum `sync.events_added` across all events

#### push-destinations (free and pro)

Runs every minute (pro) or 30 minutes (free). Enqueues sync jobs into the BullMQ queue. This is a lightweight scheduling operation — one event per execution.

**What the event captures:**
- `batch.plan` — which plan this run covers (`"free"` or `"pro"`)
- `batch.user_count` — number of users found with push-capable destinations
- `batch.jobs_enqueued` — number of jobs added to the queue
- `correlation.id` — generated by the producer and included in each job payload, so worker events link back to this enqueue event
- Duration (should be milliseconds — if it is slow, the queue or Redis is the problem)

**Questions this answers:**
- "Are jobs being enqueued?" → Check for regular push-destinations events with `batch.jobs_enqueued > 0`
- "Why aren't pro users syncing?" → Verify the pro cron is running and enqueueing

#### reconcile-subscriptions

Runs daily. Syncs billing state from Polar to the database. One event per execution.

**What the event captures:**
- `batch.processed_count` — number of users whose subscriptions were checked
- `batch.failed_count` — number of users whose reconciliation failed
- `duration_ms`

---

### keeper-worker

The worker processes BullMQ jobs. Each job syncs one user's events to their destination calendars.

#### The sync job

The unit of work for push sync is syncing one destination calendar — not the entire user. A user may have three destinations (Google, Outlook, CalDAV). Each destination sync is independent: different provider, different credentials, different API. The same reasoning applies as with ingest — aggregating them loses the context.

The processor uses `widelog.set().sticky()` to set fields common to the entire job (user identity, job identity, correlation), then flushes one event per destination calendar. Individual event-level push/delete failures within each calendar are recorded via `widelog.error()` and aggregated into `sync.failures`.

```
widelog.set("operation.name", "push-sync").sticky()
widelog.set("operation.type", "job").sticky()
widelog.set("sync.direction", "push").sticky()
widelog.set("user.id", userId).sticky()
widelog.set("user.plan", plan).sticky()
widelog.set("job.id", job.id).sticky()
widelog.set("job.name", job.name).sticky()
widelog.set("correlation.id", correlationId).sticky()

widelog.errors((error) => {
  // classify each push/delete failure into a slug
  if (error.status === 409) return "sync-push-conflict"
  if (error.status === 429) return "provider-rate-limited"
  if (error.message.includes("timeout")) return "provider-api-timeout"
  return "sync-push-failed"
})

for each destination calendar:
  widelog.set("provider.name", destination.provider)
  widelog.set("provider.account_id", destination.accountId)
  widelog.set("provider.calendar_id", destination.calendarId)

  widelog.time.measure("duration_ms"):
    sync the calendar

    widelog.set("sync.events_added", result.added)
    widelog.set("sync.events_removed", result.removed)
    widelog.set("sync.events_failed", result.addFailed + result.removeFailed)

    for each failed push result:
      widelog.error("sync.failures", pushResult.error)

    for each failed delete result:
      widelog.error("sync.failures", deleteResult.error)

    widelog.set("outcome", resolveSyncOutcome(failed, total))

  widelog.flush()
```

**What each event captures:**
- `user.id`, `user.plan`, `job.id`, `job.name`, `correlation.id`
- `provider.name`, `provider.account_id`, `provider.calendar_id`
- `sync.direction` = `"push"`
- `sync.events_added`, `sync.events_removed`, `sync.events_failed`
- `sync.failures.slugs` — deduplicated list of error types that occurred
- `sync.failures.counts` — how many of each: `{ "sync-push-conflict": 48, "provider-api-error": 4 }`
- `sync.failures.total` — total item-level failures
- `duration_ms`, `outcome`

**Questions this answers:**
- "Why did this user's sync fail?" → Filter by `user.id`, see each destination's event with its error context
- "52 events failed — why?" → Check `sync.failures.counts` to see the breakdown by slug. 48 conflicts (harmless) + 4 API errors (investigate).
- "Which provider is causing the most push failures?" → Group events where `sync.events_failed > 0` by `provider.name`
- "How long do syncs take per calendar?" → Distribution of `duration_ms` grouped by `provider.name`
- "Is this a Google outage or one user's problem?" → Count distinct `user.id` where `provider.name = "google"` and `sync.events_failed > 0`
- "Are conflicts increasing over time?" → Track `sync.failures.counts.sync-push-conflict` over time

#### Worker-only events

These events represent situations that the job processor cannot capture because they happen outside normal job execution. They are not redundant with the sync job events — they cover gaps.

| Event | Why it is a separate event |
|-------|---------------------------|
| `job:supersede` | Happens when a new job arrives for a user who already has an active job. The superseding decision happens before the new job's processor runs, in the worker's `active` event handler. Not part of either job's processing lifecycle. |
| `job:stalled` | BullMQ detects a stalled job outside the processor. The processor is not running (that is why it stalled). This is an infrastructure health signal, not a job result. |
| `worker:error` | Worker-level errors (Redis disconnects, connection failures) are not tied to any specific job. They affect the worker's ability to process any job. |
| `worker:lock_renewal_failed` | Lock renewal failures are a precursor to stalls. The processor may still be running but the lock is about to expire. Early warning signal. |

The `job:completed` and `job:failed` BullMQ events do NOT emit separate wide events. The processor's own per-calendar events already capture the outcome, duration, and error context. Emitting a second event for the same unit of work would violate the one-event-per-unit-of-work principle.

---

### keeper-mcp

The MCP service handles Model Context Protocol requests for AI tool use.

#### HTTP requests with tool context

An MCP request is one unit of work. The HTTP request arrives, authentication is resolved, a tool is invoked, and a response is returned. This is one event — not two.

The event carries HTTP context at the request level and tool context as enrichment: `mcp.tool` (which tool was called), `user.id` (from the MCP token), `duration_ms`, `outcome`. The tool invocation is a phase of the request, not a separate unit of work, because every MCP request invokes exactly one tool and the tool call is the entire purpose of the request.

The downstream v1 API call that the tool makes will emit its own event in keeper-api. The two events are linked by `request.id` propagated via the `x-request-id` header.

---

### keeper-web

The web service handles SSR rendering and proxying.

#### HTTP requests

One event per request. Carries: service identity, HTTP context, `duration_ms`, `outcome`. No user context — the web server proxies to the API for authenticated work.

---

## What we do NOT log

- **Successful health checks.** These are noise. The absence of health check events is itself a signal (via uptime monitoring), but logging every 200 OK adds nothing.
- **Request/response bodies.** Too large, potential PII exposure, not useful for the questions we need to answer.
- **Individual database query logs.** We capture rollup stats (`stats.database_query_count`, `stats.database_query_duration_ms`) on the wide event. Individual queries belong in slow query logs, not observability events.
- **Debug-level implementation details.** "Entered function X", "iterating over Y items" — these are what the code is doing, not what happened to the request.
- **Redundant lifecycle events.** BullMQ's `completed` and `failed` events are not emitted as separate wide events because the processor already captures the same information. Emitting both would be logging the same unit of work twice.
- **Batch aggregates.** We do not emit a single aggregate event for an entire ingest sweep or an entire user's push sync. Aggregates are derived at query time from per-source and per-calendar events. Pre-aggregating at write time is a one-way trip that destroys the per-item context needed for debugging.
- **One event per failed item.** When 52 out of 649 events fail to push, we do not emit 52 separate wide events. Instead, `widelog.error()` records each failure and the error parser classifies them into slugs. On flush, widelogger aggregates them into `{ slugs, counts, total }` on the per-calendar event. This gives you the full breakdown without the event volume.

---

## Sampling

| Rule | Keep rate | Rationale |
|------|-----------|-----------|
| `outcome = "error"` | 100% | Every error is investigatable |
| `duration_ms > 5000` | 100% | Slow operations degrade user experience |
| `user.plan = "pro"` | 100% | Paying users get full observability |
| `operation.type = "webhook"` | 100% | Billing events must be traceable |
| `operation.type = "lifecycle"` | 100% | Service starts/stops always matter |
| `sync.failures.total > 0` | 100% | Even partial failures need investigation |
| Everything else | 5% | Healthy, fast, free-tier requests |

All events carry a `sample_rate` field so aggregations can be weighted correctly regardless of sampling.
