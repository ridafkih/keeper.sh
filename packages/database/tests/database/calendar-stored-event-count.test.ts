import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { calendarsTable } from "../../src/database/schema";

const migrationsDirectory = join(import.meta.dirname, "../../drizzle");

describe("calendars stored-event count column", () => {
  it("exposes storedEventCount as a nullable integer", () => {
    const tableConfig = getTableConfig(calendarsTable);
    const column = tableConfig.columns.find(
      (candidate) => candidate.name === "storedEventCount",
    );

    expect(column).toBeDefined();
    expect(column?.getSQLType()).toBe("integer");
    expect(column?.notNull).toBe(false);
    expect(column?.hasDefault).toBe(false);
  });

  it("ships a migration that adds the column to calendars", async () => {
    const entries = await readdir(migrationsDirectory);
    const migrationFiles = entries
      .filter((entry) => entry.endsWith(".sql"))
      .toSorted();

    const contents = await Promise.all(migrationFiles.map(
      (file) => readFile(join(migrationsDirectory, file), "utf8"),
    ));
    const addsColumn = contents.some((sql) =>
      /ALTER TABLE "calendars" ADD COLUMN (IF NOT EXISTS )?"storedEventCount" integer/.test(sql));

    expect(addsColumn).toBe(true);
  });
});
