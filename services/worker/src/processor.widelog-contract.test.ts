import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import type { Job } from "bullmq";
import type { PushSyncJobPayload, PushSyncJobResult } from "@keeper.sh/queue";
import { RuntimeInvariantViolationError } from "@keeper.sh/machine-orchestration";

interface MockWideEvent {
  errors: string[];
  fields: Record<string, unknown>;
}

const flushedEvents: MockWideEvent[] = [];

interface ContextState {
  fields: Map<string, unknown>;
  stickyKeys: Set<string>;
}

const contextStack: ContextState[] = [];

const currentContext = (): ContextState => {
  const state = contextStack.at(-1);
  if (!state) {
    throw new Error("Mock widelog context missing");
  }
  return state;
};

const pushContext = (): void => {
  contextStack.push({ fields: new Map(), stickyKeys: new Set() });
};

const popContext = (): void => {
  contextStack.pop();
};

type ProcessJob = (
  job: Job<PushSyncJobPayload, PushSyncJobResult>,
  token: string | undefined,
  signal: AbortSignal | undefined,
) => Promise<PushSyncJobResult>;

let processJob: ProcessJob = (..._args) =>
  Promise.reject(new Error("processJob not loaded"));

beforeAll(async () => {
  mock.module("./utils/logging", () => ({
    context: <TResult>(callback: () => Promise<TResult> | TResult): Promise<TResult> => {
      pushContext();
      return Promise.resolve(callback()).finally(() => {
        popContext();
      });
    },
    destroy: () => Promise.resolve(),
    widelog: {
      error: (_field: string, value: string) => {
        const state = currentContext();
        const errors = (state.fields.get("__errors") as string[] | undefined) ?? [];
        errors.push(value);
        state.fields.set("__errors", errors);
      },
      errorFields: (_error: unknown) => globalThis.undefined,
      errors: () => globalThis.undefined,
      flush: () => {
        const state = currentContext();
        const fields = Object.fromEntries(
          [...state.fields.entries()]
            .filter(([key]) => key !== "__errors"),
        );
        flushedEvents.push({
          errors: [...(((state.fields.get("__errors") as string[] | undefined) ?? []))],
          fields,
        });

        const stickyEntries = [...state.stickyKeys.values()]
          .map((key) => [key, state.fields.get(key)] as const)
          .filter(([, value]) => value !== globalThis.undefined);

        state.fields = new Map(stickyEntries);
        state.fields.set("__errors", []);
      },
      set: (field: string, value: unknown) => {
        const state = currentContext();
        state.fields.set(field, value);
        return {
          sticky: () => {
            state.stickyKeys.add(field);
            return this;
          },
        };
      },
      time: {
        measure: <TResult>(
          _field: string,
          callback: () => Promise<TResult> | TResult,
        ): Promise<TResult> => Promise.resolve(callback()),
      },
    },
  }));

  mock.module("@keeper.sh/machine-orchestration", () => ({
    runKeeperSyncRuntimeForUser: async (
      _userId: string,
      _config: unknown,
      callbacks: {
        onCalendarComplete?: (completion: {
          provider: string;
          accountId: string;
          calendarId: string;
          userId: string;
          added: number;
          addFailed: number;
          removed: number;
          removeFailed: number;
          errors: string[];
          durationMs: number;
        }) => Promise<void> | void;
        onDestinationRuntimeEvent?: (calendarId: string, event: {
          aggregateId: string;
          outcome: "APPLIED" | "DUPLICATE_IGNORED" | "CONFLICT_DETECTED";
          envelope: { id: string; event: { type: string } };
          snapshot: { state: string };
          transition?: { commands: { type: string }[]; outputs: { type: string }[] };
          version: number;
        }) => Promise<void> | void;
      },
    ) => {
      await callbacks.onDestinationRuntimeEvent?.("cal-a", {
        aggregateId: "cal-a",
        outcome: "APPLIED",
        envelope: { id: "cal-a:1:LOCK_ACQUIRED", event: { type: "LOCK_ACQUIRED" } },
        snapshot: { state: "locked" },
        transition: {
          commands: [{ type: "RELEASE_LOCK" }],
          outputs: [{ type: "DESTINATION_EXECUTION_CHANGED" }],
        },
        version: 1,
      });
      await callbacks.onDestinationRuntimeEvent?.("cal-a", {
        aggregateId: "cal-a",
        outcome: "APPLIED",
        envelope: { id: "cal-a:2:EXECUTION_STARTED", event: { type: "EXECUTION_STARTED" } },
        snapshot: { state: "executing" },
        transition: {
          commands: [{ type: "EMIT_SYNC_EVENT" }],
          outputs: [{ type: "DESTINATION_EXECUTION_CHANGED" }],
        },
        version: 2,
      });
      await callbacks.onCalendarComplete?.({
        provider: "google",
        accountId: "acc-1",
        calendarId: "cal-a",
        userId: "user-1",
        added: 1,
        addFailed: 0,
        removed: 0,
        removeFailed: 0,
        errors: [],
        durationMs: 100,
      });

      await callbacks.onDestinationRuntimeEvent?.("cal-b", {
        aggregateId: "cal-b",
        outcome: "APPLIED",
        envelope: { id: "cal-b:1:LOCK_ACQUIRED", event: { type: "LOCK_ACQUIRED" } },
        snapshot: { state: "locked" },
        transition: {
          commands: [{ type: "RELEASE_LOCK" }],
          outputs: [{ type: "DESTINATION_EXECUTION_CHANGED" }],
        },
        version: 1,
      });
      await callbacks.onCalendarComplete?.({
        provider: "google",
        accountId: "acc-1",
        calendarId: "cal-b",
        userId: "user-1",
        added: 0,
        addFailed: 0,
        removed: 2,
        removeFailed: 0,
        errors: [],
        durationMs: 80,
      });

      return {
        added: 1,
        addFailed: 0,
        removed: 2,
        removeFailed: 0,
        errors: [],
      };
    },
  }));

  mock.module("@keeper.sh/broadcast", () => ({
    createBroadcastService: () => ({
      emit: () => Promise.resolve(),
    }),
  }));

  mock.module("./context", () => ({
    database: {
      insert: () => ({
        onConflictDoUpdate: () => Promise.resolve(),
        values: () => ({
          onConflictDoUpdate: () => Promise.resolve(),
        }),
      }),
    },
    refreshLockRedis: {
      get: () => Promise.resolve(null),
      publish: () => Promise.resolve(0),
      set: () => Promise.resolve("OK"),
    },
    refreshLockStore: {},
  }));

  mock.module("./env", () => ({
    default: {
      ENCRYPTION_KEY: "key",
      GOOGLE_CLIENT_ID: "google-client-id",
      GOOGLE_CLIENT_SECRET: "google-client-secret",
      MICROSOFT_CLIENT_ID: "microsoft-client-id",
      MICROSOFT_CLIENT_SECRET: "microsoft-client-secret",
    },
  }));

  ({ processJob } = await import("./processor"));
});

afterAll(() => {
  mock.restore();
});

beforeEach(() => {
  flushedEvents.length = 0;
});

describe("processJob widelog contract", () => {
  it("fails fast with typed invariant when job id is missing", async () => {
    await expect(
      processJob(
        {
          data: {
            correlationId: "corr-1",
            plan: "pro",
            userId: "user-1",
          },
          id: globalThis.undefined,
          name: "sync-user-1",
          updateProgress: () => Promise.resolve(),
        } as unknown as Job<PushSyncJobPayload, PushSyncJobResult>,
        globalThis.undefined,
        globalThis.undefined,
      ),
    ).rejects.toThrow(RuntimeInvariantViolationError);
    await expect(
      processJob(
        {
          data: {
            correlationId: "corr-1",
            plan: "pro",
            userId: "user-1",
          },
          id: globalThis.undefined,
          name: "sync-user-1",
          updateProgress: () => Promise.resolve(),
        } as unknown as Job<PushSyncJobPayload, PushSyncJobResult>,
        globalThis.undefined,
        globalThis.undefined,
      ),
    ).rejects.toMatchObject({
      aggregateId: "user-1",
      code: "WORKER_JOB_ID_REQUIRED",
      surface: "worker-processor",
    });
  });

  it("emits isolated calendar logs plus one job summary log", async () => {
    const result = await processJob(
      {
        data: {
          correlationId: "corr-1",
          plan: "pro",
          userId: "user-1",
        },
        id: "job-1",
        name: "sync-user-1",
        updateProgress: () => Promise.resolve(),
      } as unknown as Job<PushSyncJobPayload, PushSyncJobResult>,
      globalThis.undefined,
      globalThis.undefined,
    );

    expect(result.added).toBe(1);
    expect(result.removed).toBe(2);
    expect(flushedEvents.length).toBe(3);

    const calendarEvents = flushedEvents.filter(
      (event) => event.fields["operation.name"] === "push-sync-calendar",
    );
    expect(calendarEvents.length).toBe(2);

    const byCalendarId = new Map(
      calendarEvents.map((event) => [String(event.fields["provider.calendar_id"]), event]),
    );
    expect(byCalendarId.get("cal-a")?.fields["calendar_sync.id"]).toBe("job-1:cal-a");
    expect(byCalendarId.get("cal-b")?.fields["calendar_sync.id"]).toBe("job-1:cal-b");
    expect(byCalendarId.get("cal-a")?.fields["machine.destination_execution.processed_total"]).toBe(2);
    expect(byCalendarId.get("cal-b")?.fields["machine.destination_execution.processed_total"]).toBe(1);

    const summaryEvents = flushedEvents.filter(
      (event) => event.fields["operation.name"] === "push-sync",
    );
    expect(summaryEvents.length).toBe(1);
    const [summary] = summaryEvents;
    if (!summary) {
      throw new Error("Missing job summary wide event");
    }
    expect(summary.fields["sync.events_added"]).toBe(1);
    expect(summary.fields["sync.events_removed"]).toBe(2);
    expect(summary.fields["correlation.id"]).toBe("corr-1");
    expect(summary.fields["outcome"]).toBe("success");
    expect(summary.fields["calendar_sync.id"]).toBe(globalThis.undefined);
    expect(summary.fields["provider.calendar_id"]).toBe(globalThis.undefined);
    expect(summary.fields["machine.destination_execution.processed_total"]).toBe(
      globalThis.undefined,
    );
  });
});
