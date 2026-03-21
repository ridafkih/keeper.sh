import { describe, expect, test } from "bun:test";
import { ErrorPolicy, SourceIngestionLifecycleEventType } from "@keeper.sh/state-machines";
import {
  runSourceIngestionUnit,
  type SourceIngestionFailureDecision,
  type SourceIngestionLogger,
  type SourceIngestionResult,
  type SourceIngestionRuntime,
} from "./source-ingestion-runner";
import { SourceIngestionFailureLogSlug } from "./source-ingestion-failure";

const createLogger = () => {
  const fields = new Map<string, unknown>();
  let flushCount = 0;
  const errorFieldCalls: { error: unknown; fields: Record<string, unknown> }[] = [];
  const logger: SourceIngestionLogger = {
    errorFields: (error, errorFields) => {
      errorFieldCalls.push({ error, fields: errorFields });
    },
    flush: () => {
      flushCount += 1;
    },
    measureDuration: <TResult>(operation: () => Promise<TResult>) => operation(),
    set: (field, value) => {
      fields.set(field, value);
    },
  };
  return { logger, fields, errorFieldCalls, getFlushCount: () => flushCount };
};

const createRuntime = () => {
  const events: unknown[] = [];
  const runtime: SourceIngestionRuntime = {
    dispatch: (event) => {
      events.push(event);
      if (event.type === SourceIngestionLifecycleEventType.TRANSIENT_FAILURE) {
        return Promise.resolve({
          commands: [],
          context: {
            eventsAdded: 0,
            eventsRemoved: 0,
            lastErrorCode: event.code,
            provider: "google",
            sourceId: "source-1",
          },
          outputs: [{ code: event.code, retryable: true, type: "INGEST_FAILED" }],
          state: "transient_error",
        });
      }
      if (event.type === SourceIngestionLifecycleEventType.AUTH_FAILURE) {
        return Promise.resolve({
          commands: [],
          context: {
            eventsAdded: 0,
            eventsRemoved: 0,
            lastErrorCode: event.code,
            provider: "google",
            sourceId: "source-1",
          },
          outputs: [{ code: event.code, retryable: false, type: "INGEST_FAILED" }],
          state: "auth_blocked",
        });
      }
      if (event.type === SourceIngestionLifecycleEventType.NOT_FOUND) {
        return Promise.resolve({
          commands: [],
          context: {
            eventsAdded: 0,
            eventsRemoved: 0,
            lastErrorCode: event.code,
            provider: "google",
            sourceId: "source-1",
          },
          outputs: [{ code: event.code, retryable: false, type: "INGEST_FAILED" }],
          state: "not_found_disabled",
        });
      }
      return Promise.resolve({ commands: [], outputs: [], state: "source_selected", context: {} });
    },
  };
  return { runtime, events };
};

const successfulResult: SourceIngestionResult = {
  eventsAdded: 2,
  eventsRemoved: 1,
  ingestEvents: [{ "source.provider": "google" }],
};

describe("runSourceIngestionUnit", () => {
  test("executes success path and dispatches lifecycle events", async () => {
    const { logger, fields, getFlushCount } = createLogger();
    const { runtime, events } = createRuntime();

    const result = await runSourceIngestionUnit({
      executeIngest: () => Promise.resolve(successfulResult),
      logger,
      metadata: {
        accountId: "account-1",
        calendarId: "calendar-1",
        externalCalendarId: "external-1",
        provider: "google",
        userId: "user-1",
      },
      runtime,
      classifyFailure: (): SourceIngestionFailureDecision => ({
        code: "transient_failure",
        eventType: SourceIngestionLifecycleEventType.TRANSIENT_FAILURE,
        logSlug: SourceIngestionFailureLogSlug.TRANSIENT,
      }),
    });

    expect(result).toEqual(successfulResult);
    expect(events).toEqual([
      { type: SourceIngestionLifecycleEventType.SOURCE_SELECTED },
      { type: SourceIngestionLifecycleEventType.FETCHER_RESOLVED },
      { type: SourceIngestionLifecycleEventType.FETCH_SUCCEEDED },
      {
        eventsAdded: 2,
        eventsRemoved: 1,
        nextSyncToken: globalThis.undefined,
        type: SourceIngestionLifecycleEventType.INGEST_SUCCEEDED,
      },
    ]);
    expect(fields.get("operation.name")).toBe("ingest-source");
    expect(fields.get("provider.name")).toBe("google");
    expect(fields.get("provider.account_id")).toBe("account-1");
    expect(fields.get("provider.calendar_id")).toBe("calendar-1");
    expect(fields.get("calendar_sync.id")).toBe("google:calendar-1");
    expect(fields.get("provider.external_calendar_id")).toBe("external-1");
    expect(fields.get("sync.events_added")).toBe(2);
    expect(fields.get("sync.events_removed")).toBe(1);
    expect(fields.get("outcome")).toBe("success");
    expect(getFlushCount()).toBe(1);
  });

  test("throws retriable failures after dispatching lifecycle failure", async () => {
    const { logger, errorFieldCalls, fields, getFlushCount } = createLogger();
    const { runtime, events } = createRuntime();
    const expectedError = new Error("transient provider failure");

    await expect(runSourceIngestionUnit({
      executeIngest: () => Promise.reject(expectedError),
      logger,
      metadata: {
        calendarId: "calendar-1",
        provider: "google",
        userId: "user-1",
      },
      runtime,
      classifyFailure: (): SourceIngestionFailureDecision => ({
        code: "transient_failure",
        eventType: SourceIngestionLifecycleEventType.TRANSIENT_FAILURE,
        logSlug: SourceIngestionFailureLogSlug.TRANSIENT,
      }),
    })).rejects.toBe(expectedError);

    expect(events).toEqual([
      { type: SourceIngestionLifecycleEventType.SOURCE_SELECTED },
      { type: SourceIngestionLifecycleEventType.FETCHER_RESOLVED },
      { code: "transient_failure", type: SourceIngestionLifecycleEventType.TRANSIENT_FAILURE },
    ]);
    expect(fields.get("outcome")).toBe("error");
    expect(errorFieldCalls).toHaveLength(1);
    expect(errorFieldCalls[0]?.fields).toEqual({
      policy: ErrorPolicy.RETRYABLE,
      slug: "provider-api-error",
      retriable: true,
      requiresReauth: false,
    });
    expect(getFlushCount()).toBe(1);
  });

  test("swallows non-retriable failures and returns empty ingestion result", async () => {
    const { logger, fields, getFlushCount } = createLogger();
    const { runtime, events } = createRuntime();

    const result = await runSourceIngestionUnit({
      executeIngest: () => Promise.reject(new Error("calendar missing")),
      logger,
      metadata: {
        calendarId: "calendar-1",
        provider: "ical",
        userId: "user-1",
      },
      runtime,
      classifyFailure: (): SourceIngestionFailureDecision => ({
        code: "not_found",
        eventType: SourceIngestionLifecycleEventType.NOT_FOUND,
        logSlug: SourceIngestionFailureLogSlug.NOT_FOUND,
      }),
    });

    expect(result).toEqual({
      eventsAdded: 0,
      eventsRemoved: 0,
      ingestEvents: [],
    });
    expect(events).toEqual([
      { type: SourceIngestionLifecycleEventType.SOURCE_SELECTED },
      { type: SourceIngestionLifecycleEventType.FETCHER_RESOLVED },
      { code: "not_found", type: SourceIngestionLifecycleEventType.NOT_FOUND },
    ]);
    expect(fields.get("outcome")).toBe("error");
    expect(getFlushCount()).toBe(1);
  });

  test("uses machine failure outputs as source of truth for retryability", async () => {
    const { logger } = createLogger();
    const expectedError = new Error("provider timed out");
    const runtime: SourceIngestionRuntime = {
      dispatch: (event) => {
        if (event.type === SourceIngestionLifecycleEventType.TRANSIENT_FAILURE) {
          return Promise.resolve({
            commands: [],
            context: {},
            outputs: [{ code: "not_found", retryable: false, type: "INGEST_FAILED" }],
            state: "not_found_disabled",
          });
        }
        return Promise.resolve({ commands: [], outputs: [], state: "source_selected", context: {} });
      },
    };

    const result = await runSourceIngestionUnit({
      executeIngest: () => Promise.reject(expectedError),
      logger,
      metadata: {
        calendarId: "calendar-machine-policy",
        provider: "google",
        userId: "user-1",
      },
      runtime,
      classifyFailure: (): SourceIngestionFailureDecision => ({
        code: "transient_failure",
        eventType: SourceIngestionLifecycleEventType.TRANSIENT_FAILURE,
        logSlug: SourceIngestionFailureLogSlug.TRANSIENT,
      }),
    });

    expect(result).toEqual({
      eventsAdded: 0,
      eventsRemoved: 0,
      ingestEvents: [],
    });
  });
});
