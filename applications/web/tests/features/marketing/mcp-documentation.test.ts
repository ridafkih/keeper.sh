import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  MCP_OAUTH_SCOPES,
  MCP_TOOL_GROUPS,
  REST_ENDPOINTS,
} from "@/features/marketing/mcp-documentation";
import { staticPageMetadata } from "@/lib/page-metadata";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");

const readRepositoryFile = (relativePath: string): string =>
  readFileSync(resolve(repositoryRoot, relativePath), "utf-8");

const TOOLSET_INTERFACE_PATTERN = /interface KeeperMcpToolset \{([\s\S]*?)\n\}/;
const TOOLSET_MEMBER_PATTERN = /^\s{2}(\w+):/gm;
const SCOPE_PATTERN = /"(keeper\.[\w.-]+)"/g;

function readToolNamesFromSource(): string[] {
  const source = readRepositoryFile("services/mcp/src/toolset.ts");
  const interfaceBody = TOOLSET_INTERFACE_PATTERN.exec(source)?.[1];

  if (!interfaceBody) {
    throw new Error("Could not find the KeeperMcpToolset interface in services/mcp/src/toolset.ts");
  }

  return [...interfaceBody.matchAll(TOOLSET_MEMBER_PATTERN)].map(([, name]) => name);
}

function readScopesFromSource(): string[] {
  const source = readRepositoryFile("packages/constants/src/constants/scopes.ts");
  return [...new Set([...source.matchAll(SCOPE_PATTERN)].map(([, scope]) => scope))];
}

const documentedTools = MCP_TOOL_GROUPS.flatMap((group) => group.tools.map((tool) => tool.name));

describe("MCP documentation tools", () => {
  it("documents every tool the MCP server registers, and no others", () => {
    expect([...documentedTools].sort()).toEqual([...readToolNamesFromSource()].sort());
  });

  it("lists each tool exactly once", () => {
    expect(new Set(documentedTools).size).toBe(documentedTools.length);
  });

  it("gives every tool a summary and an argument list", () => {
    for (const group of MCP_TOOL_GROUPS) {
      for (const tool of group.tools) {
        expect(tool.summary.length, `${tool.name} summary`).toBeGreaterThan(0);
        expect(tool.arguments.length, `${tool.name} arguments`).toBeGreaterThan(0);
      }
    }
  });
});

describe("MCP documentation scopes", () => {
  it("documents every Keeper API OAuth scope", () => {
    const documentedScopes = MCP_OAUTH_SCOPES.map((entry) => entry.scope);
    expect([...documentedScopes].sort()).toEqual([...readScopesFromSource()].sort());
  });
});

const API_ROUTES_DIRECTORY = "services/api/src/routes";

function routeFileCandidates(path: string): string[] {
  const segments = path
    .replace(/^\//, "")
    .split("/")
    .map((segment) => segment.replace(/^\{(.+)\}$/, "[$1]"));
  const base = `${API_ROUTES_DIRECTORY}/${segments.join("/")}`;
  return [`${base}.ts`, `${base}/index.ts`];
}

describe("REST API documentation", () => {
  it("has a route file behind every endpoint it lists", () => {
    for (const endpoint of REST_ENDPOINTS) {
      const candidates = routeFileCandidates(endpoint.path);
      const exists = candidates.some((candidate) =>
        existsSync(resolve(repositoryRoot, candidate)),
      );
      expect(exists, `${endpoint.method} ${endpoint.path} (${candidates.join(" or ")})`).toBe(true);
    }
  });

  it("lists each method and path pair once", () => {
    const keys = REST_ENDPOINTS.map((endpoint) => `${endpoint.method} ${endpoint.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("sitemap registration", () => {
  it("includes the documentation page in the static page list", () => {
    expect(staticPageMetadata.map((page) => page.path)).toContain("/docs/mcp");
  });
});
