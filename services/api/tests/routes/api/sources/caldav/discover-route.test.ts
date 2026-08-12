import { describe, expect, it } from "vitest";
import { CalDAVAuthenticationError } from "@keeper.sh/calendar/caldav";
import { handleCalDAVDiscoverRoute } from "../../../../../src/routes/api/sources/caldav/discover-route";
import type {
  CalDAVDiscoverCredentials,
  CalDAVDiscoverRouteDependencies,
} from "../../../../../src/routes/api/sources/caldav/discover-route";

const readJson = (response: Response): Promise<unknown> => response.json();

const credentials: CalDAVDiscoverCredentials = {
  password: "hunter2",
  serverUrl: "https://caldav.example.com",
  username: "user",
};

const createDependencies = (
  overrides: Partial<CalDAVDiscoverRouteDependencies> = {},
): CalDAVDiscoverRouteDependencies => ({
  discoverCalendars: () => Promise.resolve({ authMethod: "basic", calendars: [] }),
  parseDiscoverBody: () => credentials,
  ...overrides,
});

describe("handleCalDAVDiscoverRoute", () => {
  it("returns discovered calendars and the resolved auth method", async () => {
    const receivedCredentials: CalDAVDiscoverCredentials[] = [];

    const response = await handleCalDAVDiscoverRoute({ body: credentials }, createDependencies({
      discoverCalendars: (value) => {
        receivedCredentials.push(value);
        return Promise.resolve({
          authMethod: "digest",
          calendars: [{ ctag: "ctag-1", displayName: "Personal", url: "https://caldav.example.com/personal/" }],
        });
      },
    }));

    expect(response.status).toBe(200);
    expect(receivedCredentials).toEqual([credentials]);
    expect(await readJson(response)).toEqual({
      authMethod: "digest",
      calendars: [{ ctag: "ctag-1", displayName: "Personal", url: "https://caldav.example.com/personal/" }],
    });
  });

  it("maps an authentication failure to 401 with invalid credentials", async () => {
    const response = await handleCalDAVDiscoverRoute({ body: credentials }, createDependencies({
      discoverCalendars: () => Promise.reject(new CalDAVAuthenticationError(new Error("Invalid credentials"))),
    }));

    expect(response.status).toBe(401);
    expect(await readJson(response)).toEqual({ error: "Invalid credentials" });
  });

  it("maps other discovery failures to 400", async () => {
    const response = await handleCalDAVDiscoverRoute({ body: credentials }, createDependencies({
      discoverCalendars: () => Promise.reject(new Error("getaddrinfo ENOTFOUND caldav.example.com")),
    }));

    expect(response.status).toBe(400);
    expect(await readJson(response)).toEqual({ error: "Failed to discover calendars" });
  });

  it("maps invalid request bodies to 400", async () => {
    const response = await handleCalDAVDiscoverRoute({ body: {} }, createDependencies({
      parseDiscoverBody: () => {
        throw new Error("serverUrl must be a string");
      },
    }));

    expect(response.status).toBe(400);
    expect(await readJson(response)).toEqual({ error: "Failed to discover calendars" });
  });
});
