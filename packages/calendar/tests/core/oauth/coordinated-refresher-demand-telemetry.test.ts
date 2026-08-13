import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { widelog, widelogger } from "widelogger";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { createCoordinatedRefresher } from "../../../src/core/oauth/coordinated-refresher";

interface EmittedEvent {
  provider?: { account_id?: string };
  reauth?: {
    action?: string;
    previous?: boolean;
    previous_read_failed?: boolean;
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
  process.stdout.write = ((chunk: unknown) => {
    captureLine(chunk);
    return true;
  }) as typeof process.stdout.write;
});

afterEach(() => {
  process.stdout.write = originalWrite;
});

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

const createFakeDatabase = (
  readPrior: () => PriorRow[],
): FakeDatabase => {
  const updates: Record<string, unknown>[] = [];
  const database = {
    select: () => createChain(() => readPrior()),
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

let credentialSequence = 0;

const refreshOnce = async (
  fake: FakeDatabase,
  rawRefresh: () => Promise<never>,
): Promise<void> => {
  credentialSequence += 1;
  const refresher = createCoordinatedRefresher({
    calendarAccountId: "account-1",
    database: fake.database,
    oauthCredentialId: `credential-${String(credentialSequence)}`,
    rawRefresh,
    refreshLockStore: null,
  });
  await context(async () => {
    try {
      await refresher("refresh-token");
    } catch {
      widelog.set("outcome", "error");
    } finally {
      widelog.flush();
    }
  });
};

const rejectedGrant = (): Promise<never> =>
  Promise.reject(new Error("invalid_grant: token revoked"));

const demandEvent = (): EmittedEvent => {
  const event = emitted.find(({ reauth }) => Boolean(reauth));
  if (!event) {
    throw new Error("expected a wide event carrying reauth fields");
  }
  return event;
};

describe("a token refresh rejected by the identity provider", () => {
  it("logs the raise with its provenance and deciding signal on the active wide event", async () => {
    const fake = createFakeDatabase(() => [
      { needsReauthentication: false, reauthenticationSource: null },
    ]);

    await refreshOnce(fake, rejectedGrant);

    const event = demandEvent();
    expect(event.provider?.account_id).toBe("account-1");
    expect(event.reauth?.action).toBe("raise");
    expect(event.reauth?.provenance).toBe("token-refresh");
    expect(event.reauth?.signal).toBe("oauth-refresh-rejected");
    expect(event.reauth?.previous).toBe(false);
    expect(event.reauth?.transitioned).toBe(true);
    expect(fake.updates).toEqual([
      { needsReauthentication: true, reauthenticationSource: "token-refresh" },
    ]);
  });

  it("distinguishes a re-raise over an already-standing demand from a real transition", async () => {
    const fake = createFakeDatabase(() => [
      { needsReauthentication: true, reauthenticationSource: "destination-grant" },
    ]);

    await refreshOnce(fake, rejectedGrant);

    const event = demandEvent();
    expect(event.reauth?.previous).toBe(true);
    expect(event.reauth?.transitioned).toBe(false);
    expect(event.reauth?.recorded_provenance).toBe("destination-grant");
  });

  it("still raises and logs when the prior-state read fails, marking the state unknown", async () => {
    const fake = createFakeDatabase(() => {
      throw new Error("connection reset");
    });

    await refreshOnce(fake, rejectedGrant);

    const event = demandEvent();
    expect(event.reauth?.action).toBe("raise");
    expect(event.reauth?.previous).toBeUndefined();
    expect(event.reauth?.transitioned).toBeUndefined();
    expect(event.reauth?.previous_read_failed).toBe(true);
    expect(fake.updates).toEqual([
      { needsReauthentication: true, reauthenticationSource: "token-refresh" },
    ]);
  });

  it("logs nothing and writes nothing for a refresh failure that does not demand reauthentication", async () => {
    const fake = createFakeDatabase(() => [
      { needsReauthentication: false, reauthenticationSource: null },
    ]);

    await refreshOnce(fake, () => Promise.reject(new Error("provider returned 503")));

    expect(emitted.find(({ reauth }) => Boolean(reauth))).toBeUndefined();
    expect(fake.updates).toEqual([]);
  });
});
