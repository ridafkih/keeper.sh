# Wide Logging Implementation Plan

This document specifies every wide event the system will emit. Each entry defines the exact file, the boundary function, the fields, and a concrete example of the emitted JSON. This document is the basis for test-driven implementation — every entry becomes a test before it becomes code.

`docs/LOGGING.md` defines the philosophy. `docs/CATALOG.md` defines the schema and rationale. This document defines the implementation.

---

## Shared patterns

These patterns are used identically across all services. They are defined once here and referenced by each event entry.

### Library initialization

Every service initializes widelogger identically. The only difference is the `service` name.

```typescript
import { widelogger, widelog } from "widelogger";

const { context, destroy } = widelogger({
  service: "keeper-api",
  defaultEventName: "wide_event",
  commitHash: process.env.COMMIT_SHA,
  environment: process.env.ENV ?? "production",
  version: process.env.npm_package_version,
});
```

Services: `keeper-api`, `keeper-cron`, `keeper-worker`, `keeper-mcp`, `keeper-web`.

### Outcome mapping

Outcome is never computed inline with a ternary. A shared function maps HTTP status to outcome:

```typescript
const resolveOutcome = (statusCode: number): "success" | "error" => {
  if (statusCode >= 400) {
    return "error";
  }
  return "success";
};
```

For sync operations with partial failures, the processor sets outcome explicitly:

```typescript
const resolveSyncOutcome = (failed: number, total: number): "success" | "partial" | "error" => {
  if (total === 0) {
    return "success";
  }
  if (failed === total) {
    return "error";
  }
  if (failed > 0) {
    return "partial";
  }
  return "success";
};
```

### Error classification

Every `errorFields()` call includes a `slug`. If the error cannot be classified into a specific slug, use `"unclassified"`. The presence of `"unclassified"` in production logs is a signal that a new slug needs to be defined.

```typescript
// Always include a slug
widelog.errorFields(error, { slug: "provider-api-error", retriable: true });

// Never call errorFields without a slug
// Wrong:
widelog.errorFields(error);
// Right:
widelog.errorFields(error, { slug: "unclassified" });
```

### User context enrichment

User context enrichment is a shared function called from every auth path. The same function is used regardless of whether the user authenticated via session, API token, or MCP token.

```typescript
const enrichWithUserContext = async (userId: string): Promise<UserContext> => {
  widelog.set("user.id", userId);

  const [plan, accountAgeDays] = await Promise.all([
    fetchUserPlan(userId),
    fetchAccountAgeDays(userId),
  ]);

  if (plan) {
    widelog.set("user.plan", plan);
  }
  if (accountAgeDays !== null) {
    widelog.set("user.account_age_days", accountAgeDays);
  }

  return { plan };
};
```

For background jobs and worker processes where the user is known from the job payload (not from auth), user context is set directly:

```typescript
widelog.set("user.id", userId);
widelog.set("user.plan", plan);
```

The key rule: if the user is known, `user.id` must be on the event. No exceptions.

### Correlation ID propagation

When one unit of work spawns another, the producer generates a `correlation.id` and passes it through the job payload or task arguments. The consumer reads it and sets it on its events.

```typescript
// Producer (cron enqueuing worker jobs):
const correlationId = crypto.randomUUID();
widelog.set("correlation.id", correlationId);
queue.addBulk(users.map((userId) => ({
  name: `sync-${userId}`,
  data: { userId, plan, correlationId },
})));

// Consumer (worker processing the job):
widelog.set("correlation.id", job.data.correlationId).sticky();
```

### Error parser registration

For operations that process many items where individual items can fail (push sync, batch operations), register an error parser with `widelog.errors()` at the start of the context. The parser classifies raw errors into slugs. Item-level failures are recorded with `widelog.error(key, error)` and aggregated automatically during flush.

For operations where the entire unit of work fails (ingest source, HTTP request), use `widelog.errorFields()` directly with an explicit slug. The error parser is for item-level aggregation, `errorFields` is for top-level failure.

### Boundary template

Every boundary follows the same structure. Duration is measured by the library via `widelog.time.measure()`, not manually with `performance.now()`:

```typescript
context(async () => {
  widelog.set("operation.name", operationName);
  widelog.set("operation.type", operationType);
  widelog.set("request.id", crypto.randomUUID());

  try {
    return await widelog.time.measure("duration_ms", async () => {
      // ... do work ...
      widelog.set("status_code", statusCode);
      widelog.set("outcome", resolveOutcome(statusCode));
      return result;
    });
  } catch (error) {
    widelog.set("status_code", 500);
    widelog.set("outcome", "error");
    widelog.errorFields(error, { slug: "...", retriable: ... });
    throw error;
  } finally {
    widelog.flush();
  }
});
```

`widelog.time.measure()` handles timing automatically — even when the callback throws, the duration is recorded correctly because the library uses its own try/finally internally.

The `sticky()` modifier is only used when a context will flush multiple events (batch jobs, per-source/per-calendar loops). Single-flush boundaries never use `sticky()`.

---

## keeper-api

### 1. HTTP request event

**File:** `services/api/src/utils/middleware.ts`
**Boundary:** `withWideEvent`

```typescript
const withWideEvent =
  (handler: RouteCallback): RouteHandler =>
  (request, params) =>
    context(async () => {
      const url = new URL(request.url);
      const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();

      widelog.set("operation.name", `${request.method} ${url.pathname}`);
      widelog.set("operation.type", "http");
      widelog.set("request.id", requestId);
      widelog.set("http.method", request.method);
      widelog.set("http.path", url.pathname);

      const userAgent = request.headers.get("user-agent");
      if (userAgent) {
        widelog.set("http.user_agent", userAgent);
      }

      try {
        return await widelog.time.measure("duration_ms", async () => {
          const response = await handler({ params, request });
          widelog.set("status_code", response.status);
          widelog.set("outcome", resolveOutcome(response.status));
          return response;
        });
      } catch (error) {
        widelog.set("status_code", 500);
        widelog.set("outcome", "error");
        widelog.errorFields(error, { slug: "unclassified" });
        throw error;
      } finally {
        widelog.flush();
      }
    });
```

### 2. Session-based auth (withAuth)

**File:** `services/api/src/utils/middleware.ts`
**Not a separate event** — enriches the HTTP request event from #1.

```typescript
const withAuth =
  (handler: AuthenticatedRouteCallback): RouteCallback =>
  async ({ request, params }) => {
    const session = await widelog.time.measure("auth.duration_ms", () => getSession(request));
    widelog.set("auth.method", "session");

    if (!session?.user?.id) {
      return ErrorResponse.unauthorized().toResponse();
    }

    if (session.createdAt) {
      widelog.set("auth.session_age_ms", Date.now() - session.createdAt.getTime());
    }

    await enrichWithUserContext(session.user.id);
    return handler({ params, request, userId: session.user.id });
  };
```

### 3. Token-based auth (withV1Auth)

**File:** `services/api/src/utils/middleware.ts`
**Not a separate event** — enriches the HTTP request event from #1.

Three auth paths, all using `widelog.time.measure` for auth duration and all calling `enrichWithUserContext`:

```typescript
// API token path:
const userId = await widelog.time.measure("auth.duration_ms", () =>
  resolveApiTokenUserId(bearerToken),
);
widelog.set("auth.method", "api_token");
if (tokenRecord.createdAt) {
  widelog.set("auth.token_age_ms", Date.now() - tokenRecord.createdAt.getTime());
}
await enrichWithUserContext(userId);

// MCP token path:
const mcpSession = await widelog.time.measure("auth.duration_ms", () =>
  mcpAuth.api.getMcpSession({ headers: request.headers }),
);
widelog.set("auth.method", "mcp_token");
await enrichWithUserContext(mcpSession.userId);

// Session fallback path:
const session = await widelog.time.measure("auth.duration_ms", () => getSession(request));
widelog.set("auth.method", "session");
await enrichWithUserContext(session.user.id);
```

On auth failure where a user identity can be extracted from the invalid credential:

```typescript
if (expiredTokenUserId) {
  widelog.set("auth.claimed_user_id", expiredTokenUserId);
}
```

### 4. Rate limit enrichment

**File:** `services/api/src/utils/middleware.ts`
**Not a separate event** — enriches the HTTP request event from #1.

```typescript
widelog.set("rate_limit.remaining", rateLimitResult.remaining);
widelog.set("rate_limit.limit", rateLimitResult.limit);
if (!rateLimitResult.allowed) {
  widelog.set("rate_limit.exceeded", true);
}
```

### 5. Auth request event

**File:** `services/api/src/handlers/auth.ts`
**Boundary:** `handleAuthRequest`

Uses the boundary template with `operation.type: "auth"`. Includes HTTP context. On failure, uses slug `"auth-request-failed"`.

### 6. WebSocket connection events

**File:** `services/api/src/handlers/websocket.ts`
**Boundary:** `runWebsocketBoundary`

Uses the boundary template with `operation.type: "connection"` and `operation.name: "websocket:open"` or `"websocket:close"`. Always sets `user.id` from `socket.data.userId`. On failure, uses slug `"unclassified"`.

### 7. Background task events

**File:** `services/api/src/utils/background-task.ts`
**Boundary:** `spawnBackgroundJob`

Uses the boundary template with `operation.type: "background-job"`. Sets `correlation.id` from the spawning request context. The boundary catches all errors internally and never rejects — there is no outer error suppression.

The boundary catches all errors internally so it never rejects. There is no outer `.catch()` — if the boundary itself can reject, that is a bug in the boundary.

```typescript
const spawnBackgroundJob = <TResult>(
  jobName: string,
  fields: Record<string, unknown>,
  callback: BackgroundJobCallback<TResult>,
): void => {
  context(async () => {
    widelog.set("operation.name", jobName);
    widelog.set("operation.type", "background-job");
    widelog.set("request.id", crypto.randomUUID());
    widelog.setFields(fields);

    try {
      await widelog.time.measure("duration_ms", callback);
      widelog.set("status_code", 200);
      widelog.set("outcome", "success");
    } catch (error) {
      widelog.set("status_code", 500);
      widelog.set("outcome", "error");
      widelog.errorFields(error, { slug: "unclassified" });
    } finally {
      widelog.flush();
    }
  });
};
```

### 8. Webhook enrichment (Polar)

**File:** `services/api/src/routes/api/webhook/polar.ts`
**Not a separate boundary** — enriches the HTTP request event from #1 by overriding `operation.type` to `"webhook"`.

```typescript
widelog.set("operation.type", "webhook");
widelog.set("webhook.event_type", event.type);
widelog.set("webhook.subscription_id", event.data.id);
if (resultingPlan) {
  widelog.set("webhook.resulting_plan", resultingPlan);
}
```

### 9. API lifecycle event

**File:** `services/api/src/index.ts`

Uses the boundary template with `operation.type: "lifecycle"` and `operation.name: "api:start"`. No try/catch needed — if startup fails, the process exits.

---

## keeper-cron

### 10. Cron lifecycle event

**File:** `services/cron/src/index.ts`

Same as API lifecycle event #9 with `operation.name: "cron:start"`.

### 11. Cron job boundary

**File:** `services/cron/src/utils/with-wide-event.ts`

Uses the boundary template. For jobs that emit per-item events (ingest-sources), this boundary emits a lightweight envelope event. The per-item events are emitted inside the callback.

### 12. Ingest source events (one per source)

**File:** `services/cron/src/jobs/ingest-sources.ts`
**Pattern:** Each source gets its own `context()` and `flush()`.

The error classification for ingest uses a shared parser function that maps provider errors to slugs with their retriable and reauth flags. This function is defined once and reused across OAuth, CalDAV, and iCal ingestion:

```typescript
const classifyIngestError = (error: unknown): { slug: string; retriable: boolean; requiresReauth: boolean } => {
  if (isNotFoundError(error)) {
    return { slug: "provider-calendar-not-found", retriable: false, requiresReauth: false };
  }
  if (isAuthError(error)) {
    return { slug: "provider-auth-failed", retriable: false, requiresReauth: true };
  }
  if (isOAuthRefreshError(error)) {
    return { slug: "provider-token-refresh-failed", retriable: false, requiresReauth: true };
  }
  if (isScopeError(error)) {
    return { slug: "provider-scope-insufficient", retriable: false, requiresReauth: true };
  }
  if (isTimeoutError(error)) {
    return { slug: "provider-api-timeout", retriable: true, requiresReauth: false };
  }
  return { slug: "provider-api-error", retriable: true, requiresReauth: false };
};
```

Per-source processing (OAuth, CalDAV, and iCal all use the same pattern):

```typescript
await context(async () => {
  widelog.set("operation.name", "ingest-source");
  widelog.set("operation.type", "job");
  widelog.set("sync.direction", "ingest");
  widelog.set("request.id", crypto.randomUUID());
  widelog.set("user.id", source.userId);
  widelog.set("provider.name", source.provider);
  widelog.set("provider.account_id", source.accountId);
  widelog.set("provider.calendar_id", source.calendarId);
  widelog.set("provider.external_calendar_id", source.externalCalendarId);

  try {
    await widelog.time.measure("duration_ms", async () => {
      const result = await ingestSource(/* ... */);
      widelog.set("sync.events_added", result.eventsAdded);
      widelog.set("sync.events_removed", result.eventsRemoved);
      widelog.set("status_code", 200);
      widelog.set("outcome", "success");
    });
  } catch (error) {
    widelog.set("status_code", 500);
    widelog.set("outcome", "error");
    const classified = classifyIngestError(error);
    widelog.errorFields(error, classified);
  } finally {
    widelog.flush();
  }
});
```

### 13. Push destinations enqueue event

**File:** `services/cron/src/jobs/push-destinations.ts`
**Boundary:** `withCronWideEvent` from #11

```typescript
const correlationId = crypto.randomUUID();
widelog.set("correlation.id", correlationId);
widelog.set("batch.plan", plan);
widelog.set("batch.user_count", usersWithDestinations.length);
widelog.set("batch.jobs_enqueued", usersWithDestinations.length);

await queue.addBulk(
  usersWithDestinations.map((userId) => ({
    name: `sync-${userId}`,
    data: { userId, plan, correlationId },
  })),
);
```

### 14. Reconcile subscriptions event

**File:** `services/cron/src/jobs/reconcile-subscriptions.ts`
**Boundary:** `withCronWideEvent` from #11

```typescript
widelog.set("batch.processed_count", userIds.length);
widelog.set("batch.failed_count", failedCount);
```

---

## keeper-worker

### 15. Worker lifecycle event

**File:** `services/worker/src/index.ts`

Same as other lifecycle events with `operation.name: "worker:start"`. Additional fields:
```typescript
widelog.set("worker.concurrency", concurrency);
widelog.set("worker.queue", PUSH_SYNC_QUEUE_NAME);
```

### 16. Push sync calendar events (one per destination calendar)

**File:** `services/worker/src/processor.ts`
**Pattern:** sticky fields + error parser + flush per calendar

```typescript
const processJob = async (job, _token, signal) => {
  return context(async () => {
    widelog.set("operation.name", "push-sync").sticky();
    widelog.set("operation.type", "job").sticky();
    widelog.set("sync.direction", "push").sticky();
    widelog.set("user.id", job.data.userId).sticky();
    widelog.set("user.plan", job.data.plan).sticky();
    widelog.set("job.id", job.id).sticky();
    widelog.set("job.name", job.name).sticky();
    widelog.set("correlation.id", job.data.correlationId).sticky();

    widelog.errors((error) => {
      if (typeof error === "string") {
        if (error.includes("conflict")) return "sync-push-conflict";
        if (error.includes("timeout")) return "provider-api-timeout";
        return "sync-push-failed";
      }
      return "sync-push-failed";
    });

    // Per-calendar processing emits one event per calendar:
    // (onCalendarSyncComplete callback)
    widelog.set("provider.name", calendarResult.provider);
    widelog.set("provider.account_id", calendarResult.accountId);
    widelog.set("provider.calendar_id", calendarResult.calendarId);
    widelog.set("sync.events_added", calendarResult.added);
    widelog.set("sync.events_removed", calendarResult.removed);
    widelog.set("sync.events_failed", calendarResult.addFailed + calendarResult.removeFailed);

    for (const pushError of calendarResult.pushErrors) {
      widelog.error("sync.failures", pushError);
    }
    for (const deleteError of calendarResult.deleteErrors) {
      widelog.error("sync.failures", deleteError);
    }

    const totalFailed = calendarResult.addFailed + calendarResult.removeFailed;
    const totalAttempted = calendarResult.added + calendarResult.removed + totalFailed;
    widelog.set("status_code", 200);
    widelog.set("outcome", resolveSyncOutcome(totalFailed, totalAttempted));
    widelog.set("duration_ms", calendarResult.durationMs);
    widelog.flush();
  });
};
```

### 17. Job supersede event

**File:** `services/worker/src/index.ts`
**Emitted by:** `active` event handler

Uses the boundary template with `operation.type: "job"` and `operation.name: "job:supersede"`. Includes `job.id`, `job.superseded_id`, and `user.id`.

### 18. Job stalled event

**File:** `services/worker/src/index.ts`

Uses the boundary template with `operation.name: "job:stalled"`. Includes `job.id`. Sets `outcome: "error"` and `status_code: 500`.

### 19. Worker error event

**File:** `services/worker/src/index.ts`

Uses the boundary template with `operation.name: "worker:error"` and `operation.type: "lifecycle"`. The error slug is determined by inspecting the error, not hardcoded:

The error slug is determined by a classifier function, not hardcoded:

```typescript
const classifyWorkerError = (error: Error): string => {
  if (error.message.includes("timeout")) {
    return "redis-timeout";
  }
  return "unclassified";
};

worker.on("error", (error) => {
  context(() => {
    widelog.set("operation.name", "worker:error");
    widelog.set("operation.type", "lifecycle");
    widelog.set("request.id", crypto.randomUUID());
    widelog.set("outcome", "error");
    widelog.set("status_code", 500);
    widelog.errorFields(error, { slug: classifyWorkerError(error), retriable: true });
    widelog.flush();
  });
});
```

### 20. Lock renewal failed event

**File:** `services/worker/src/index.ts`

Uses the boundary template with `operation.name: "worker:lock_renewal_failed"` and `operation.type: "lifecycle"`. Includes `affected_job_count`.

---

## keeper-mcp

### 21. MCP lifecycle event

**File:** `services/mcp/src/index.ts`

Same as other lifecycle events with `operation.name: "mcp:start"`. Additional fields: `server.port`.

### 22. MCP HTTP request event (with tool context)

**File:** `services/mcp/src/utils/middleware.ts`
**Boundary:** `withWideEvent`

Same boundary pattern as API #1 but for single-argument handlers. Tool context is added by the MCP handler during tool execution:

```typescript
widelog.set("mcp.tool", toolName);
widelog.set("user.id", userId);
```

The auth flow sets `auth.method: "mcp_token"` and calls `enrichWithUserContext` where possible. On auth failure, `auth.claimed_user_id` is set if the token identifies a user.

---

## keeper-web

### 23. SSR request event

**File:** `applications/web/src/server/index.ts`

Same boundary pattern as API #1. No user context — the web server proxies to the API for authenticated work. Does not log successful health check / asset requests.

### 24. SSR lifecycle event

**File:** `applications/web/src/server/index.ts`

Same as other lifecycle events with `operation.name: "ssr:start"`. Additional fields: `server.port`, `server.environment`.

---

## Summary

| # | Event | Service | Boundary | Pattern | Events per execution |
|---|-------|---------|----------|---------|---------------------|
| 1 | HTTP request | keeper-api | `withWideEvent` | boundary template | 1 per request |
| 2 | Session auth | keeper-api | `withAuth` | enrichment | (enriches #1) |
| 3 | Token auth | keeper-api | `withV1Auth` | enrichment | (enriches #1) |
| 4 | Rate limit | keeper-api | `enforceApiRateLimit` | enrichment | (enriches #1) |
| 5 | Auth request | keeper-api | `handleAuthRequest` | boundary template | 1 per auth request |
| 6 | WebSocket | keeper-api | `runWebsocketBoundary` | boundary template | 1 per open/close |
| 7 | Background task | keeper-api | `spawnBackgroundJob` | boundary template (fire-and-forget) | 1 per task |
| 8 | Webhook | keeper-api | Polar POST handler | enrichment | (enriches #1) |
| 9 | API startup | keeper-api | `entry()` main | lifecycle | 1 |
| 10 | Cron startup | keeper-cron | `entry()` main | lifecycle | 1 |
| 11 | Cron job boundary | keeper-cron | `withCronWideEvent` | boundary template | 1 per job execution |
| 12 | Ingest source | keeper-cron | per-source context | boundary template | 1 per source per sweep |
| 13 | Push destinations | keeper-cron | `runEgressJob` | enrichment | (enriches #11) |
| 14 | Reconcile subs | keeper-cron | `runReconcileSubscriptionsJob` | enrichment | (enriches #11) |
| 15 | Worker startup | keeper-worker | `entry()` main | lifecycle | 1 |
| 16 | Push sync calendar | keeper-worker | `processJob` per calendar | sticky + flush | 1 per destination calendar |
| 17 | Job supersede | keeper-worker | `active` event handler | boundary template | 1 per supersede |
| 18 | Job stalled | keeper-worker | `stalled` event handler | boundary template | 1 per stall |
| 19 | Worker error | keeper-worker | `error` event handler | boundary template | 1 per worker error |
| 20 | Lock renewal failed | keeper-worker | `lockRenewalFailed` handler | boundary template | 1 per failure |
| 21 | MCP startup | keeper-mcp | `entry()` main | lifecycle | 1 |
| 22 | MCP HTTP request | keeper-mcp | `withWideEvent` + tool handler | boundary template + enrichment | 1 per request |
| 23 | SSR request | keeper-web | fetch handler | boundary template | 1 per request |
| 24 | SSR startup | keeper-web | `entry()` main | lifecycle | 1 |

24 event types across 5 services. Every boundary uses the same template. Every error has a slug. Every user-facing operation carries user context. Correlation IDs are explicitly propagated through job payloads.
