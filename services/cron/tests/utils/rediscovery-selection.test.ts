import { describe, expect, it } from "vitest";
import {
  excludeAccountsWithoutImportedCalendars,
  excludeUnconfiguredCalDAVAccounts,
  selectAccountsDueForRediscovery,
} from "../../src/utils/rediscovery-selection";
import type { RediscoveryCandidate } from "../../src/utils/rediscovery-selection";

const NOW = new Date("2026-08-12T12:00:00.000Z");
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

const hoursAgo = (hours: number): Date =>
  new Date(NOW.getTime() - (hours * 60 * 60 * 1000));

const candidate = (
  id: string,
  calendarsRefreshAttemptedAt: Date | null,
  calendarsRefreshedAt: Date | null = calendarsRefreshAttemptedAt,
): RediscoveryCandidate => ({
  accountId: id,
  authType: "oauth",
  calendarsRefreshAttemptedAt,
  calendarsRefreshedAt,
  provider: "google",
  userId: "user-1",
} as RediscoveryCandidate);

const select = (
  candidates: RediscoveryCandidate[],
  batchLimit = 200,
) =>
  selectAccountsDueForRediscovery(candidates, {
    batchLimit,
    now: NOW,
    stalenessMs: SIX_HOURS_MS,
  });

describe("selectAccountsDueForRediscovery", () => {
  it("puts never-attempted accounts at the front of the queue", () => {
    const { due } = select([
      candidate("account-stale", hoursAgo(9)),
      candidate("account-never", null),
    ]);

    expect(due.map(({ accountId }) => accountId)).toEqual([
      "account-never",
      "account-stale",
    ]);
  });

  it("does not re-crawl an account whose last attempt failed but was recent", () => {
    const { due } = select([
      candidate("account-dead-server", hoursAgo(1), null),
      candidate("account-due", hoursAgo(7)),
    ]);

    expect(due.map(({ accountId }) => accountId)).toEqual(["account-due"]);
  });

  it("selects an account whose attempt is stale even though it succeeded recently", () => {
    const { due } = select([
      candidate("account-stale-attempt", hoursAgo(9), hoursAgo(1)),
    ]);

    expect(due.map(({ accountId }) => accountId)).toEqual(["account-stale-attempt"]);
  });

  it("never reads the success timestamp when deciding what is due", () => {
    const attemptedOnly = select([candidate("account-1", hoursAgo(9), null)]);
    const attemptedAndSucceeded = select([candidate("account-1", hoursAgo(9), hoursAgo(9))]);

    expect(attemptedOnly.due.map(({ accountId }) => accountId))
      .toEqual(attemptedAndSucceeded.due.map(({ accountId }) => accountId));

    const freshAttempt = select([candidate("account-2", hoursAgo(1), null)]);
    expect(freshAttempt.due).toEqual([]);
  });

  it("skips accounts attempted inside the staleness window", () => {
    const { due } = select([
      candidate("account-fresh", hoursAgo(1)),
      candidate("account-due", hoursAgo(7)),
    ]);

    expect(due.map(({ accountId }) => accountId)).toEqual(["account-due"]);
  });

  it("selects an account exactly at the staleness boundary", () => {
    const { due } = select([candidate("account-boundary", hoursAgo(6))]);

    expect(due.map(({ accountId }) => accountId)).toEqual(["account-boundary"]);
  });

  it("orders the due accounts oldest attempt first", () => {
    const { due } = select([
      candidate("account-recent", hoursAgo(7)),
      candidate("account-oldest", hoursAgo(50)),
      candidate("account-middle", hoursAgo(20)),
    ]);

    expect(due.map(({ accountId }) => accountId)).toEqual([
      "account-oldest",
      "account-middle",
      "account-recent",
    ]);
  });

  it("truncates to the batch limit and reports the truncation", () => {
    const { due, truncated } = select([
      candidate("account-1", hoursAgo(30)),
      candidate("account-2", hoursAgo(20)),
      candidate("account-3", hoursAgo(10)),
    ], 2);

    expect(due.map(({ accountId }) => accountId)).toEqual(["account-1", "account-2"]);
    expect(truncated).toBe(true);
  });

  it("reports no truncation when the whole queue fits", () => {
    const { due, truncated } = select([candidate("account-1", hoursAgo(30))]);

    expect(due).toHaveLength(1);
    expect(truncated).toBe(false);
  });

  it("handles an empty candidate list", () => {
    const { due, truncated } = select([]);

    expect(due).toEqual([]);
    expect(truncated).toBe(false);
  });
});

describe("excludeUnconfiguredCalDAVAccounts", () => {
  const caldav = (id: string): RediscoveryCandidate => ({
    ...candidate(id, null),
    authType: "caldav",
  });

  it("keeps every account when an encryption key is configured", () => {
    const candidates = [caldav("caldav-1"), candidate("oauth-1", null)];

    const { selectable, excluded } = excludeUnconfiguredCalDAVAccounts(candidates, true);

    expect(selectable).toEqual(candidates);
    expect(excluded).toBe(0);
  });

  it("drops CalDAV accounts entirely when no encryption key is configured", () => {
    const oauth = candidate("oauth-1", null);

    const { selectable, excluded } = excludeUnconfiguredCalDAVAccounts(
      [caldav("caldav-1"), oauth, caldav("caldav-2")],
      false,
    );

    expect(selectable).toEqual([oauth]);
    expect(excluded).toBe(2);
  });

  it("never lets an unconfigured CalDAV account occupy a batch slot", () => {
    const { selectable } = excludeUnconfiguredCalDAVAccounts(
      [caldav("caldav-1"), caldav("caldav-2"), candidate("oauth-1", hoursAgo(7))],
      false,
    );

    const { due } = select(selectable, 1);

    expect(due.map(({ accountId }) => accountId)).toEqual(["oauth-1"]);
  });
});

describe("excludeAccountsWithoutImportedCalendars", () => {
  const withImport = (
    id: string,
    hasImportedCalendar: boolean,
  ) => ({ ...candidate(id, null), hasImportedCalendar });

  it("keeps accounts whose calendar list has already been enumerated", () => {
    const enumerated = [withImport("source-1", true), withImport("source-2", true)];

    const { selectable, excluded } = excludeAccountsWithoutImportedCalendars(enumerated);

    expect(selectable).toEqual(enumerated);
    expect(excluded).toBe(0);
  });

  it("drops destination-only accounts that never went through calendar discovery", () => {
    const source = withImport("source-1", true);

    const { selectable, excluded } = excludeAccountsWithoutImportedCalendars([
      withImport("destination-only-1", false),
      source,
      withImport("destination-only-2", false),
    ]);

    expect(selectable).toEqual([source]);
    expect(excluded).toBe(2);
  });

  it("never lets a destination-only account occupy a batch slot", () => {
    const { selectable } = excludeAccountsWithoutImportedCalendars([
      withImport("destination-only-1", false),
      { ...candidate("source-1", hoursAgo(7)), hasImportedCalendar: true },
    ]);

    const { due } = select(selectable, 1);

    expect(due.map(({ accountId }) => accountId)).toEqual(["source-1"]);
  });
});
