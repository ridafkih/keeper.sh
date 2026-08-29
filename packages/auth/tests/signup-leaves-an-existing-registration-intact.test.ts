import { describe, expect, it } from "vitest";
import { createAuth } from "../src/index";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";

interface AdapterWhereClause {
  field: string;
  value: unknown;
}

interface OwnedRow {
  id: string;
  userId: string;
}

const EXISTING = Object.freeze({
  email: "existing@keeper.sh",
  emailVerified: false,
  id: "established-outlook-customer",
  name: "Established Outlook Customer",
});

const EXISTING_CALENDAR_ACCOUNTS: readonly OwnedRow[] = Object.freeze([
  Object.freeze({ id: "calendar-account-1", userId: EXISTING.id }),
]);

const EXISTING_SOURCES: readonly OwnedRow[] = Object.freeze([
  Object.freeze({ id: "source-1", userId: EXISTING.id }),
]);

const buildAuth = () =>
  createAuth({
    baseUrl: "http://localhost:3000",
    commercialMode: true,
    database: {} as BunSQLDatabase,
    secret: "test-secret-value-for-signup-reclaim-ownership",
  });

const resolveSignUpBeforeHook = (auth: ReturnType<typeof createAuth>["auth"]) => {
  const before = auth.options.hooks?.before;

  if (typeof before !== "function") {
    throw new TypeError("hooks.before is not wired");
  }

  return before;
};

const matchesExistingLookup = (where: readonly AdapterWhereClause[]) =>
  where.every((clause) => {
    if (clause.field === "email") {
      return clause.value === EXISTING.email;
    }

    if (clause.field === "emailVerified") {
      return clause.value === EXISTING.emailVerified;
    }

    return false;
  });

const findSeededUser = (where: readonly AdapterWhereClause[]) => {
  if (!matchesExistingLookup(where)) {
    return null;
  }

  return { ...EXISTING };
};

const survivingRows = (
  rows: readonly OwnedRow[],
  deletedUserIds: readonly string[],
) => rows.filter((row) => !deletedUserIds.includes(row.userId));

describe("signing up with an address that already has a registration", () => {
  it("leaves the existing row, calendar accounts and sources intact", async () => {
    const { auth } = buildAuth();
    const deletedUserIds: string[] = [];

    const unauthenticatedContext = {
      body: {
        email: EXISTING.email,
        name: "Second Signup",
        password: "another-chosen-password",
      },
      context: {
        adapter: {
          delete: (input: { model: string }) => {
            deletedUserIds.push(`adapter.delete:${input.model}`);
            return Promise.resolve();
          },
          findOne: ({ where }: { model: string; where: AdapterWhereClause[] }) =>
            Promise.resolve(findSeededUser(where)),
        },
        internalAdapter: {
          deleteUser: (userId: string) => {
            deletedUserIds.push(userId);
            return Promise.resolve();
          },
        },
      },
      headers: new Headers(),
      path: "/sign-up/email",
    };

    await resolveSignUpBeforeHook(auth)(unauthenticatedContext as never);

    expect(deletedUserIds).toEqual([]);
    expect(survivingRows(EXISTING_CALENDAR_ACCOUNTS, deletedUserIds)).toEqual([
      { id: "calendar-account-1", userId: EXISTING.id },
    ]);
    expect(survivingRows(EXISTING_SOURCES, deletedUserIds)).toEqual([
      { id: "source-1", userId: EXISTING.id },
    ]);
  });
});
