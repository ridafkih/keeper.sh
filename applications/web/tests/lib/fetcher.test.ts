import { afterEach, describe, expect, it, vi } from "vitest";
import { readApiErrorMessage } from "@keeper.sh/data-schemas";
import { apiFetch, fetcher, HttpError } from "../../src/lib/fetcher";
import { createJsonFetcher } from "../../src/lib/json-fetcher";
import { resolveErrorMessage } from "../../src/utils/errors";

const THROTTLE_MESSAGE = "A refresh was already requested recently. Try again in 42 seconds.";

const stubFetch = (respond: () => Response): void => {
  vi.stubGlobal("fetch", () => Promise.resolve(respond()));
};

const captureError = async (operation: () => Promise<unknown>): Promise<unknown> => {
  try {
    await operation();
  } catch (error) {
    return error;
  }
  throw new Error("Expected the request to reject");
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HttpError", () => {
  it("carries the server error body through apiFetch", async () => {
    stubFetch(() =>
      Response.json({ error: THROTTLE_MESSAGE }, { status: 429 }));

    const error = await captureError(() =>
      apiFetch("/api/accounts/account-1/refresh-calendars", { method: "POST" }));

    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(429);
    expect((error as HttpError).body).toEqual({ error: THROTTLE_MESSAGE });
  });

  it("carries the server error body through fetcher", async () => {
    stubFetch(() => Response.json({ error: "Account not found" }, { status: 404 }));

    const error = await captureError(() => fetcher("/api/accounts/account-1"));

    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).body).toEqual({ error: "Account not found" });
  });

  it("leaves the body undefined when the server did not send JSON", async () => {
    stubFetch(() => new Response("<html>gateway timeout</html>", { status: 504 }));

    const error = await captureError(() =>
      apiFetch("/api/accounts/account-1/refresh-calendars", { method: "POST" }));

    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).body).toBeUndefined();
  });

  it("still resolves the response for a successful request", async () => {
    stubFetch(() => Response.json({ added: [] }, { status: 200 }));

    const response = await apiFetch("/api/accounts/account-1/refresh-calendars", {
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ added: [] });
  });
});

describe("resolveErrorMessage", () => {
  it("shows the server message instead of the status code", async () => {
    stubFetch(() => Response.json({ error: THROTTLE_MESSAGE }, { status: 429 }));

    const error = await captureError(() =>
      apiFetch("/api/accounts/account-1/refresh-calendars", { method: "POST" }));

    expect(resolveErrorMessage(error, "Failed to refresh calendars"))
      .toBe(THROTTLE_MESSAGE);
  });

  it("falls back to the error message when the server sent no JSON error", async () => {
    stubFetch(() => new Response("<html>gateway timeout</html>", { status: 504 }));

    const error = await captureError(() =>
      apiFetch("/api/accounts/account-1/refresh-calendars", { method: "POST" }));

    expect(resolveErrorMessage(error, "Failed to refresh calendars"))
      .toBe("504 /api/accounts/account-1/refresh-calendars");
  });

  it("falls back to the caller message for a non-error value", () => {
    expect(resolveErrorMessage("nope", "Failed to refresh calendars"))
      .toBe("Failed to refresh calendars");
  });

  it("ignores a non-string error field on the body", async () => {
    stubFetch(() => Response.json({ error: { code: 42 } }, { status: 400 }));

    const error = await captureError(() =>
      apiFetch("/api/accounts/account-1/refresh-calendars", { method: "POST" }));

    expect(resolveErrorMessage(error, "Failed to refresh calendars"))
      .toBe("400 /api/accounts/account-1/refresh-calendars");
  });
});

describe("readApiErrorMessage", () => {
  it("reads the message from the shared API error shape", () => {
    expect(readApiErrorMessage({ error: "Account not found" })).toBe("Account not found");
  });

  it.each([
    ["a null message", { error: null }],
    ["a non-string message", { error: { code: 42 } }],
    ["a body without an error field", { added: [] }],
    ["a non-object body", "boom"],
    ["a null body", null],
    ["an undefined body", undefined],
  ])("returns null for %s", (_label, body) => {
    expect(readApiErrorMessage(body)).toBeNull();
  });
});

describe("createJsonFetcher", () => {
  it("carries the server error body on the server-rendered fetch path", async () => {
    stubFetch(() => Response.json({ error: "Account not found" }, { status: 404 }));

    const fetchApi = createJsonFetcher(null, "https://api.keeper.sh");
    const error = await captureError(() => fetchApi("/api/accounts/account-1"));

    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).body).toEqual({ error: "Account not found" });
    expect(resolveErrorMessage(error, "Failed to load the account")).toBe("Account not found");
  });
});
