import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { calendarAccountsTable } from "../../src/database/schema";

describe("calendar account schema", () => {
  it("enforces provider account identity for OAuth upserts", () => {
    const tableConfig = getTableConfig(calendarAccountsTable);
    const identityIndex = tableConfig.indexes.find(
      (index) => index.config.name === "calendar_accounts_provider_account_idx",
    );

    expect(identityIndex?.config.unique).toBe(true);
    const columnNames = identityIndex?.config.columns.map((column) => {
      if ("name" in column && typeof column.name === "string") {
        return column.name;
      }
      return null;
    });
    expect(columnNames).toEqual([
      "provider",
      "accountId",
    ]);
  });
});
