import { describe, expect, it, vi } from "vitest";

const walks = vi.hoisted(() => ({ fetchCalendars: vi.fn() }));

vi.mock("tsdav", () => ({
  DAVNamespaceShort: { DAV: "d" },
  createDAVClient: () => Promise.resolve({
    fetchCalendars: walks.fetchCalendars,
  }),
}));

const { CalDAVClient } = await import("../../../src/providers/caldav/shared/client");

const DISCOVERED = [{
  components: ["VEVENT"],
  ctag: "1",
  displayName: "Work",
  url: "https://dav.example/work/",
}];

const makeClient = (cache?: {
  read: () => Promise<{ displayName: string; url: string }[] | null>;
  write: (calendars: { displayName: string; url: string }[]) => Promise<void>;
}) => new CalDAVClient({
  calendarDiscoveryCache: cache,
  credentials: { password: "secret", username: "rida" },
  serverUrl: "https://dav.example/",
});

describe("discovery cache against the client", () => {
  it("walks the server when nothing is cached, and records the result", async () => {
    walks.fetchCalendars.mockClear().mockResolvedValue(DISCOVERED);
    const write = vi.fn(() => Promise.resolve());
    const client = makeClient({ read: () => Promise.resolve(null), write });

    const calendars = await client.discoverCalendars();

    expect(walks.fetchCalendars).toHaveBeenCalledTimes(1);
    expect(calendars).toHaveLength(1);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("issues no discovery requests at all when the walk is cached", async () => {
    walks.fetchCalendars.mockClear().mockResolvedValue(DISCOVERED);
    const cached = [{ displayName: "Work", url: "https://dav.example/work/" }];
    const client = makeClient({ read: () => Promise.resolve(cached), write: () => Promise.resolve() });

    const calendars = await client.discoverCalendars();

    expect(walks.fetchCalendars).not.toHaveBeenCalled();
    expect(calendars).toEqual(cached);
  });

  it("still walks when no cache is supplied, so the refresh path stays live", async () => {
    walks.fetchCalendars.mockClear().mockResolvedValue(DISCOVERED);

    await makeClient().discoverCalendars();

    expect(walks.fetchCalendars).toHaveBeenCalledTimes(1);
  });
});
