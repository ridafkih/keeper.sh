import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { widelog, widelogger } from "widelogger";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";

interface EmittedEvent {
  provider?: { account_id?: string };
  reauth?: {
    action?: string;
    previous?: boolean;
    provenance?: string;
    recorded_provenance?: string;
    signal?: string;
    transitioned?: boolean;
  };
}

interface PriorRow {
  needsReauthentication: boolean;
  reauthenticationSource: string | null;
}

let clientFailure: () => never = () => {
  throw Object.assign(new Error("Unauthorized"), { status: 401 });
};

const createFailingClient = (): Record<string, unknown> => ({
  fetchCalendarDisplayName: () => Promise.resolve(null),
  fetchCalendarObjects: () => Promise.resolve().then(() => clientFailure()),
  resolveCalendarUrl: () => Promise.resolve().then(() => clientFailure()),
});

vi.mock("../../../../src/providers/caldav/shared/client", () => ({
  CalDAVClient: function CalDAVClient() {
    return createFailingClient();
  },
}));

vi.mock("@keeper.sh/database", async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  decryptPassword: () => "plaintext",
}));

const { createCalDAVSourceProvider } = await import(
  "../../../../src/providers/caldav/source/provider"
);

const { context } = widelogger({
  defaultEventName: "wide_event",
  environment: "production",
  service: "calendar-test",
});

const emitted: EmittedEvent[] = [];
const originalWrite = process.stdout.write.bind(process.stdout);

const captureLine = (chunk: unknown): void => {
  for (const line of String(chunk).split("\n")) {
    if (line.trim().length === 0) {
      continue;
    }
    emitted.push(JSON.parse(line) as EmittedEvent);
  }
};

beforeEach(() => {
  emitted.length = 0;
  clientFailure = () => {
    throw Object.assign(new Error("Unauthorized"), { status: 401 });
  };
  process.stdout.write = ((chunk: unknown) => {
    captureLine(chunk);
    return true;
  }) as typeof process.stdout.write;
});

afterEach(() => {
  process.stdout.write = originalWrite;
});

const SOURCE_ROW = {
  authMethod: "basic",
  calendarAccountId: "account-1",
  calendarId: "calendar-1",
  calendarUrl: "https://dav.example.com/cal/",
  encryptedPassword: "cipher",
  name: "Calendar",
  originalName: "Calendar",
  provider: "caldav",
  serverUrl: "https://dav.example.com/",
  syncToken: null,
  userId: "user-1",
};

const createChain = (resolve: () => unknown): unknown => {
  const chain: Record<string, unknown> = {};
  return new Proxy(chain, {
    get(_target, property) {
      if (property === "then") {
        return (onFulfilled: (value: unknown) => unknown, onRejected: (reason: unknown) => unknown) =>
          Promise.resolve().then(resolve).then(onFulfilled).catch(onRejected);
      }
      return () => createChain(resolve);
    },
  });
};

interface FakeDatabase {
  database: BunSQLDatabase;
  updates: Record<string, unknown>[];
}

const createFakeDatabase = (readPrior: () => PriorRow[]): FakeDatabase => {
  const updates: Record<string, unknown>[] = [];
  const resolveSelect = (projection: Record<string, unknown>): unknown[] => {
    const keys = new Set(Object.keys(projection));
    if (keys.has("calendarAccountId")) {
      return [SOURCE_ROW];
    }
    if (keys.has("needsReauthentication")) {
      return readPrior();
    }
    throw new Error(`unexpected select projection: ${[...keys].join(",")}`);
  };
  const database = {
    select: (projection: Record<string, unknown>) =>
      createChain(() => resolveSelect(projection)),
    transaction: (work: (transaction: unknown) => Promise<unknown>) =>
      work({
        execute: () => Promise.resolve(null),
        select: (projection: Record<string, unknown>) =>
          createChain(() => resolveSelect(projection)),
      }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          updates.push(values);
          return Promise.resolve([]);
        },
      }),
    }),
  } as unknown as BunSQLDatabase;
  return { database, updates };
};

const syncOnce = async (fake: FakeDatabase): Promise<void> => {
  const provider = createCalDAVSourceProvider({
    database: fake.database,
    encryptionKey: "0".repeat(64),
  });
  await context(async () => {
    await provider.syncSource("calendar-1");
    widelog.flush();
  });
};

const demandEvent = (): EmittedEvent => {
  const event = emitted.find(({ reauth }) => Boolean(reauth));
  if (!event) {
    throw new Error("expected a wide event carrying reauth fields");
  }
  return event;
};

describe("a CalDAV source pull rejected as unauthenticated", () => {
  it("logs the raise with its provenance and deciding signal on the active wide event", async () => {
    const fake = createFakeDatabase(() => [
      { needsReauthentication: false, reauthenticationSource: null },
    ]);

    await syncOnce(fake);

    const event = demandEvent();
    expect(event.provider?.account_id).toBe("account-1");
    expect(event.reauth?.action).toBe("raise");
    expect(event.reauth?.provenance).toBe("source-credentials");
    expect(event.reauth?.signal).toBe("caldav-authentication-error");
    expect(event.reauth?.previous).toBe(false);
    expect(event.reauth?.transitioned).toBe(true);
    expect(fake.updates).toEqual([
      { needsReauthentication: true, reauthenticationSource: "source-credentials" },
    ]);
  });

  it("distinguishes a re-raise over an already-standing demand from a real transition", async () => {
    const fake = createFakeDatabase(() => [
      { needsReauthentication: true, reauthenticationSource: "token-refresh" },
    ]);

    await syncOnce(fake);

    const event = demandEvent();
    expect(event.reauth?.previous).toBe(true);
    expect(event.reauth?.transitioned).toBe(false);
    expect(event.reauth?.recorded_provenance).toBe("token-refresh");
  });

  it("logs nothing and writes nothing for a non-authentication failure", async () => {
    clientFailure = () => {
      throw Object.assign(new Error("Service Unavailable"), { status: 503 });
    };
    const fake = createFakeDatabase(() => [
      { needsReauthentication: false, reauthenticationSource: null },
    ]);

    await syncOnce(fake);

    expect(emitted.find(({ reauth }) => Boolean(reauth))).toBeUndefined();
    expect(fake.updates).toEqual([]);
  });
});
