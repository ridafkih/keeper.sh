import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { sourceDestinationMappingsTable } from "../../src/database/schema";

const columnsByName = () => Object.fromEntries(
  getTableConfig(sourceDestinationMappingsTable).columns.map((column) => [column.name, column]),
);

/*
 * Whether a read has come back with something since the copies went missing is per pair —
 * the granularity the question is asked at and the answer is recorded at — and it has to
 * survive the pass that observed it, so it is stored rather than derived. Both columns are
 * plain observations: the moment the copies were first found missing, and the moment a read
 * last returned at least one of them. Nullable, because every pair that exists today has
 * neither, and a row with neither must read as "not unlocked" rather than as unlocked.
 */
describe("the pair remembers what the blank-read gate is decided on", () => {
  it("records when the copies were first observed missing", () => {
    const column = columnsByName().copiesMissingObservedAt;

    expect(column).toBeDefined();
    expect(column?.notNull).toBe(false);
    expect(column?.hasDefault).toBe(false);
  });

  it("records when a read last returned at least one copy", () => {
    const column = columnsByName().lastHealthyReadAt;

    expect(column).toBeDefined();
    expect(column?.notNull).toBe(false);
    expect(column?.hasDefault).toBe(false);
  });

  /*
   * The approval the gate stands in front of. It is unchanged, and the gate is an extra
   * condition on reaching it rather than a replacement for its half-hour lifetime.
   */
  it("still records the approval that releases the held deletions", () => {
    const column = columnsByName().deleteConfirmationApprovedAt;

    expect(column).toBeDefined();
    expect(column?.notNull).toBe(false);
  });
});
