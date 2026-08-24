import fs from "node:fs/promises";
import path from "node:path";
import { KEEPER_API_RESOURCE_SCOPES } from "@keeper.sh/constants";
import { GDPR_COUNTRIES } from "@/config/gdpr";
import { getGithubStarsSnapshot } from "./github-stars";
import { proxyRequest } from "./proxy/http";
import type { ServerConfig } from "./types";

const staticTextFiles: Record<string, string> = {
  "/llms.txt": "text/plain; charset=UTF-8",
  "/llms-full.txt": "text/plain; charset=UTF-8",
};

// OAuth clients discover the authorization server via /.well-known/* at
// the resource origin. The auth server lives under /api/auth, so these
// mappings proxy the well-known paths to the correct internal routes.
const internalProxyPaths = {
  "/.well-known/oauth-authorization-server": "/api/auth/.well-known/oauth-authorization-server",
  "/.well-known/openid-configuration": "/api/auth/.well-known/openid-configuration",
  "/.well-known/oauth-authorization-server/api/auth":
    "/api/auth/.well-known/oauth-authorization-server",
  "/.well-known/openid-configuration/api/auth":
    "/api/auth/.well-known/openid-configuration",
} as const;

const isInternalProxyPath = (
  pathname: string,
): pathname is keyof typeof internalProxyPaths =>
  pathname in internalProxyPaths;

const resolveInternalProxyPath = (pathname: string): string | null => {
  if (isInternalProxyPath(pathname)) return internalProxyPaths[pathname];
  return null;
};

const buildProtectedResourceMetadata = (requestOrigin: string) => ({
  resource: `${requestOrigin}/mcp`,
  authorization_servers: [`${requestOrigin}/api/auth`],
  scopes_supported: KEEPER_API_RESOURCE_SCOPES,
});

const MCP_SERVER_CARD_PATH = "/mcp/server-card";
const MCP_SERVER_CARD_MEDIA_TYPE = "application/mcp-server-card+json";
// SEP-2127 pins this exact string through the `$schema` pattern, so it stays as
// written even though it does not resolve until the proposal merges.
const MCP_SERVER_CARD_SCHEMA =
  "https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json";
const MCP_SERVER_NAMESPACE = "sh.keeper";
const MCP_SERVER_NAME = "keeper";
const MCP_SERVER_VERSION = "1.0.0";

/* The same icon set server.json publishes to the registry, so the two
   descriptions of this server agree. SEP-2127 types `sizes` and `mimeType`
   loosely, but the registry schema constrains both, so these stay in the
   stricter shape rather than drifting into one the registry would reject.
   `theme` is the background the icon is drawn on, not the colour of the
   mark: the "light" icons are the dark-ink ones. */
const MCP_SERVER_ICON_SIZES = [48, 96, 192, 512] as const;

const buildMcpServerIcons = (requestOrigin: string) =>
  (["light", "dark"] as const).flatMap((theme) =>
    MCP_SERVER_ICON_SIZES.map((size) => ({
      src: `${requestOrigin}/${size}x${size}-on-${theme}.png`,
      mimeType: "image/png",
      sizes: [`${size}x${size}`],
      theme,
    })),
  );

const buildMcpServerCard = (requestOrigin: string) => ({
  $schema: MCP_SERVER_CARD_SCHEMA,
  name: `${MCP_SERVER_NAMESPACE}/${MCP_SERVER_NAME}`,
  version: MCP_SERVER_VERSION,
  title: "Keeper.sh",
  description: "Read and write your connected calendars from an AI agent.",
  websiteUrl: requestOrigin,
  repository: {
    url: "https://github.com/ridafkih/keeper.sh",
    source: "github",
  },
  icons: buildMcpServerIcons(requestOrigin),
  remotes: [
    {
      type: "streamable-http",
      url: `${requestOrigin}/mcp`,
    },
  ],
});

async function serveStaticTextFile(pathname: string): Promise<Response | null> {
  const contentType = staticTextFiles[pathname];
  if (!contentType) return null;

  const filePath = path.resolve(process.cwd(), `public${pathname}`);
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return new Response(content, {
      headers: {
        "content-type": contentType,
        "cache-control": "public, max-age=3600",
      },
    });
  } catch {
    return new Response("Not Found", { status: 404 });
  }
}

const resolvePublicOrigin = (request: Request): string => {
  const url = new URL(request.url);
  const proto = request.headers.get("x-forwarded-proto");
  const host = request.headers.get("x-forwarded-host");

  if (proto) {
    url.protocol = proto;
  }

  if (host) {
    url.host = host;
  }

  return url.origin;
};

export async function handleInternalRoute(
  request: Request,
  config: ServerConfig,
): Promise<Response | null> {
  if (request.method !== "GET") {
    return null;
  }

  const requestUrl = new URL(request.url);

  if (requestUrl.pathname === "/.well-known/oauth-protected-resource") {
    return Response.json(buildProtectedResourceMetadata(resolvePublicOrigin(request)));
  }

  if (requestUrl.pathname === MCP_SERVER_CARD_PATH) {
    return new Response(JSON.stringify(buildMcpServerCard(resolvePublicOrigin(request))), {
      headers: {
        "content-type": MCP_SERVER_CARD_MEDIA_TYPE,
        "cache-control": "public, max-age=3600",
      },
    });
  }

  const internalProxyPath = resolveInternalProxyPath(requestUrl.pathname);

  if (internalProxyPath) {
    const proxyUrl = new URL(request.url);
    proxyUrl.pathname = internalProxyPath;

    return proxyRequest(new Request(proxyUrl, request), config.apiProxyOrigin);
  }

  if (requestUrl.pathname === "/internal/geo") {
    const countryCode = request.headers.get("cf-ipcountry") ?? "";
    const gdprApplies = config.environment === "development" || GDPR_COUNTRIES.has(countryCode);

    return Response.json(
      { gdprApplies },
      {
        headers: {
          "cache-control": "private, no-store",
          vary: "cf-ipcountry",
        },
      },
    );
  }

  if (requestUrl.pathname === "/internal/github-stars") {
    try {
      const snapshot = await getGithubStarsSnapshot();
      return Response.json(snapshot, {
        headers: {
          "cache-control": "no-store",
        },
      });
    } catch {
      return Response.json(
        { message: "Unable to read GitHub stars." },
        { status: 502 },
      );
    }
  }

  const staticResponse = await serveStaticTextFile(requestUrl.pathname);
  if (staticResponse) return staticResponse;

  return null;
}

export { resolveInternalProxyPath };
