import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { widelog, widelogger } from "widelogger";
import { withReauthenticationDemand } from "../../../src/core/reauthentication/reauthentication-demand";
import type { ReauthenticationDemandDatabase } from "../../../src/core/reauthentication/reauthentication-demand";

const { context } = widelogger({
  defaultEventName: "wide_event",
  environment: "production",
  service: "calendar-test",
});

const emitted: Record<string, unknown>[] = [];
const originalWrite = process.stdout.write.bind(process.stdout);

const captureLine = (chunk: unknown): void => {
  for (const line of String(chunk).split("\n")) {
    if (line.trim().length === 0) {
      continue;
    }
    emitted.push(JSON.parse(line) as Record<string, unknown>);
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

const flatten = (value: unknown, prefix: string): [string, unknown][] => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return [[prefix, value]];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) =>
    flatten(nested, prefix.length === 0 ? key : `${prefix}.${key}`),
  );
};

const emittedFields = (): [string, unknown][] =>
  emitted.flatMap((event) => flatten(event, ""));

const priorRow = {
  id: "account-1",
  needsReauthentication: false,
  reauthenticationSource: null,
};

const createDatabase = (writeFailure: Error): ReauthenticationDemandDatabase =>
  ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([priorRow]),
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => Promise.reject(writeFailure),
      }),
    }),
  }) as unknown as ReauthenticationDemandDatabase;

const revokedGrant = (): Promise<never> =>
  Promise.reject(new Error("Token refresh failed (400): invalid_grant"));

const runDemand = async (writeFailure: Error): Promise<unknown> =>
  await context(async () => {
    try {
      await withReauthenticationDemand(
        createDatabase(writeFailure),
        { calendarAccountId: "account-1" },
        revokedGrant,
      );
      return null;
    } catch (error) {
      return error;
    } finally {
      widelog.flush();
    }
  });

describe("a reauthentication demand whose write fails", () => {
  it("still throws the original invalid_grant error rather than the write failure", async () => {
    const thrown = await runDemand(new Error("deadlock detected"));

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe("Token refresh failed (400): invalid_grant");
  });

  it("reports the failed demand write on the active wide event", async () => {
    await runDemand(new Error("deadlock detected"));

    const fields = emittedFields();
    expect(
      fields.filter(([key, value]) => key.includes("fail") && value === true),
    ).not.toEqual([]);
    expect(
      fields.filter(([, value]) => typeof value === "string" && value.includes("deadlock detected")),
    ).not.toEqual([]);
  });
});
