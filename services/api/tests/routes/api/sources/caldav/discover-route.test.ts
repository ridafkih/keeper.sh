import { describe, expect, it, vi } from "vitest";
import { CalDAVAuthenticationError } from "@keeper.sh/calendar/caldav";
import { handleCalDAVDiscoverRoute } from "../../../../../src/routes/api/sources/caldav/discover-route";
import type {
  CalDAVDiscoverCredentials,
  CalDAVDiscoverRouteDependencies,
} from "../../../../../src/routes/api/sources/caldav/discover-route";

const loggedFields = vi.hoisted(() => new Map<string, unknown>());

vi.mock("@/utils/logging", () => ({
  widelog: {
    errorFields: () => null,
    set: (key: string, value: unknown) => loggedFields.set(key, value),
  },
}));

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
          calendars: [{ ctag: "ctag-1", displayName: "Personal", url: "https://caldav.example.com/personal/", writable: true }],
        });
      },
    }));

    expect(response.status).toBe(200);
    expect(receivedCredentials).toEqual([credentials]);
    expect(await readJson(response)).toEqual({
      authMethod: "digest",
      calendars: [{ ctag: "ctag-1", displayName: "Personal", url: "https://caldav.example.com/personal/", writable: true }],
    });
  });

  it("maps an authentication failure to 401 with invalid credentials", async () => {
    const response = await handleCalDAVDiscoverRoute({ body: credentials }, createDependencies({
      discoverCalendars: () => Promise.reject(new CalDAVAuthenticationError(new Error("Invalid credentials"))),
    }));

    expect(response.status).toBe(401);
    expect(await readJson(response)).toEqual({ error: "Invalid credentials" });
  });

  it("records that the server rejected the credentials, and which server", async () => {
    loggedFields.clear();
    await handleCalDAVDiscoverRoute({ body: credentials }, createDependencies({
      discoverCalendars: () => Promise.reject(new CalDAVAuthenticationError(new Error("Invalid credentials"))),
    }));

    expect(loggedFields.get("caldav.failure")).toBe("invalid_credentials");
    expect(loggedFields.get("caldav.server_host")).toBe("caldav.example.com");
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
