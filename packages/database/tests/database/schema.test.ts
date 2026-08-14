import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  calendarAccountsTable,
  calendarsTable,
  eventMappingsTable,
  eventStatesTable,
  userSyncRequestsTable,
} from "../../src/database/schema";

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

describe("calendar schema", () => {
  it("anonymises event detail by default regardless of the flow that inserted the row", () => {
    const tableConfig = getTableConfig(calendarsTable);
    const defaults = Object.fromEntries(
      tableConfig.columns.map((column) => [column.name, column.default]),
    );

    expect(defaults.excludeEventName).toBe(true);
    expect(defaults.excludeEventDescription).toBe(true);
    expect(defaults.excludeEventLocation).toBe(true);
    expect(defaults.customEventName).toBe("{{calendar_name}}");
  });
});

describe("backoff clock schema", () => {
  it("leaves the attempt clocks entirely to the writer so the reconnect guards can match them", () => {
    const tableConfig = getTableConfig(calendarsTable);
    const clockColumns = [
      "nextAttemptAt",
      "lastFailureAt",
      "ingestNextAttemptAt",
      "ingestLastFailureAt",
    ];

    for (const columnName of clockColumns) {
      const column = tableConfig.columns.find((entry) => entry.name === columnName);
      expect(column).toBeDefined();
      expect(column?.hasDefault).toBe(false);
      expect(column?.default).toBeUndefined();
      expect(column?.defaultFn).toBeUndefined();
      expect(column?.onUpdateFn).toBeUndefined();
    }
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
  it("keeps legacy identities nullable while indexing backfill and uniqueness", () => {
    const tableConfig = getTableConfig(eventMappingsTable);
    const eventStateIndex = tableConfig.indexes.find(
      (index) => index.config.name === "event_mappings_event_state_idx",
    );
    const syncEventIndex = tableConfig.indexes.find(
      (index) => index.config.name === "event_mappings_sync_event_cal_idx",
    );
    const missingSyncEventIndex = tableConfig.indexes.find(
      (index) => index.config.name === "event_mappings_missing_sync_event_idx",
    );
    const syncEventIdColumn = tableConfig.columns.find(
      (column) => column.name === "syncEventId",
    );
    const sourceCalendarIdColumn = tableConfig.columns.find(
      (column) => column.name === "sourceCalendarId",
    );

    expect(eventStateIndex?.config.unique).toBe(false);
    expect(syncEventIdColumn?.notNull).toBe(false);
    expect(syncEventIndex?.config.unique).toBe(true);
    expect(syncEventIndex?.config.where).toBeDefined();
    expect(missingSyncEventIndex?.config.where).toBeDefined();
    expect(sourceCalendarIdColumn?.notNull).toBe(false);
    const columnNames = eventStateIndex?.config.columns.map((column) => {
      if ("name" in column && typeof column.name === "string") {
        return column.name;
      }
      return null;
    });
    expect(columnNames).toEqual(["eventStateId"]);
  });
});

describe("durable sync request schema", () => {
  it("stores one replaceable reconciliation request per user", () => {
    const tableConfig = getTableConfig(userSyncRequestsTable);
    const userIdColumn = tableConfig.columns.find((column) => column.name === "userId");
    const requestIdColumn = tableConfig.columns.find(
      (column) => column.name === "requestId",
    );

    expect(userIdColumn?.primary).toBe(true);
    expect(requestIdColumn?.notNull).toBe(true);
  });
});
