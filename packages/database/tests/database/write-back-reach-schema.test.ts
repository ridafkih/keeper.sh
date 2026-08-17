import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { sourceDestinationMappingsTable } from "../../src/database/schema";

const columnsByName = () => Object.fromEntries(
  getTableConfig(sourceDestinationMappingsTable).columns.map((column) => [column.name, column]),
);

/*
 * How far a write may reach is one ordered level rather than a set of flags, and it is
 * NOT NULL with the narrowest level as its default: a row nobody has answered for must
 * read as the least permission, never as an absent one a caller might resolve either way.
 *
 * Unlike deleteConfirmationApprovedAt it does not expire. That one answers whether a
 * particular disappearance was real; this answers what Keeper.sh may ever do, and expiring
 * it would revoke a permission the user never withdrew.
 */
describe("the pair remembers how far a write may reach", () => {
  it("stores the reach with the narrowest level as its default", () => {
    const column = columnsByName().writeBackReach;

    expect(column).toBeDefined();
    expect(column?.notNull).toBe(true);
    expect(column?.hasDefault).toBe(true);
    expect(column?.default).toBe("own_events");
  });
});
