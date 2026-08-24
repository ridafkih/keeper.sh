import { describe, expect, it } from "vitest";
import { isHostedCalDAVProvider } from "@keeper.sh/calendar";

describe("hosted CalDAV providers", () => {
  it("names the providers whose hostname every customer shares", () => {
    expect(isHostedCalDAVProvider("icloud")).toBe(true);
    expect(isHostedCalDAVProvider("fastmail")).toBe(true);
  });

  it("leaves a self-hosted server to be identified by its own hostname", () => {
    expect(isHostedCalDAVProvider("caldav")).toBe(false);
  });

  it("claims no provider that does not speak CalDAV", () => {
    expect(isHostedCalDAVProvider("google")).toBe(false);
    expect(isHostedCalDAVProvider("outlook")).toBe(false);
    expect(isHostedCalDAVProvider("ics")).toBe(false);
  });
});
