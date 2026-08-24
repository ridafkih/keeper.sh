import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { DEFAULT_FEED_SETTINGS } from "@keeper.sh/data-schemas";
import {
  calendarAccountsTable,
  calendarsTable,
  eventMappingsTable,
  eventStatesTable,
  icalFeedCalendarsTable,
  icalFeedSettingsTable,
  icalFeedsTable,
  userSyncRequestsTable,
} from "../../src/database/schema";

describe("calendar account schema", () => {
  it("enforces one row per user for a provider account", () => {
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
      "userId",
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

const requireTable = (table: unknown, name: string): never => {
  if (!table) {
    throw new Error(`packages/database schema must export ${name}`);
  }
  return table as never;
};

const columnDefaults = (table: unknown, name: string): Record<string, unknown> =>
  Object.fromEntries(
    getTableConfig(requireTable(table, name)).columns
      .map((column) => [column.name, column.default]),
  );

const indexColumnNames = (columns: unknown[]): (string | null)[] =>
  columns.map((column) => {
    if (column && typeof column === "object" && "name" in column
      && typeof (column as { name: unknown }).name === "string") {
      return (column as { name: string }).name;
    }
    return null;
  });

describe("ical feed schema", () => {
  it("pins feed defaults to the values the legacy feed synthesized", () => {
    const feedDefaults = columnDefaults(icalFeedsTable, "icalFeedsTable");
    const legacyDefaults = columnDefaults(icalFeedSettingsTable, "icalFeedSettingsTable");

    expect(DEFAULT_FEED_SETTINGS).toEqual({
      includeEventName: false,
      includeEventDescription: false,
      includeEventLocation: false,
      excludeAllDayEvents: false,
      excludeFocusTime: false,
      excludeOutOfOffice: false,
      customEventName: "Busy",
    });

    for (const [field, value] of Object.entries(DEFAULT_FEED_SETTINGS)) {
      expect(feedDefaults[field]).toBe(value);
    }

    for (const field of [
      "includeEventName",
      "includeEventDescription",
      "includeEventLocation",
      "excludeAllDayEvents",
      "customEventName",
    ]) {
      expect(legacyDefaults[field]).toBe(feedDefaults[field]);
    }
  });

  it("allows exactly one default feed per user without forbidding extra feeds", () => {
    const tableConfig = getTableConfig(requireTable(icalFeedsTable, "icalFeedsTable"));
    const defaultIndex = tableConfig.indexes.find(
      (index) => index.config.name === "ical_feeds_default_idx",
    );

    expect(defaultIndex?.config.unique).toBe(true);
    expect(indexColumnNames(defaultIndex?.config.columns ?? [])).toEqual(["userId"]);
    expect(defaultIndex?.config.where).toBeDefined();
  });

  it("keeps feed tokens globally unique", () => {
    const tableConfig = getTableConfig(requireTable(icalFeedsTable, "icalFeedsTable"));
    const tokenIndex = tableConfig.indexes.find(
      (index) => index.config.name === "ical_feeds_token_idx",
    );
    const tokenColumn = tableConfig.columns.find((column) => column.name === "token");

    expect(tokenIndex?.config.unique).toBe(true);
    expect(tokenIndex?.config.where).toBeUndefined();
    expect(tokenColumn?.notNull).toBe(true);
  });

  it("never mints a guessable username alias by default", () => {
    const feedDefaults = columnDefaults(icalFeedsTable, "icalFeedsTable");

    expect(feedDefaults.legacyAlias).toBe(false);
    expect(feedDefaults.isDefault).toBe(false);
    expect(feedDefaults.name).toBe("My Calendar");
  });

  it("cascades feed membership when a calendar or a feed is deleted", () => {
    const tableConfig = getTableConfig(requireTable(icalFeedCalendarsTable, "icalFeedCalendarsTable"));
    const membershipIndex = tableConfig.indexes.find(
      (index) => index.config.name === "ical_feed_calendar_idx",
    );

    expect(membershipIndex?.config.unique).toBe(true);
    expect(indexColumnNames(membershipIndex?.config.columns ?? []))
      .toEqual(["feedId", "calendarId"]);
    expect(tableConfig.foreignKeys).toHaveLength(2);
    for (const foreignKey of tableConfig.foreignKeys) {
      expect(foreignKey.onDelete).toBe("cascade");
    }
  });
});

const readIndexColumnName = (column: object): string | null => {
  if ("name" in column && typeof column.name === "string") {
    return column.name;
  }
  return null;
};

const indexedColumnNames = (
  table: Parameters<typeof getTableConfig>[0],
): (string | null)[] =>
  getTableConfig(table).indexes.flatMap((index) =>
    index.config.columns.map((column) => readIndexColumnName(column)));

describe("calendar rediscovery schema", () => {
  it("marks a calendar unavailable with a nullable timestamp instead of deleting it", () => {
    const tableConfig = getTableConfig(calendarsTable);
    const unavailableSince = tableConfig.columns.find(
      (column) => column.name === "unavailableSince",
    );

    expect(unavailableSince).toBeDefined();
    expect(unavailableSince?.notNull).toBe(false);
    expect(unavailableSince?.hasDefault).toBe(false);
  });

  it("records the last successful calendar enumeration per account", () => {
    const tableConfig = getTableConfig(calendarAccountsTable);
    const calendarsRefreshedAt = tableConfig.columns.find(
      (column) => column.name === "calendarsRefreshedAt",
    );

    expect(calendarsRefreshedAt).toBeDefined();
    expect(calendarsRefreshedAt?.notNull).toBe(false);
    expect(calendarsRefreshedAt?.hasDefault).toBe(false);
  });

  it("records the last attempted calendar enumeration per account", () => {
    const tableConfig = getTableConfig(calendarAccountsTable);
    const calendarsRefreshAttemptedAt = tableConfig.columns.find(
      (column) => column.name === "calendarsRefreshAttemptedAt",
    );

    expect(calendarsRefreshAttemptedAt).toBeDefined();
    expect(calendarsRefreshAttemptedAt?.notNull).toBe(false);
    expect(calendarsRefreshAttemptedAt?.hasDefault).toBe(false);
  });

  it("keeps the attempt cursor distinct from the success timestamp", () => {
    const scheduleColumns = getTableConfig(calendarAccountsTable).columns
      .map((column) => column.name)
      .filter((name) =>
        name === "calendarsRefreshAttemptedAt" || name === "calendarsRefreshedAt");

    expect(scheduleColumns.toSorted())
      .toEqual(["calendarsRefreshAttemptedAt", "calendarsRefreshedAt"]);
  });

  it("keeps availability separate from the user-controlled paused flag", () => {
    const tableConfig = getTableConfig(calendarsTable);
    const disabled = tableConfig.columns.find((column) => column.name === "disabled");

    expect(disabled?.notNull).toBe(true);
    expect(disabled?.default).toBe(false);
  });

  it("adds no index over the rediscovery columns", () => {
    expect(indexedColumnNames(calendarsTable)).not.toContain("unavailableSince");
    expect(indexedColumnNames(calendarAccountsTable)).not.toContain("calendarsRefreshedAt");
    expect(indexedColumnNames(calendarAccountsTable))
      .not.toContain("calendarsRefreshAttemptedAt");
  });
});
