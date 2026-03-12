import fs from "node:fs/promises";
import path from "node:path";
import { getGithubStarsSnapshot } from "./github-stars";
import { proxyRequest } from "./proxy/http";

const staticTextFiles: Record<string, string> = {
  "/llms.txt": "text/plain; charset=UTF-8",
  "/llms-full.txt": "text/plain; charset=UTF-8",
};

const internalProxyPaths = {
  "/.well-known/oauth-authorization-server": "/api/auth/.well-known/oauth-authorization-server",
  "/.well-known/openid-configuration": "/api/auth/.well-known/openid-configuration",
} as const;

const resolveInternalProxyPath = (pathname: string): string | null =>
  internalProxyPaths[pathname as keyof typeof internalProxyPaths] ?? null;

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

export async function handleInternalRoute(
  request: Request,
  apiProxyOrigin: string,
): Promise<Response | null> {
  if (request.method !== "GET") {
    return null;
  }

  const requestUrl = new URL(request.url);
  const internalProxyPath = resolveInternalProxyPath(requestUrl.pathname);

  if (internalProxyPath) {
    const proxyUrl = new URL(request.url);
    proxyUrl.pathname = internalProxyPath;

    return proxyRequest(new Request(proxyUrl, request), apiProxyOrigin);
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
