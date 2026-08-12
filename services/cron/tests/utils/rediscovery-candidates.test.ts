import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { buildImportedCalendarExists } from "../../src/utils/rediscovery-candidates";

const render = (): string =>
  new PgDialect().sqlToQuery(buildImportedCalendarExists()).sql;

describe("buildImportedCalendarExists", () => {
  it("scopes the check to calendars belonging to the candidate account", () => {
    const sql = render();

    expect(sql).toContain("exists");
    expect(sql).toContain('"calendars"."accountId" = "calendar_accounts"."id"');
  });

  it("requires an identity column so destination rows without one never qualify", () => {
    const sql = render();

    expect(sql).toContain('"calendars"."externalCalendarId" is not null');
    expect(sql).toContain('"calendars"."calendarUrl" is not null');
  });

  it("requires originalName so a CalDAV destination row never looks discovered", () => {
    const sql = render();

    expect(sql).toContain('"calendars"."originalName" is not null');
  });
});
