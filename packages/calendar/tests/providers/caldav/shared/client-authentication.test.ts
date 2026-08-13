import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CalDAVAuthenticationError,
  CalDAVClient,
} from "../../../../src/providers/caldav/shared/client";

const fetchMocks = vi.hoisted(() => ({
  safeFetch: vi.fn(),
}));

vi.mock("../../../../src/utils/safe-fetch", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createSafeFetch: () => fetchMocks.safeFetch,
}));

const unauthorizedResponse = (): Response =>
  new Response("", { status: 401, statusText: "Unauthorized" });

const captureRejection = async (operation: () => Promise<unknown>): Promise<unknown> => {
  try {
    await operation();
  } catch (error) {
    return error;
  }

  throw new Error("expected the operation to reject");
};

const createClient = () =>
  new CalDAVClient({
    credentials: { password: "wrong-password", username: "user" },
    serverUrl: "https://caldav.example.com",
  });

describe("CalDAVClient authentication failures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws a typed authentication error when the server answers 401", async () => {
    fetchMocks.safeFetch.mockImplementation(() => Promise.resolve(unauthorizedResponse()));

    await expect(createClient().discoverCalendars()).rejects.toBeInstanceOf(CalDAVAuthenticationError);
  });

  it("carries a 401 status the caller can branch on without reading the message", async () => {
    fetchMocks.safeFetch.mockImplementation(() => Promise.resolve(unauthorizedResponse()));

    const error = await captureRejection(() => createClient().discoverCalendars());

    expect(error).toMatchObject({ name: "CalDAVAuthenticationError", status: 401 });
    expect((error as CalDAVAuthenticationError).cause).toBeInstanceOf(Error);
  });

  it("leaves non-authentication failures untouched", async () => {
    fetchMocks.safeFetch.mockImplementation(() =>
      Promise.resolve(new Response("", { status: 500, statusText: "Server Error" })));

    const error = await captureRejection(() => createClient().discoverCalendars());

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(CalDAVAuthenticationError);
  });
});
