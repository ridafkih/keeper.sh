import { describe, expect, it } from "bun:test";
import {
  DEFAULT_SOURCE_SYNC_RULES,
  applySourceSyncDefaults,
} from "../../src/utils/source-sync-defaults";

describe("DEFAULT_SOURCE_SYNC_RULES", () => {
  it("disables event title, description, and location sync and includes sources in iCal by default", () => {
    expect(DEFAULT_SOURCE_SYNC_RULES).toEqual({
      customEventName: "{{calendar_name}}",
      excludeEventDescription: true,
      excludeEventLocation: true,
      excludeEventName: true,
      includeInIcalFeed: true,
    });
  });

  it("applies source defaults while preserving additional calendar fields", () => {
    const values = applySourceSyncDefaults({
      accountId: "account-1",
      name: "Team Calendar",
      userId: "user-1",
    });

    expect(values).toEqual({
      accountId: "account-1",
      customEventName: "{{calendar_name}}",
      excludeEventDescription: true,
      excludeEventLocation: true,
      excludeEventName: true,
      includeInIcalFeed: true,
      name: "Team Calendar",
      userId: "user-1",
    });
  });
});
