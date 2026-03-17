# Logging Philosophy

This document defines how we think about logging, why most logging is broken, and what we do instead. It is not specific to any one product — it is a commentary on how and why engineers should make technical decisions about observability.

## The problem with logging

Logging, as commonly practiced, is fundamentally broken. It was designed for a different era — monoliths, single servers, problems you could reproduce locally. The modern reality is distributed services, dozens of hops per request, and failures that emerge from the interaction of components that each appear healthy in isolation.

Traditional logging optimizes for writing, not for querying. A developer adds `console.log("user created")` at the point where something happens, then moves on. This feels productive. It is not. When something breaks in production and you need to understand what happened, you are the one who pays the cost — grepping through thousands of lines, mentally reconstructing state from fragments scattered across services, hoping the one log line you need was written by someone who anticipated your question months ago.

The fundamental mistake is treating logs as a diary of what your code is doing. Nobody cares what your code is doing. What matters is what happened to this request, this user, this job.

## Wide events

The solution is wide events, also called canonical log lines. The concept is simple: for each unit of work your service performs — an HTTP request, a cron job, a queue job, a WebSocket connection — emit one structured event at the end that contains everything relevant about what happened.

Not a log line per function call. Not scattered `logger.info()` calls throughout a handler. One event. Rich with context. Emitted once.

This idea is not new. Stripe has used canonical log lines since their early days. Facebook built Scuba around arbitrarily wide events. Honeycomb's entire product philosophy is built on this foundation. The pattern has been proven at every scale.

### What a wide event looks like

```json
{
  "service": "checkout-service",
  "version": "2.4.1",
  "commit_hash": "a1b2c3d",
  "environment": "production",
  "instance_id": "i-0abc123",
  "operation": {
    "name": "POST /api/checkout",
    "type": "http"
  },
  "request": {
    "id": "req_8bf7ec2d"
  },
  "http": {
    "method": "POST",
    "path": "/api/checkout",
    "status_code": 500
  },
  "user": {
    "id": "user_456",
    "plan": "premium",
    "account_age_days": 847
  },
  "cart": {
    "item_count": 3,
    "total_cents": 15999
  },
  "payment": {
    "provider": "stripe",
    "latency_ms": 1089,
    "attempt": 3
  },
  "error": {
    "slug": "card-declined",
    "name": "PaymentError",
    "message": "Card declined by issuer",
    "retriable": false
  },
  "duration_ms": 1247,
  "outcome": "error",
  "status_code": 500
}
```

This is not a log line. This is a queryable record of a business event. You can ask: "Show me all checkout failures for premium users this hour where the payment provider was Stripe, grouped by error slug." You cannot ask that question with `console.log("payment failed")`.

### Why this works

**High cardinality.** Fields like `user.id` or `request.id` have millions of unique values. This is what makes debugging possible — you can find the exact request, the exact user, the exact job. Low-cardinality fields like HTTP method (`GET`, `POST`) tell you almost nothing on their own.

**High dimensionality.** Fifty fields on a single event is not excessive — it is the point. Each field is a new axis you can slice your data on. When something breaks in a way you did not anticipate, the field that explains it is already there because you captured everything, not just what you thought would matter.

**Business context.** A technical error message means nothing without business context. "Connection refused" tells you a socket failed. "Connection refused during $14,999 enterprise checkout for a customer in their first 24 hours" tells you the business impact and where to look.

## How to build a wide event

The pattern is the same regardless of language, framework, or infrastructure:

1. When a unit of work begins — a request arrives, a job starts, a connection opens — initialize an empty structured event.
2. Populate it with everything you know at that point: HTTP method, path, user agent, request ID, service version, environment.
3. As the work progresses, enrich the event. After authentication, add the user ID, their plan, their account age. After a database query, add the query count and duration. After a business operation, add the domain-specific context.
4. When the work completes — whether it succeeded, failed, or was cancelled — set the outcome, the status code, and the total duration.
5. Emit the event. Once. In a `finally` block so it always fires, even during exceptions.

This is not a new idea. Stripe describes the exact same pattern in their canonical log lines post. Jeremy Morrell describes it in his practitioner's guide. Charity Majors describes it at Honeycomb. The implementation details vary. The philosophy does not.

### The boundary pattern

Every unit of work needs a boundary — the outer shell that creates the event context, catches errors, measures duration, and ensures the event is emitted. This boundary is the most important piece of your logging infrastructure.

A boundary does four things:

1. Creates the event context (so all code running inside it can add fields)
2. Wraps the work in a try/catch/finally
3. On success: records the outcome and status
4. On failure: records the error with full context
5. In finally: records duration and emits the event

If you get the boundary right, every piece of code running inside it can focus on adding context without worrying about when or how the event gets emitted. The boundary guarantees emission.

### What belongs inside a wide event

**Always present, on every event:**

- `operation.name` — what this unit of work is. `"GET /api/users"`, `"ingest-sources"`, `"job:process"`. This is the primary grouping key.
- `operation.type` — the category. `"http"`, `"job"`, `"lifecycle"`, `"webhook"`, `"connection"`. This lets you filter to a class of operations.
- `request.id` — a unique identifier for this unit of work. UUID. Propagated across service boundaries so you can trace a request through your system.
- `correlation.id` — when one unit of work spawns another (a cron job enqueues a worker job, an API request triggers a background task), the producer sets a correlation ID that the consumer carries. This links events across services without requiring distributed tracing infrastructure.
- `outcome` — `"success"`, `"error"`, or `"partial"`. Success means the unit of work completed without issues. Error means it failed entirely. Partial means the operation completed but with degraded results — some items succeeded and some failed. A calendar sync that pushes 597 events but fails on 52 is partial, not error. This three-value field lets you distinguish "everything is fine," "everything is broken," and "something is wrong but the system is functioning."
- `status_code` — HTTP status code or equivalent. 200 for success, 500 for errors. Even non-HTTP operations benefit from this convention.
- `duration_ms` — how long the work took. Measured by the boundary, not estimated.
- Service identity: `service`, `version`, `commit_hash`, `environment`, `instance_id`.

**When a user is involved:**

- `user.id` — the user who triggered or is affected by this work.
- `user.plan` — their subscription tier. Free users and premium users have different expectations and different business impact.
- `user.account_age_days` — how long they have been a customer. A failure for a day-one user is an onboarding bug. A failure for a 3-year customer is a retention risk.

User context must be present on every event where the user is known, regardless of how the user was identified. Whether the user authenticated via session cookie, API token, MCP token, or was resolved from a job payload — the same `user.id`, `user.plan`, and `user.account_age_days` fields appear. The authentication method determines `auth.method`, but the user context is independent of it.

This extends to background work. When an API request spawns a background task for a user, or when a cron job processes a source belonging to a user, or when a worker job syncs a user's calendars — the user context must be on the event. The user is always known in these cases. If a unit of work affects a user and the event does not carry `user.id`, that is a gap.

**When authentication fails:**

Even failed auth attempts carry valuable context. If a token or session identifies a user but is expired or invalid, the claimed user identity should still appear on the event alongside the auth failure. This lets you answer "is one user's expired token generating thousands of 401s?" without the user being invisible because their auth failed. Use `auth.claimed_user_id` for the identity extracted from an invalid credential, and `auth.session_age_ms` or `auth.token_age_ms` for how old the credential is. This is the difference between "401 spike" and "user X's token expired 3 hours ago and their MCP client is retrying every 10 seconds."

**When something fails:**

- `error.slug` — a static, grep-able identifier. `"token-refresh-failed"`, `"calendar-not-found"`, `"rate-limit-exceeded"`. This is what you build alerts on. Not the error message, which is dynamic and different every time. The slug is defined at the throw site and never changes. Every `errorFields()` call must include a slug. If you cannot classify an error, use `"unclassified"` — but that is a signal to add a proper slug, not a permanent state.
- `error.name` — the error class name. `"EventsFetchError"`, `"GoogleOAuthRefreshError"`.
- `error.message` — the human-readable description.
- `error.retriable` — whether the operation can be retried. This tells you whether to page someone or wait for the next cycle.
- `error.requires_reauth` — whether the error requires the user to reconnect their account. This distinguishes "wait for retry" from "user action needed" and enables separate alerting for reauthentication issues.

**Rollup statistics:**

Rather than requiring someone to reconstruct a trace to understand why a request was slow, include rollup stats directly on the event:

- `stats.database_query_count` — how many database queries this request made
- `stats.database_query_duration_ms` — total time spent in the database
- `stats.redis_call_count` — how many Redis commands were issued
- `stats.api_call_count` — how many external API calls were made
- `stats.api_call_duration_ms` — total time spent in external APIs

These fields make slow request investigation trivial. "Show me all requests where `stats.database_query_count > 50`" finds N+1 query bugs instantly.

## What not to do

### Do not scatter log lines

```typescript
// Wrong
logger.info("Starting checkout");
logger.info("User authenticated", { userId });
logger.info("Cart loaded", { itemCount: 3 });
logger.info("Payment processing");
logger.error("Payment failed", { error });
logger.info("Checkout complete");
```

This produces six lines of output for one operation. Each line has partial context. None of them tell the full story. To understand what happened, you have to find all six, mentally reassemble them in order, and hope none are missing.

The wide event version captures the same information in one emission with complete context.

### Do not swallow errors

```typescript
// Wrong
const body = await response.json().catch(() => null);
```

This silently discards the error. If the JSON parsing fails, you will never know. The error vanishes. When debugging, you will see that `body` is null but have no idea why.

Every catch block must log before discarding. If you are intentionally ignoring an error, you should still record that you did so and why.

Fire-and-forget patterns — where a background operation is spawned and the caller does not await the result — must be designed so the boundary never rejects. The boundary catches all errors internally and records them via `errorFields()`. There is no outer `.catch(() => undefined)` because there is nothing to catch — the boundary guarantees it will not reject. If the boundary can reject, that is a bug in the boundary, not a case for silent suppression.

### Do not pre-aggregate

Aggregation is a one-way trip. Once you reduce raw events into counts and averages, you can never ask a question the aggregation did not anticipate. Store raw wide events. Derive metrics from them afterward. Columnar databases like ClickHouse are designed for exactly this — high-cardinality, high-dimensionality data queried on arbitrary fields.

### Do not log what your code is doing

Nobody investigating an incident cares that your code "entered the payment processing phase" or "started iterating over cart items." They care about what happened to the request. The wide event captures the result, not the journey.

### Do not use dynamic strings as identifiers

```typescript
// Wrong — every error has a unique message, ungroupable
widelog.set("error.message", `Failed to fetch events: ${response.status}: ${responseText}`);

// Right — static slug for grouping, message for details
widelog.set("error.slug", "events-fetch-failed");
widelog.set("error.message", `Failed to fetch events: ${response.status}: ${responseText}`);
```

The slug is what you build alerts and dashboards on. The message is what you read when investigating a specific instance.

## Consistency

Consistency is not a nice-to-have. It is the difference between an observability system that works and one that produces noise.

If one service logs the user's plan as `subscription.plan` and another logs it as `user.plan` and a third does not log it at all, you cannot build a dashboard that shows error rates by plan across your system. You cannot ask "are premium users experiencing more failures than free users?" because the data is not comparable.

### Field naming rules

1. Use dot notation for hierarchy: `user.id`, `error.slug`, `http.method`.
2. Use snake_case for multi-word segments: `account_age_days`, `duration_ms`.
3. The same concept must use the same field path in every service. `user.id` is `user.id` everywhere — in the API, in the cron service, in the worker, in the MCP server.
4. Document the schema. When someone adds a new field, they should know what fields already exist and how they are named.

### Outcome and status conventions

Every event ends with `outcome` and `status_code`. The outcome is `"success"`, `"error"`, or `"partial"`. The status code is a number — HTTP status codes for HTTP operations, 200/500 for non-HTTP operations. This convention lets you build a single dashboard that shows error rates across all services and operation types.

### Error field conventions

Every error includes at minimum `error.slug`, `error.name`, and `error.message`. The slug is static. The name is the error class. The message is the human-readable detail. If an error is retriable, set `error.retriable` to true. If an error requires user action (like reauthentication), set `error.requires_reauth` to true.

This consistency means you can build one alert rule — "fire when `error.slug` = `token-refresh-failed` for more than 5 users in 10 minutes" — and it works regardless of which service the error originates from.

## Sampling

Not every event needs to be stored forever. But the decision about which events to keep must be made after the event completes, not before. This is called tail sampling.

### Rules

1. **Keep 100% of errors.** Every request with `outcome: "error"` is kept. These are the events you will investigate.
2. **Keep 100% of slow requests.** Anything above your p99 latency threshold. These are the requests that degrade user experience.
3. **Keep 100% of specific users.** Enterprise accounts, VIP customers, internal test accounts. These are the users whose experience you care most about.
4. **Sample the rest.** Happy, fast requests can be sampled at 1-5%. Include a `sample_rate` field so aggregations can be weighted correctly.

The goal is to keep signal and reduce noise. A healthy 200 OK that took 12ms is not interesting. A 500 error for a premium customer during checkout is always interesting.

## The payoff

When wide events are implemented correctly, debugging transforms from archaeology into analytics.

Instead of: "The user said sync failed. Let me SSH into the server, grep the logs for their user ID, hope I find something, cross-reference with the other service's logs, try to reconstruct the timeline..."

You get: "Show me all sync failures for this user in the last hour. Group by error slug. Show me the one that took 130 seconds. What was the `stats.api_call_count`? 47 — there is an N+1 API call bug in the calendar listing."

That investigation takes 30 seconds with wide events. It takes 30 minutes with traditional logs. Multiply that by every incident, every on-call rotation, every debugging session, and the compounding value becomes obvious.

## References

- [Logging Sucks — Your Logs Are Lying To You](https://loggingsucks.com)
- [Stripe — Canonical Log Lines](https://stripe.com/blog/canonical-log-lines)
- [A Practitioner's Guide to Wide Events — Jeremy Morrell](https://jeremymorrell.dev/blog/a-practitioners-guide-to-wide-events/)
- [Live Your Best Life With Structured Events — Charity Majors](https://charity.wtf/2022/08/15/live-your-best-life-with-structured-events/)
- [All You Need is Wide Events — Ivan Burmistrov](https://isburmistrov.substack.com/p/all-you-need-is-wide-events-not-metrics)
- [Observability Wide Events 101 — Boris Tane](https://boristane.com/blog/observability-wide-events-101/)
- [Structured Events Are the Basis of Observability — Honeycomb](https://www.honeycomb.io/blog/structured-events-basis-observability)
- [Logging Best Practices: An Engineer's Checklist — Honeycomb](https://www.honeycomb.io/blog/engineers-checklist-logging-best-practices)
