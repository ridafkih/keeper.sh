import { describe, expect, it } from "vitest";
import { createAuth } from "../src/index";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";

const SECRET = "sign-up-reclaim-finish-secret-long-enough-for-validation";
const VICTIM_ID = "victim-user";
const VICTIM_EMAIL = "customer@example.com";
const ROW_DELETE_MESSAGE = "user row delete failed";

type BeforeHook = (context: unknown) => Promise<unknown>;

interface ReclaimHarness {
  before: BeforeHook;
  sequence: string[];
  confirmedTombstones: string[];
}

const buildReclaimHarness = (options: { rowDeleteFails: boolean }): ReclaimHarness => {
  const sequence: string[] = [];
  const confirmedTombstones: string[] = [];

  const { auth } = createAuth({
    baseUrl: "http://localhost:3000",
    commercialMode: true,
    confirmDeleteUserTombstone: (userId: string) => {
      sequence.push("tombstone_confirm");
      confirmedTombstones.push(userId);
      return Promise.resolve();
    },
    database: {} as BunSQLDatabase,
    deleteUserResidueRecorder: () => Promise.resolve(),
    deleteUserTeardown: () => {
      sequence.push("teardown");
      return Promise.resolve();
    },
    deleteUserTeardownRollback: () => Promise.resolve(),
    secret: SECRET,
  } as Parameters<typeof createAuth>[0]);

  const before = auth.options.hooks?.before as BeforeHook | undefined;

  if (!before) {
    throw new TypeError("the sign-up reclaim hook is not wired");
  }

  const runRowDelete = (userId: string) => {
    sequence.push("row_delete");

    if (options.rowDeleteFails) {
      return Promise.reject(new Error(ROW_DELETE_MESSAGE));
    }

    return Promise.resolve({ id: userId });
  };

  const invoke = () =>
    before({
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
        internalAdapter: { deleteUser: runRowDelete },
      },
      method: "POST",
      path: "/sign-up/email",
    });

  return { before: invoke as unknown as BeforeHook, confirmedTombstones, sequence };
};

describe("the sign-up reclaim finishes the delete it started", () => {
  it("confirms the reclaimed user's tombstone after the row delete commits", async () => {
    const harness = buildReclaimHarness({ rowDeleteFails: false });

    await harness.before(undefined);

    expect(harness.confirmedTombstones).toEqual([VICTIM_ID]);
    expect(harness.sequence).toEqual(["teardown", "row_delete", "tombstone_confirm"]);
  });

  it("leaves the tombstone unconfirmed when the row delete rejects", async () => {
    const harness = buildReclaimHarness({ rowDeleteFails: true });

    const failure = await harness.before(undefined).then(
      () => null,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(Error);
    expect(harness.confirmedTombstones).toEqual([]);
    expect(harness.sequence).toEqual(["teardown", "row_delete"]);
  });
});
