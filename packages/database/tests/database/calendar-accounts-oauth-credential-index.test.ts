import { readFile, readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { calendarAccountsTable } from "../../src/database/schema";

const drizzleDirectory = `${import.meta.dirname}/../../drizzle`;

const columnNamesOf = (index: { config: { columns: unknown[] } }): unknown[] =>
  index.config.columns.map((column) => {
    if (column && typeof column === "object" && "name" in column) {
      return (column as { name: unknown }).name;
    }
    return null;
  });

describe("calendar accounts oauth credential index", () => {
  it("declares a non-unique btree index over oauthCredentialId", () => {
    const tableConfig = getTableConfig(calendarAccountsTable);
    const credentialIndexes = tableConfig.indexes.filter((index) => {
      const columnNames = columnNamesOf(index);
      return (
        columnNames.length === 1 && columnNames[0] === "oauthCredentialId"
      );
    });

    expect(credentialIndexes.map((index) => index.config.name)).toHaveLength(1);
    expect(credentialIndexes[0]?.config.unique).toBe(false);
  });

  it("ships that index to production through a migration", async () => {
    const entries = await readdir(drizzleDirectory);
    const sqlFiles = entries.filter((entry) => entry.endsWith(".sql"));
    const statements = await Promise.all(
      sqlFiles.map(async (file) => {
        const contents = await readFile(`${drizzleDirectory}/${file}`, "utf8");
        return contents.toLowerCase();
      }),
    );
    const creatingFiles = sqlFiles.filter((file, position) => {
      const contents = statements[position] ?? "";
      return contents
        .split(";")
        .some(
          (statement) =>
            statement.includes("create index") &&
            statement.includes("calendar_accounts") &&
            statement.includes("oauthcredentialid"),
        );
    });

    expect(creatingFiles).toHaveLength(1);
  });
});
