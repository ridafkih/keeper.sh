import { buildCalendarBackoffState } from "@keeper.sh/calendar";
import type { CalendarBackoffState } from "@keeper.sh/calendar";
import { describe, expect, it } from "vitest";
import { runSourceIngest } from "../../src/utils/run-source-ingest";
import type { SourceIngestAttempt, SourceIngestDependencies } from "../../src/utils/run-source-ingest";

const ABORT_AFTER_MS = 60_000;

interface CalendarRow {
  attempt: SourceIngestAttempt;
  backoffWrites: number;
  resetWrites: number;
}

interface Store {
  calendars: Map<string, CalendarRow>;
  flaggedAccounts: string[];
  recorded: CalendarBackoffState[];
  readAttemptFailsAfter: number;
  readAttempts: number;
}

const CLEAN: SourceIngestAttempt = { failureCount: 0, nextAttemptAt: null };

const isSameAttempt = (left: SourceIngestAttempt, right: SourceIngestAttempt): boolean =>
  left.failureCount === right.failureCount
  && (left.nextAttemptAt?.getTime() ?? null) === (right.nextAttemptAt?.getTime() ?? null);

const createStore = (rows: Record<string, SourceIngestAttempt>): Store => ({
  calendars: new Map(
    Object.entries(rows).map(([id, attempt]) => [
      id,
      { attempt, backoffWrites: 0, resetWrites: 0 },
    ]),
  ),
  flaggedAccounts: [],
  recorded: [],
  readAttemptFailsAfter: Number.POSITIVE_INFINITY,
  readAttempts: 0,
});

const rowOf = (store: Store, calendarId: string): CalendarRow => {
  const row = store.calendars.get(calendarId);
  if (!row) {
    throw new Error(`No calendar row for ${calendarId}`);
  }
  return row;
};

const createDependencies = (store: Store): SourceIngestDependencies => ({
  acquireLease: () => Promise.resolve({
    isCurrent: () => Promise.resolve(true),
    release: () => Promise.resolve(),
  }),
  applyBackoff: (calendarId, observedAttempt) => {
    const row = rowOf(store, calendarId);
    if (!isSameAttempt(row.attempt, observedAttempt)) {
      return Promise.resolve(null);
    }
    const state = buildCalendarBackoffState(observedAttempt.failureCount);
    row.attempt = { failureCount: state.failureCount, nextAttemptAt: state.nextAttemptAt };
    row.backoffWrites += 1;
    return Promise.resolve(state);
  },
  readAttempt: (calendarId) => {
    store.readAttempts += 1;
    if (store.readAttempts > store.readAttemptFailsAfter) {
      return Promise.reject(new Error("statement timeout reading calendars"));
    }
    return Promise.resolve(store.calendars.get(calendarId)?.attempt ?? null);
  },
  recordBackoff: (state) => {
    store.recorded.push(state);
  },
  resetBackoff: (calendarId) => {
    const row = rowOf(store, calendarId);
    row.attempt = CLEAN;
    row.resetWrites += 1;
    return Promise.resolve();
  },
});

const credentialError = (): Error =>
  Object.assign(new Error("Token refresh failed (400): invalid_grant"), {
    oauthReauthRequired: true,
  });

const reconnect = (store: Store, accountId: string, calendarIds: string[]): void => {
  store.flaggedAccounts = store.flaggedAccounts.filter((id) => id !== accountId);
  for (const calendarId of calendarIds) {
    rowOf(store, calendarId).attempt = CLEAN;
  }
};

const ticksStarted: number[] = [];

const markTickStarted = (): void => {
  ticksStarted.push(Date.now());
};

const runFailingTick = (
  store: Store,
  calendarId: string,
  accountId: string,
  duringWork: () => void = markTickStarted,
): Promise<unknown> =>
  runSourceIngest(
    createDependencies(store),
    calendarId,
    AbortSignal.timeout(ABORT_AFTER_MS),
    () => {
      duringWork();
      throw credentialError();
    },
    {
      onSettledFailure: () => {
        store.flaggedAccounts.push(accountId);
      },
    },
  ).catch((error: unknown) => error);

const CALENDAR_A = "9a0c4b2e-1d37-4f58-8b6a-2c7e5d1f3049";
const CALENDAR_B = "4e7b1f60-8c25-4a93-b0d7-6f2a3c8e5901";
const ACCOUNT_ID = "1f3d7c8a-5b04-4e26-9a71-8d0c2b6e4f53";

describe("a reconnect that lands mid-ingest on a source with no failure history", () => {
  it("arms the backoff and runs the failure handler, because the attempt state it compares is identical either way", async () => {
    const store = createStore({ [CALENDAR_A]: CLEAN });

    await runFailingTick(store, CALENDAR_A, ACCOUNT_ID, () => {
      reconnect(store, ACCOUNT_ID, [CALENDAR_A]);
    });

    expect(store.flaggedAccounts).toEqual([ACCOUNT_ID]);
    expect(rowOf(store, CALENDAR_A).backoffWrites).toBe(1);
  });
});

describe("an account whose calendars settle differently in the same tick", () => {
  it("flags the account once for the calendar that was really backed off", async () => {
    const parked = new Date("2026-08-12T00:00:00.000Z");
    const store = createStore({
      [CALENDAR_A]: { failureCount: 3, nextAttemptAt: parked },
      [CALENDAR_B]: { failureCount: 3, nextAttemptAt: parked },
    });

    await Promise.all([
      runFailingTick(store, CALENDAR_A, ACCOUNT_ID, () => {
        reconnect(store, ACCOUNT_ID, [CALENDAR_A]);
      }),
      runFailingTick(store, CALENDAR_B, ACCOUNT_ID),
    ]);

    expect(store.flaggedAccounts).toEqual([ACCOUNT_ID]);
    expect(rowOf(store, CALENDAR_A).backoffWrites).toBe(0);
    expect(rowOf(store, CALENDAR_B).backoffWrites).toBe(1);
  });
});

describe("the tick after a reconnect superseded the failure", () => {
  it("converges to a flagged, first-step backoff rather than staying silent", async () => {
    const store = createStore({
      [CALENDAR_A]: { failureCount: 9, nextAttemptAt: new Date("2026-08-12T00:00:00.000Z") },
    });

    await runFailingTick(store, CALENDAR_A, ACCOUNT_ID, () => {
      reconnect(store, ACCOUNT_ID, [CALENDAR_A]);
    });
    expect(store.flaggedAccounts).toEqual([]);
    expect(rowOf(store, CALENDAR_A).attempt).toEqual(CLEAN);

    const before = Date.now();
    await runFailingTick(store, CALENDAR_A, ACCOUNT_ID);

    expect(store.flaggedAccounts).toEqual([ACCOUNT_ID]);
    const { failureCount, nextAttemptAt } = rowOf(store, CALENDAR_A).attempt;
    expect(failureCount).toBe(1);
    expect(nextAttemptAt).not.toBeNull();
    expect((nextAttemptAt ?? new Date(0)).getTime() - before)
      .toBeLessThanOrEqual(5 * 60 * 1000 + 1000);
  });
});

describe("a bookkeeping read that fails after the ingest already failed", () => {
  it("reports the credential failure and still prompts the user to reconnect", async () => {
    const store = createStore({ [CALENDAR_A]: CLEAN });
    store.readAttemptFailsAfter = 1;

    const outcome = await runFailingTick(store, CALENDAR_A, ACCOUNT_ID);

    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as Error).message).toContain("invalid_grant");
    expect(store.flaggedAccounts).toEqual([ACCOUNT_ID]);
  });
});

describe("a source that stays broken while a reconnect races every tick", () => {
  it("never compounds the delay past the first step", async () => {
    const store = createStore({
      [CALENDAR_A]: { failureCount: 6, nextAttemptAt: new Date("2026-08-12T00:00:00.000Z") },
    });

    for (let tick = 0; tick < 20; tick += 1) {
      rowOf(store, CALENDAR_A).attempt = {
        failureCount: 6,
        nextAttemptAt: new Date("2026-08-12T00:00:00.000Z"),
      };
      await runFailingTick(store, CALENDAR_A, ACCOUNT_ID, () => {
        reconnect(store, ACCOUNT_ID, [CALENDAR_A]);
      });
      expect(rowOf(store, CALENDAR_A).attempt).toEqual(CLEAN);
    }

    expect(store.recorded.map((state) => state.failureCount)).toEqual([]);
    expect(rowOf(store, CALENDAR_A).backoffWrites).toBe(0);
  });
});
