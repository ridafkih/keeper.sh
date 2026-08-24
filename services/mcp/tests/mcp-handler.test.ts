import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createKeeperMcpHandler } from "../src/mcp-handler";
import { createKeeperMcpToolset } from "../src/toolset";

const toolset = createKeeperMcpToolset();

const listedToolSchema = z.object({
  name: z.string(),
  annotations: z.object({
    readOnlyHint: z.boolean(),
    destructiveHint: z.boolean().optional(),
    openWorldHint: z.boolean(),
  }),
});

const listToolsResultSchema = z.object({
  result: z.object({
    tools: z.array(listedToolSchema),
  }),
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
      apiBaseUrl: "https://keeper.sh",
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
      apiBaseUrl: "https://keeper.sh",
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
      apiBaseUrl: "https://keeper.sh",
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
          "Authorization": "Bearer test-token",
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
      apiBaseUrl: "https://keeper.sh",
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

  it("lists every tool with its annotations", async () => {
    const handler = createKeeperMcpHandler({
      auth: {
        api: {
          getMcpSession: () => Promise.resolve({
            scopes: "keeper.read",
            userId: "user-123",
          }),
        },
      },
      mcpPublicUrl: "https://mcp.keeper.sh",
      apiBaseUrl: "https://keeper.sh",
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
          "Accept": "application/json, text/event-stream",
          "Authorization": "Bearer test-token",
          "Content-Type": "application/json",
        },
        method: "POST",
      }),
    );

    const { result } = listToolsResultSchema.parse(await response.json());
    const annotationsByName = new Map(
      result.tools.map((tool) => [tool.name, tool.annotations]),
    );

    expect(annotationsByName.size).toBe(Object.keys(toolset).length);
    expect(annotationsByName.get("get_events")).toEqual({
      readOnlyHint: true,
      openWorldHint: false,
    });
    expect(annotationsByName.get("delete_event")).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: false,
    });
  });

  it("rethrows unexpected session errors", async () => {
    const handler = createKeeperMcpHandler({
      auth: {
        api: {
          getMcpSession: () => Promise.reject(new Error("database unavailable")),
        },
      },
      mcpPublicUrl: "https://mcp.keeper.sh",
      apiBaseUrl: "https://keeper.sh",
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
