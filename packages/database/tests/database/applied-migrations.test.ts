import { describe, expect, it } from "vitest";
import {
  describeMigrationRun,
  selectPendingMigrations,
} from "../../src/database/applied-migrations";
import type { MigrationJournal } from "../../src/database/applied-migrations";

const journal: MigrationJournal = {
  entries: [
    { tag: "0000_first", when: 1000 },
    { tag: "0001_second", when: 2000 },
    { tag: "0002_third", when: 3000 },
  ],
};

describe("selectPendingMigrations", () => {
  it("lists every migration for a database that has recorded none", () => {
    expect(selectPendingMigrations(journal, null)).toEqual([
      "0000_first",
      "0001_second",
      "0002_third",
    ]);
  });

  it("lists only the migrations newer than the last one recorded", () => {
    expect(selectPendingMigrations(journal, 1000)).toEqual(["0001_second", "0002_third"]);
    expect(selectPendingMigrations(journal, 2000)).toEqual(["0002_third"]);
  });

  it("lists nothing when the database is current", () => {
    expect(selectPendingMigrations(journal, 3000)).toEqual([]);
    expect(selectPendingMigrations(journal, 9000)).toEqual([]);
  });

  it("orders by creation time whatever order the journal lists them in", () => {
    const shuffled: MigrationJournal = { entries: journal.entries.toReversed() };

    expect(selectPendingMigrations(shuffled, 1000)).toEqual(["0001_second", "0002_third"]);
  });
});

describe("describeMigrationRun", () => {
  const at = new Date("2026-11-18T00:00:00.000Z");

  it("names the migrations a run applied", () => {
    expect(describeMigrationRun(journal, ["0001_second", "0002_third"], at)).toEqual({
      level: 30,
      "migrations.applied": ["0001_second", "0002_third"],
      "migrations.applied_count": 2,
      "migrations.known_count": 3,
      msg: "database migrations applied",
      time: "2026-11-18T00:00:00.000Z",
    });
  });

  it("says so when there was nothing to apply", () => {
    expect(describeMigrationRun(journal, [], at)).toMatchObject({
      "migrations.applied": [],
      "migrations.applied_count": 0,
      msg: "database migrations already applied",
    });
  });
});
