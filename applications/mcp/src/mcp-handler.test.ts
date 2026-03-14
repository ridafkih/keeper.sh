import { describe, expect, it } from "bun:test";
import { createKeeperMcpHandler } from "./mcp-handler";
import { createKeeperMcpToolset } from "./toolset";

const toolset = createKeeperMcpToolset({
  getEventCount: () => Promise.resolve(0),
  getEvent: () => Promise.resolve(null),
  getEventsInRange: () => Promise.resolve([]),
  getSyncStatuses: () => Promise.resolve([]),
  listDestinations: () => Promise.resolve([]),
  listMappings: () => Promise.resolve([]),
  listSources: () => Promise.resolve([]),
  createEvent: () => Promise.resolve({ success: false, error: "not implemented" }),
  updateEvent: () => Promise.resolve({ success: false, error: "not implemented" }),
  deleteEvent: () => Promise.resolve({ success: false, error: "not implemented" }),
  rsvpEvent: () => Promise.resolve({ success: false, error: "not implemented" }),
});

describe("createKeeperMcpHandler", () => {
  it("returns protected-resource metadata when authentication is missing", async () => {
    const handler = createKeeperMcpHandler({
      auth: {
        api: {
          getMcpSession: () => Promise.resolve(null),
        },
      },
      mcpPublicUrl: "https://mcp.keeper.sh",
      toolset,
    });

    const response = await handler(
      new Request("https://mcp.keeper.sh/mcp", {
        body: JSON.stringify({
          id: "1",
          jsonrpc: "2.0",
          method: "tools/list",
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain(
      'resource_metadata="https://mcp.keeper.sh/.well-known/oauth-protected-resource"',
    );
  });

  it("supports unauthenticated GET with an OAuth challenge instead of 405", async () => {
    const handler = createKeeperMcpHandler({
      auth: {
        api: {
          getMcpSession: () => Promise.resolve(null),
        },
      },
      mcpPublicUrl: "https://mcp.keeper.sh",
      toolset,
    });

    const response = await handler(
      new Request("https://mcp.keeper.sh/mcp", {
        method: "GET",
      }),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain(
      'resource_metadata="https://mcp.keeper.sh/.well-known/oauth-protected-resource"',
    );
  });

  it("returns insufficient scope metadata when keeper.read is missing", async () => {
    const handler = createKeeperMcpHandler({
      auth: {
        api: {
          getMcpSession: () => Promise.resolve({
            scopes: "openid profile",
            userId: "user-123",
          }),
        },
      },
      mcpPublicUrl: "https://mcp.keeper.sh",
      toolset,
    });

    const response = await handler(
      new Request("https://mcp.keeper.sh/mcp", {
        body: JSON.stringify({
          id: "1",
          jsonrpc: "2.0",
          method: "tools/list",
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("WWW-Authenticate")).toContain('error="insufficient_scope"');
    expect(response.headers.get("WWW-Authenticate")).toContain('scope="keeper.read"');
  });

  it("returns unauthorized challenge when token verification throws", async () => {
    const authValidationError = new Error("invalid token");
    authValidationError.name = "APIError";

    const handler = createKeeperMcpHandler({
      auth: {
        api: {
          getMcpSession: () => Promise.reject(authValidationError),
        },
      },
      mcpPublicUrl: "https://mcp.keeper.sh",
      toolset,
    });

    const response = await handler(
      new Request("https://mcp.keeper.sh/mcp", {
        method: "GET",
      }),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain(
      'resource_metadata="https://mcp.keeper.sh/.well-known/oauth-protected-resource"',
    );
  });

  it("rethrows unexpected session errors", async () => {
    const handler = createKeeperMcpHandler({
      auth: {
        api: {
          getMcpSession: () => Promise.reject(new Error("database unavailable")),
        },
      },
      mcpPublicUrl: "https://mcp.keeper.sh",
      toolset,
    });

    await expect(
      handler(
        new Request("https://mcp.keeper.sh/mcp", {
          method: "GET",
        }),
      ),
    ).rejects.toThrow("database unavailable");
  });
});
