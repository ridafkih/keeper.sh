import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpError, createHttpError } from "../../src/lib/fetcher";
import { resolveErrorMessage } from "../../src/utils/errors";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createHttpError", () => {
  it("surfaces the server message from the error envelope", async () => {
    const error = await createHttpError(
      jsonResponse(401, { error: "Invalid credentials" }),
      "/api/sources/caldav/discover",
    );

    expect(error.status).toBe(401);
    expect(error.url).toBe("/api/sources/caldav/discover");
    expect(error.serverMessage).toBe("Invalid credentials");
  });

  it("surfaces a better-auth style message envelope", async () => {
    const error = await createHttpError(
      jsonResponse(400, { message: "Password too short", code: "PASSWORD_TOO_SHORT" }),
      "/api/auth/sign-up/email",
    );

    expect(error.serverMessage).toBe("Password too short");
  });

  it("returns no message when the envelope carries a null error", async () => {
    const error = await createHttpError(jsonResponse(404, { error: null }), "/api/sources");

    expect(error.serverMessage).toBeNull();
  });

  it("withholds the server message for server errors", async () => {
    const error = await createHttpError(
      jsonResponse(500, { error: "connection to 10.0.0.4:5432 refused" }),
      "/api/sources",
    );

    expect(error.status).toBe(500);
    expect(error.serverMessage).toBeNull();
  });

  it("ignores empty and non-JSON bodies without reporting them", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const empty = await createHttpError(new Response("", { status: 403 }), "/api/sources");
    const html = await createHttpError(
      new Response("<html><body>Gateway</body></html>", { status: 429 }),
      "/api/sources",
    );

    expect(empty.serverMessage).toBeNull();
    expect(html.serverMessage).toBeNull();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("reports a malformed JSON body instead of throwing", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const error = await createHttpError(new Response("{oops", { status: 400 }), "/api/sources");

    expect(error.serverMessage).toBeNull();
    expect(consoleError).toHaveBeenCalled();
  });

  it("reports an already-consumed body instead of throwing", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = jsonResponse(400, { error: "Invalid credentials" });
    await response.text();

    const error = await createHttpError(response, "/api/sources");

    expect(error.serverMessage).toBeNull();
    expect(consoleError).toHaveBeenCalled();
  });

  it("keeps the status and url on the error message for diagnostics", async () => {
    const error = await createHttpError(
      jsonResponse(401, { error: "Invalid credentials" }),
      "/api/sources/caldav/discover",
    );

    expect(error.message).toBe("401 /api/sources/caldav/discover");
  });
});

describe("resolveErrorMessage", () => {
  it("shows the server message when there is one", () => {
    const error = new HttpError(401, "/api/sources/caldav/discover", "Invalid credentials");

    expect(resolveErrorMessage(error, "Failed to discover calendars")).toBe(
      "Invalid credentials",
    );
  });

  it("falls back to the caller message when the server sent none", () => {
    const error = new HttpError(500, "/api/sources/caldav/discover");

    expect(resolveErrorMessage(error, "Failed to discover calendars")).toBe(
      "Failed to discover calendars",
    );
  });

  it("preserves the message of non-HTTP errors", () => {
    expect(resolveErrorMessage(new Error("Network request failed"), "fallback")).toBe(
      "Network request failed",
    );
  });

  it("falls back for values that are not errors", () => {
    expect(resolveErrorMessage("nope", "fallback")).toBe("fallback");
  });
});
