import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { calendarPushChannelsTable } from "../../src/database/schema";

const columnNamesOf = (index: { config: { columns: unknown[] } } | undefined): unknown[] | undefined =>
  index?.config.columns.map((column) => {
    if (column && typeof column === "object" && "name" in column) {
      return (column as { name: unknown }).name;
    }
    return null;
  });

describe("calendar push channel schema", () => {
  it("keeps every provider-assigned column nullable so the row can be inserted first", () => {
    const tableConfig = getTableConfig(calendarPushChannelsTable);
    const nullability = Object.fromEntries(
      tableConfig.columns.map((column) => [column.name, column.notNull]),
    );

    expect(nullability.providerChannelId).toBe(false);
    expect(nullability.providerResourceId).toBe(false);
    expect(nullability.expiresAt).toBe(false);
    expect(nullability.resourcePath).toBe(false);
    expect(nullability.calendarId).toBe(false);
    expect(nullability.verifiedAt).toBe(false);
    expect(nullability.lastNotificationAt).toBe(false);
    expect(nullability.reauthorizeRequestedAt).toBe(false);
  });

  it("requires the columns that must exist before the provider is contacted", () => {
    const tableConfig = getTableConfig(calendarPushChannelsTable);
    const nullability = Object.fromEntries(
      tableConfig.columns.map((column) => [column.name, column.notNull]),
    );

    expect(nullability.accountId).toBe(true);
    expect(nullability.provider).toBe(true);
    expect(nullability.secretHash).toBe(true);
    expect(nullability.state).toBe(true);
    expect(nullability.userId).toBe(true);
    expect(nullability.failureCount).toBe(true);
  });

  it("starts a channel in the registering state", () => {
    const tableConfig = getTableConfig(calendarPushChannelsTable);
    const defaults = Object.fromEntries(
      tableConfig.columns.map((column) => [column.name, column.default]),
    );

    expect(defaults.state).toBe("registering");
    expect(defaults.failureCount).toBe(0);
  });

  it("stores only a hash, never a plaintext secret", () => {
    const tableConfig = getTableConfig(calendarPushChannelsTable);
    const columnNames = tableConfig.columns.map((column) => column.name);

    expect(columnNames).toContain("secretHash");
    expect(columnNames).not.toContain("secret");
    expect(columnNames).not.toContain("clientState");
    expect(columnNames).not.toContain("channelToken");
  });

  it("makes the provider channel identity index partial so it constrains real ids only", () => {
    const tableConfig = getTableConfig(calendarPushChannelsTable);
    const identityIndex = tableConfig.indexes.find(
      (index) => index.config.name === "calendar_push_channels_provider_channel_idx",
    );

    expect(identityIndex?.config.unique).toBe(true);
    expect(identityIndex?.config.where).toBeDefined();
    expect(columnNamesOf(identityIndex)).toEqual(["provider", "providerChannelId"]);
  });

  it("guarantees at most one live channel per provider and calendar", () => {
    const tableConfig = getTableConfig(calendarPushChannelsTable);
    const scopeIndex = tableConfig.indexes.find(
      (index) => index.config.name === "calendar_push_channels_scope_idx",
    );

    expect(scopeIndex?.config.unique).toBe(true);
    expect(scopeIndex?.config.where).toBeDefined();
    expect(columnNamesOf(scopeIndex)).toEqual(["provider", "calendarId"]);
  });

  it("indexes the renewal scan by state and expiry", () => {
    const tableConfig = getTableConfig(calendarPushChannelsTable);
    const expiryIndex = tableConfig.indexes.find(
      (index) => index.config.name === "calendar_push_channels_expiry_idx",
    );
    const accountIndex = tableConfig.indexes.find(
      (index) => index.config.name === "calendar_push_channels_account_idx",
    );

    expect(expiryIndex?.config.unique).toBe(false);
    expect(columnNamesOf(expiryIndex)).toEqual(["state", "expiresAt"]);
    expect(accountIndex).toBeDefined();
  });

  it("cascades away with the account, calendar and user it belongs to", () => {
    const tableConfig = getTableConfig(calendarPushChannelsTable);
    const actions = Object.fromEntries(
      tableConfig.foreignKeys.map((foreignKey) => [
        foreignKey.reference().columns[0]?.name,
        foreignKey.onDelete,
      ]),
    );

    expect(actions.accountId).toBe("cascade");
    expect(actions.calendarId).toBe("cascade");
    expect(actions.userId).toBe("cascade");
  });
});
