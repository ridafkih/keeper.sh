import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  calendarAccountsTable,
  eventMappingsTable,
  eventStatesTable,
  oauthCredentialsTable,
} from "../../src/database/schema";
import { encryptToken, readStoredToken, storedTokenValue } from "../../src/token-encryption";

const ENCRYPTION_KEY = Buffer.from(new Uint8Array(32).fill(3)).toString("base64");

describe("oauth credential token columns", () => {
  it("keeps the on-disk column type unchanged so no migration is required", () => {
    const tableConfig = getTableConfig(oauthCredentialsTable);
    const tokenColumns = tableConfig.columns.filter(
      (column) => column.name === "accessToken" || column.name === "refreshToken",
    );

    expect(tokenColumns).toHaveLength(2);
    for (const column of tokenColumns) {
      expect(column.getSQLType()).toBe("text");
      expect(column.notNull).toBe(true);
    }
  });

  it("maps stored text to a stored token on read and back to text on write", () => {
    const tableConfig = getTableConfig(oauthCredentialsTable);
    const accessTokenColumn = tableConfig.columns.find(
      (column) => column.name === "accessToken",
    );

    const written = storedTokenValue(encryptToken("plain-access-token", ENCRYPTION_KEY));
    const readBack = accessTokenColumn?.mapFromDriverValue(written);

    expect(readBack).toEqual(readStoredToken(written));
    expect(accessTokenColumn?.mapToDriverValue(readBack)).toBe(written);
  });

  it("passes legacy plaintext values through the read mapping untouched", () => {
    const tableConfig = getTableConfig(oauthCredentialsTable);
    const refreshTokenColumn = tableConfig.columns.find(
      (column) => column.name === "refreshToken",
    );

    const readBack = refreshTokenColumn?.mapFromDriverValue("legacy-plaintext-token");

    expect(refreshTokenColumn?.mapToDriverValue(readBack)).toBe("legacy-plaintext-token");
  });
});

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
    const recurringIdentityIndex = tableConfig.indexes.find(
      (index) => index.config.name === "event_states_recurring_instance_idx",
    );
    const nonRecurringIdentityIndex = tableConfig.indexes.find(
      (index) => index.config.name === "event_states_non_recurring_instance_idx",
    );

    expect(sourceEventIndex?.config.unique).toBe(true);
    expect(sourceEventIndex?.config.where).toBeDefined();
    expect(recurringIdentityIndex?.config.unique).toBe(true);
    expect(recurringIdentityIndex?.config.where).toBeDefined();
    expect(nonRecurringIdentityIndex?.config.unique).toBe(true);
    expect(nonRecurringIdentityIndex?.config.where).toBeDefined();
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
    const recurringColumnNames = recurringIdentityIndex?.config.columns.map((column) => {
      if ("name" in column && typeof column.name === "string") {
        return column.name;
      }
      return null;
    });
    expect(recurringColumnNames).toEqual([
      "calendarId",
      "sourceEventUid",
      "recurrenceId",
    ]);
    const nonRecurringColumnNames = nonRecurringIdentityIndex?.config.columns.map((column) => {
      if ("name" in column && typeof column.name === "string") {
        return column.name;
      }
      return null;
    });
    expect(nonRecurringColumnNames).toEqual([
      "calendarId",
      "sourceEventUid",
      "startTime",
      "endTime",
    ]);
  });
});

describe("event mapping schema", () => {
  it("indexes the event state foreign key used by cascading deletes", () => {
    const tableConfig = getTableConfig(eventMappingsTable);
    const eventStateIndex = tableConfig.indexes.find(
      (index) => index.config.name === "event_mappings_event_state_idx",
    );
    const missingSyncEventIndex = tableConfig.indexes.find(
      (index) => index.config.name === "event_mappings_missing_sync_event_idx",
    );

    expect(eventStateIndex?.config.unique).toBe(false);
    expect(missingSyncEventIndex?.config.unique).toBe(false);
    expect(missingSyncEventIndex?.config.where).toBeDefined();
    const columnNames = eventStateIndex?.config.columns.map((column) => {
      if ("name" in column && typeof column.name === "string") {
        return column.name;
      }
      return null;
    });
    expect(columnNames).toEqual(["eventStateId"]);
  });
});
