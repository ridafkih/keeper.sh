import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { calendarAccountsTable, eventStatesTable } from "../../src/database/schema";

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

describe("event state schema", () => {
  it("enforces provider and fallback instance identities", () => {
    const tableConfig = getTableConfig(eventStatesTable);
    const sourceEventIndex = tableConfig.indexes.find(
      (index) => index.config.name === "event_states_source_event_idx",
    );
    const instanceIdentityIndex = tableConfig.indexes.find(
      (index) => index.config.name === "event_states_instance_idx",
    );

    expect(sourceEventIndex?.config.unique).toBe(true);
    expect(sourceEventIndex?.config.where).toBeDefined();
    expect(instanceIdentityIndex?.config.unique).toBe(true);
    expect(instanceIdentityIndex?.config.where).toBeDefined();
    const sourceColumnNames = sourceEventIndex?.config.columns.map((column) => {
      if ("name" in column && typeof column.name === "string") {
        return column.name;
      }
      return null;
    });
    expect(sourceColumnNames).toEqual([
      "calendarId",
      "sourceEventId",
    ]);
    const instanceColumnNames = instanceIdentityIndex?.config.columns.map((column) => {
      if ("name" in column && typeof column.name === "string") {
        return column.name;
      }
      return null;
    });
    expect(instanceColumnNames).toEqual([
      "calendarId",
      "sourceEventInstanceKey",
    ]);
  });
});
