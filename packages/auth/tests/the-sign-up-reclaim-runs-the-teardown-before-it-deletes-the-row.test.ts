import { describe, expect, it } from "vitest";
import { createAuth } from "../src/index";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";

const SECRET = "sign-up-reclaim-secret-long-enough-for-validation";
const VICTIM_ID = "victim-user";
const VICTIM_EMAIL = "customer@example.com";
const BLOCKED_MESSAGE = "sync-halt tombstone could not be established";

type BeforeHook = (context: unknown) => Promise<unknown>;

interface ReclaimHarness {
  before: BeforeHook;
  sequence: string[];
  deletedRows: string[];
  teardownCalls: string[];
}

const buildReclaimHarness = (options: { teardownBlocks: boolean }): ReclaimHarness => {
  const sequence: string[] = [];
  const deletedRows: string[] = [];
  const teardownCalls: string[] = [];

  const deleteUserTeardown = (userId: string) => {
    teardownCalls.push(userId);
    sequence.push("teardown");

    if (options.teardownBlocks) {
      return Promise.reject(
        Object.assign(new Error(BLOCKED_MESSAGE), { name: "TeardownBlockedError" }),
      );
    }

    return Promise.resolve();
  };

  const { auth } = createAuth({
    baseUrl: "http://localhost:3000",
    commercialMode: true,
    database: {} as BunSQLDatabase,
    deleteUserResidueRecorder: () => Promise.resolve(),
    deleteUserTeardown,
    deleteUserTeardownRollback: () => Promise.resolve(),
    secret: SECRET,
  } as Parameters<typeof createAuth>[0]);

  const before = auth.options.hooks?.before as BeforeHook | undefined;

  if (!before) {
    throw new TypeError("the sign-up reclaim hook is not wired");
  }

  return { before, deletedRows, sequence, teardownCalls };
};

const invokeReclaim = (harness: ReclaimHarness): Promise<unknown> =>
  harness.before({
    body: { email: VICTIM_EMAIL, name: "attacker", password: "attacker-password" },
    context: {
      adapter: {
        findOne: () =>
          Promise.resolve({
            email: VICTIM_EMAIL,
            emailVerified: false,
            id: VICTIM_ID,
          }),
      },
      internalAdapter: {
        deleteUser: (userId: string) => {
          harness.sequence.push("row_delete");
          harness.deletedRows.push(userId);
          return Promise.resolve();
        },
      },
    },
    method: "POST",
    path: "/sign-up/email",
  });

describe("the sign-up reclaim runs the teardown before it deletes the row", () => {
  it("quiesces the reclaimed user before the row delete", async () => {
    const harness = buildReclaimHarness({ teardownBlocks: false });

    await invokeReclaim(harness);

    expect(harness.teardownCalls).toEqual([VICTIM_ID]);
    expect(harness.deletedRows).toEqual([VICTIM_ID]);
    expect(harness.sequence).toEqual(["teardown", "row_delete"]);
  });

  it("refuses the reclaim and leaves the row when the teardown blocks", async () => {
    const harness = buildReclaimHarness({ teardownBlocks: true });

    const failure = await invokeReclaim(harness).then(
      () => null,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(Error);
    expect(harness.deletedRows).toEqual([]);
    expect(harness.sequence).not.toContain("row_delete");

    const apiError = failure as { statusCode?: number; body?: { code?: string } };

    expect(apiError.statusCode).toBe(503);
    expect(apiError.body?.code).toBe("TEARDOWN_BLOCKED");
  });
});
