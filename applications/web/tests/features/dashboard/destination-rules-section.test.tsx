import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { CalendarSource, SourceDestinations } from "../../../src/types/api";
import { DestinationRulesSection } from "../../../src/features/dashboard/components/mapping-sync-rules/destination-rules-section";

const { swrData } = vi.hoisted(() => ({ swrData: new Map<string, unknown>() }));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children?: React.ReactNode; to?: string }) => (
    <a href={to}>{children}</a>
  ),
}));

vi.mock("swr", () => ({
  default: (key: string) => ({ data: swrData.get(key) }),
}));

const makeCalendar = (id: string, name: string): CalendarSource => ({
  accountId: "account-1",
  accountIdentifier: null,
  accountLabel: "Account",
  calendarType: "oauth",
  capabilities: ["pull", "push"],
  disabled: false,
  displayName: null,
  email: null,
  excludeEventName: true,
  id,
  includeInIcalFeed: false,
  name,
  needsReauthentication: false,
  provider: "google",
  providerIcon: null,
  providerMissingSince: null,
  providerName: "Google",
  unavailableSince: null,
});

const renderSection = (destinations?: SourceDestinations): string => {
  swrData.set("/api/sources", [
    makeCalendar("work", "Work"),
    makeCalendar("family", "Family"),
    makeCalendar("unmapped", "Side Project"),
  ]);
  if (destinations) {
    swrData.set("/api/sources/source-1/destinations", destinations);
  }
  return renderToStaticMarkup(
    <DestinationRulesSection accountId="account-1" calendarId="source-1" />,
  );
};

const linkText = (markup: string, href: string): string => {
  const start = markup.indexOf(`href="${href}"`);
  if (start === -1) throw new Error(`Link to ${href} was not rendered`);
  return markup.slice(start, markup.indexOf("</a>", start)).replace(/<[^>]+>/g, " ");
};

describe("DestinationRulesSection", () => {
  beforeEach(() => {
    swrData.clear();
  });

  it("renders nothing while the source has no destinations", () => {
    expect(renderSection({ customizedDestinationIds: [], destinationIds: [] })).toBe("");
  });

  it("renders nothing before the destinations have loaded", () => {
    expect(renderSection()).toBe("");
  });

  it("links each mapped destination to its own settings page", () => {
    const markup = renderSection({
      customizedDestinationIds: [],
      destinationIds: ["work", "family"],
    });

    expect(markup).toContain('href="/dashboard/accounts/account-1/source-1/destinations/work"');
    expect(markup).toContain('href="/dashboard/accounts/account-1/source-1/destinations/family"');
    expect(markup).not.toContain("Side Project");
  });

  it("marks which destinations are customized", () => {
    const markup = renderSection({
      customizedDestinationIds: ["family"],
      destinationIds: ["work", "family"],
    });

    expect(linkText(markup, "/dashboard/accounts/account-1/source-1/destinations/family"))
      .toContain("Customized");
    expect(linkText(markup, "/dashboard/accounts/account-1/source-1/destinations/work"))
      .toContain("Default");
  });
});
