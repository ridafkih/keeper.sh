import type { CalendarSource } from "../../../src/types/api";

export const makeSource = (
  id: string,
  accountId: string,
  capabilities: string[] = ["pull", "push"],
  overrides: Partial<CalendarSource> = {},
): CalendarSource => ({
  accountId,
  accountLabel: `${accountId}@example.com`,
  accountIdentifier: accountId,
  calendarType: "oauth",
  capabilities,
  disabled: false,
  displayName: null,
  email: null,
  id,
  includeInIcalFeed: false,
  name: id,
  needsReauthentication: false,
  provider: "google",
  providerIcon: null,
  providerMissingSince: null,
  providerName: "Google",
  unavailableSince: null,
  ...overrides,
});
