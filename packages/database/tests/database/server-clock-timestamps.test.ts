import { describe, expect, it } from "vitest";
import {
  buildServerClockRepairPlan,
  describeColumnOrigins,
  type ColumnOrigin,
  type ServerClockCandidate,
} from "../../src/database/server-clock-timestamps";
import { SCHEMA_TABLES } from "../../src/database/schema-tables";

const ZONE = "Europe/Berlin";

const candidate = (table: string, column: string): ServerClockCandidate =>
  ({ column, table });

const origins = (
  entries: [string, boolean][],
): Map<string, ColumnOrigin> =>
  new Map(entries.map(([key, appRewrites]) => [key, { appRewrites }]));

describe("the plan that moves server-clock timestamps to UTC", () => {
  it("moves every row of a column the application never writes", () => {
    const plan = buildServerClockRepairPlan({
      candidates: [candidate("user", "createdAt")],
      origins: origins([["user.createdAt", false]]),
      zone: ZONE,
    });

    expect(plan).toEqual([
      'UPDATE "user" SET "createdAt" = ("createdAt" AT TIME ZONE \'Europe/Berlin\')'
      + ' AT TIME ZONE \'UTC\' WHERE "createdAt" IS NOT NULL',
    ]);
  });

  it("moves only the untouched rows of a column the application rewrites", () => {
    const plan = buildServerClockRepairPlan({
      candidates: [
        candidate("caldav_credentials", "createdAt"),
        candidate("caldav_credentials", "updatedAt"),
      ],
      origins: origins([
        ["caldav_credentials.createdAt", false],
        ["caldav_credentials.updatedAt", true],
      ]),
      zone: ZONE,
    });

    expect(plan.some((statement) =>
      statement.includes('"updatedAt" = "createdAt"'))).toBe(true);
  });

  /*
   * The discriminator only survives while createdAt still holds its original value, so a
   * plan that repaired createdAt first would silently skip every untouched updatedAt.
   */
  it("repairs the discriminated column before the column it reads", () => {
    const plan = buildServerClockRepairPlan({
      candidates: [
        candidate("caldav_credentials", "createdAt"),
        candidate("caldav_credentials", "updatedAt"),
      ],
      origins: origins([
        ["caldav_credentials.createdAt", false],
        ["caldav_credentials.updatedAt", true],
      ]),
      zone: ZONE,
    });

    const discriminated = plan.findIndex((statement) =>
      statement.includes('"updatedAt" = "createdAt"'));
    const plain = plan.findIndex((statement) =>
      statement.startsWith('UPDATE "caldav_credentials" SET "createdAt"'));

    expect(discriminated).toBeLessThan(plain);
  });

  it("leaves a rewritten column alone when nothing can date its rows", () => {
    const plan = buildServerClockRepairPlan({
      candidates: [candidate("user_subscriptions", "updatedAt")],
      origins: origins([["user_subscriptions.updatedAt", true]]),
      zone: ZONE,
    });

    expect(plan).toEqual([]);
  });

  it("refuses a zone name it cannot safely put in a statement", () => {
    expect(() =>
      buildServerClockRepairPlan({
        candidates: [candidate("user", "createdAt")],
        origins: origins([["user.createdAt", false]]),
        zone: "UTC'; DROP TABLE \"user\"; --",
      })).toThrow(/Refusing to build a timestamp repair/u);
  });
});

describe("the origins read off the schema", () => {
  const schemaOrigins = describeColumnOrigins(SCHEMA_TABLES);

  it("marks a column carrying $onUpdate as one the application rewrites", () => {
    expect(schemaOrigins.get("caldav_credentials.updatedAt")?.appRewrites).toBe(true);
    expect(schemaOrigins.get("calendars.updatedAt")?.appRewrites).toBe(true);
  });

  it("marks an insert-only column as one only the server wrote", () => {
    expect(schemaOrigins.get("caldav_credentials.createdAt")?.appRewrites).toBe(false);
    expect(schemaOrigins.get("user.createdAt")?.appRewrites).toBe(false);
    expect(schemaOrigins.get("user.updatedAt")?.appRewrites).toBe(false);
  });

  it("covers both the application and the auth schemas", () => {
    expect(schemaOrigins.has("event_mappings.createdAt")).toBe(true);
    expect(schemaOrigins.has("session.expiresAt")).toBe(true);
  });
});
