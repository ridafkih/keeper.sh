import { describe, expect, it } from "vitest";
import {
  listSameAccountDestinations,
  proposeSync,
  resolveOrigin,
} from "../../../src/features/onboarding/sync-proposal";
import type { ProposalAccount, ProposalCalendar } from "../../../src/features/onboarding/sync-proposal";

const calendar = (
  id: string,
  accountId: string,
  capabilities: string[] = ["pull", "push"],
): ProposalCalendar => ({ accountId, capabilities, id, name: id });

const account = (id: string, createdAt: string): ProposalAccount => ({ createdAt, id });

describe("resolveOrigin", () => {
  it("starts from the first writable calendar of the first account connected", () => {
    const calendars = [
      calendar("holidays", "google", ["pull"]),
      calendar("work", "google"),
      calendar("personal", "icloud"),
    ];
    const accounts = [account("icloud", "2026-11-03T10:05:00Z"), account("google", "2026-11-03T10:00:00Z")];

    expect(resolveOrigin(calendars, accounts)?.id).toBe("work");
  });

  it("falls back to a read-only calendar when the first account has nothing writable", () => {
    const calendars = [calendar("feed", "ics", ["pull"])];
    expect(resolveOrigin(calendars, [account("ics", "2026-11-03T10:00:00Z")])?.id).toBe("feed");
  });

  it("has no origin before any calendar is connected", () => {
    expect(resolveOrigin([], [])).toBeNull();
  });
});

describe("proposeSync", () => {
  const accounts = [account("google", "2026-11-03T10:00:00Z"), account("icloud", "2026-11-03T10:05:00Z")];

  it("proposes copying both ways between the first and the newest account", () => {
    const proposal = proposeSync({
      accounts,
      calendars: [calendar("work", "google"), calendar("personal", "icloud")],
    });

    expect(proposal).toEqual({
      backward: true,
      destination: calendar("personal", "icloud"),
      forward: true,
      origin: calendar("work", "google"),
    });
  });

  it("copies only out of a read-only feed", () => {
    const proposal = proposeSync({
      accounts: [account("ics", "2026-11-03T10:00:00Z"), account("google", "2026-11-03T10:05:00Z")],
      calendars: [calendar("feed", "ics", ["pull"]), calendar("work", "google")],
    });

    expect(proposal).toMatchObject({ backward: false, forward: true });
    expect(proposal?.origin.id).toBe("feed");
    expect(proposal?.destination.id).toBe("work");
  });

  it("waits for a second calendar while only one account is connected", () => {
    expect(proposeSync({
      accounts: [accounts[0]!],
      calendars: [calendar("work", "google"), calendar("personal", "google")],
    })).toBeNull();
  });

  it("pairs with a calendar picked from the same account", () => {
    const proposal = proposeSync({
      accounts: [accounts[0]!],
      calendars: [calendar("work", "google"), calendar("personal", "google")],
      chosenDestinationId: "personal",
    });

    expect(proposal?.destination.id).toBe("personal");
    expect(proposal).toMatchObject({ backward: true, forward: true });
  });

  it("ignores a picked calendar that is the origin itself", () => {
    expect(proposeSync({
      accounts: [accounts[0]!],
      calendars: [calendar("work", "google")],
      chosenDestinationId: "work",
    })).toBeNull();
  });

  it("proposes nothing between two read-only feeds", () => {
    expect(proposeSync({
      accounts: [account("a", "2026-11-03T10:00:00Z"), account("b", "2026-11-03T10:05:00Z")],
      calendars: [calendar("a-feed", "a", ["pull"]), calendar("b-feed", "b", ["pull"])],
    })).toBeNull();
  });
});

describe("listSameAccountDestinations", () => {
  it("offers the other writable calendars of the origin's account", () => {
    const calendars = [
      calendar("work", "google"),
      calendar("personal", "google"),
      calendar("birthdays", "google", ["pull"]),
      calendar("elsewhere", "icloud"),
    ];

    expect(listSameAccountDestinations(calendars, calendar("work", "google")).map(({ id }) => id))
      .toEqual(["personal"]);
  });
});
