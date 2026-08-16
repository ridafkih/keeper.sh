import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  describeNonUtcTimeZone,
  isUtcTimeZoneName,
} from "../../src/database/migration-timezone";

const migrationSql = (name: string): string =>
  readFileSync(new URL(`../../drizzle/${name}`, import.meta.url), "utf8");

describe("the server time zone a timestamptz migration requires", () => {
  it("accepts the names Postgres reports for UTC", () => {
    for (const zone of ["UTC", "Etc/UTC", "Universal", "Zulu"]) {
      expect(isUtcTimeZoneName(zone)).toBe(true);
    }
  });

  it("refuses a zone whose wall clock is not UTC", () => {
    for (const zone of ["America/Chicago", "Europe/Berlin", "America/Denver", "EST"]) {
      expect(isUtcTimeZoneName(zone)).toBe(false);
    }
  });

  it("refuses an absent zone rather than assuming UTC", () => {
    const absent = [null, globalThis.undefined, ""];

    for (const zone of absent) {
      expect(isUtcTimeZoneName(zone)).toBe(false);
    }
  });

  it("names the zone it found and what to do about it", () => {
    const message = describeNonUtcTimeZone("America/Chicago");

    expect(message).toContain("America/Chicago");
    expect(message).toContain("timezone = 'UTC'");
  });
});

/*
 * A USING clause forces a full table rewrite under ACCESS EXCLUSIVE. With the session in
 * UTC the conversion is binary-identical and Postgres records it as metadata, so the bare
 * form is the one that keeps the deploy online. Reintroducing USING would also silently
 * reinterpret every DEFAULT now() column on a server whose zone was never UTC.
 */
describe("the timestamptz migrations themselves", () => {
  for (const name of ["0091_low_doctor_spectrum.sql"]) {
    it(`${name} converts without forcing a rewrite`, () => {
      const sql = migrationSql(name);
      const conversions = sql.match(/SET DATA TYPE timestamp with time zone/gu) ?? [];

      expect(conversions.length).toBeGreaterThan(0);
      expect(sql).not.toMatch(/SET DATA TYPE timestamp with time zone USING/u);
    });
  }
});
