import { describe, expect, it } from "bun:test";
import {
  handleGetIcsSourcesRoute,
  handlePostIcsSourceRoute,
} from "./source-routes";

const readJson = (response: Response): Promise<unknown> => response.json();

class TestSourceLimitError extends Error {}

class TestInvalidSourceUrlError extends Error {
  public readonly authRequired: boolean;

  constructor(message: string, authRequired: boolean) {
    super(message);
    this.authRequired = authRequired;
  }
}

describe("handleGetIcsSourcesRoute", () => {
  it("returns user sources for the authenticated user", async () => {
    const receivedUserIds: string[] = [];

    const response = await handleGetIcsSourcesRoute(
      { userId: "user-1" },
      {
        getUserSources: (userId) => {
          receivedUserIds.push(userId);
          return Promise.resolve([{ id: "source-1" }]);
        },
      },
    );

    expect(response.status).toBe(200);
    expect(receivedUserIds).toEqual(["user-1"]);
    expect(await readJson(response)).toEqual([{ id: "source-1" }]);
  });
});

describe("handlePostIcsSourceRoute", () => {
  it("creates source with parsed body and returns 201", async () => {
    const receivedCreateCalls: { userId: string; name: string; url: string }[] = [];

    const response = await handlePostIcsSourceRoute(
      {
        body: { name: "Team Calendar", url: "https://example.com/feed.ics" },
        userId: "user-1",
      },
      {
        createSource: (userId, name, url) => {
          receivedCreateCalls.push({ userId, name, url });
          return Promise.resolve({ id: "source-1", name });
        },
        isInvalidSourceUrlError: (_error): _error is TestInvalidSourceUrlError => false,
        isSourceLimitError: () => false,
        parseCreateSourceBody: (body) => {
          if (
            typeof body === "object"
            && body !== null
            && "name" in body
            && "url" in body
            && typeof body.name === "string"
            && typeof body.url === "string"
          ) {
            return { name: body.name, url: body.url };
          }

          throw new Error("Invalid payload");
        },
      },
    );

    expect(response.status).toBe(201);
    expect(receivedCreateCalls).toEqual([
      { name: "Team Calendar", url: "https://example.com/feed.ics", userId: "user-1" },
    ]);
    expect(await readJson(response)).toEqual({ id: "source-1", name: "Team Calendar" });
  });

  it("maps source-limit errors to payment required", async () => {
    const response = await handlePostIcsSourceRoute(
      {
        body: { name: "Team Calendar", url: "https://example.com/feed.ics" },
        userId: "user-1",
      },
      {
        createSource: () =>
          Promise.reject(new TestSourceLimitError("plan limit reached")),
        isInvalidSourceUrlError: (_error): _error is TestInvalidSourceUrlError => false,
        isSourceLimitError: (error) => error instanceof TestSourceLimitError,
        parseCreateSourceBody: () => ({
          name: "Team Calendar",
          url: "https://example.com/feed.ics",
        }),
      },
    );

    expect(response.status).toBe(402);
  });

  it("maps invalid-source-url errors to bad request with authRequired flag", async () => {
    const response = await handlePostIcsSourceRoute(
      {
        body: { name: "Team Calendar", url: "https://example.com/feed.ics" },
        userId: "user-1",
      },
      {
        createSource: () =>
          Promise.reject(new TestInvalidSourceUrlError("requires auth", true)),
        isInvalidSourceUrlError: (error): error is TestInvalidSourceUrlError =>
          error instanceof TestInvalidSourceUrlError,
        isSourceLimitError: () => false,
        parseCreateSourceBody: () => ({
          name: "Team Calendar",
          url: "https://example.com/feed.ics",
        }),
      },
    );

    expect(response.status).toBe(400);
    expect(await readJson(response)).toEqual({
      authRequired: true,
      error: "requires auth",
    });
  });

  it("maps body parse failures to bad request", async () => {
    const response = await handlePostIcsSourceRoute(
      {
        body: { bad: true },
        userId: "user-1",
      },
      {
        createSource: () => Promise.resolve({ id: "source-1" }),
        isInvalidSourceUrlError: (_error): _error is TestInvalidSourceUrlError => false,
        isSourceLimitError: () => false,
        parseCreateSourceBody: () => {
          throw new Error("parse failed");
        },
      },
    );

    expect(response.status).toBe(400);
  });
});
