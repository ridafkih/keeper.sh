import { describe, expect, it, vi } from "vitest";
import { handleApplicationRequest } from "../../src/server/http-handler";
import type { Runtime, ServerConfig } from "../../src/server/types";

const config: ServerConfig = {
  apiProxyOrigin: "http://api.test",
  mcpProxyOrigin: null,
  environment: "production",
  isProduction: true,
  serverPort: 4000,
  vitePort: 4001,
};

function createRuntime(cacheableHtmlPaths: string[], body = "<html>page</html>"): Runtime {
  return {
    cacheableHtmlPaths: new Set(cacheableHtmlPaths),
    handleAssetRequest: async () => new Response("Not Found", { status: 404 }),
    resolveViteAssets: async () => ({
      bodyScripts: [],
      headScripts: [],
      inlineStyles: [],
      modulePreloads: [],
      stylesheets: [],
    }),
    renderApp: vi.fn(async () =>
      new Response(body, { headers: { "content-type": "text/html; charset=UTF-8" } })),
  };
}

function createCountingRuntime(cacheableHtmlPaths: string[]): Runtime {
  let renderCount = 0;
  return {
    ...createRuntime(cacheableHtmlPaths),
    renderApp: vi.fn(async () => {
      renderCount += 1;
      return new Response(`<html>render ${renderCount}</html>`, {
        headers: { "content-type": "text/html; charset=UTF-8" },
      });
    }),
  };
}

function request(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost${path}`, { headers });
}

describe("handleApplicationRequest caching", () => {
  it("marks a known blog post publicly cacheable and validatable", async () => {
    const path = "/blog/known-post";
    const runtime = createRuntime([path]);

    const response = await handleApplicationRequest(request(path), runtime, config);

    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=0, s-maxage=600, stale-while-revalidate=86400",
    );
    expect(response.headers.get("etag")).toMatch(/^"[0-9a-f]+"$/);
    expect(response.headers.get("vary")).toBe("accept-encoding");
  });

  it("renders one shared document for every country and session", async () => {
    const path = "/blog/shared-post";
    const runtime = createRuntime([path]);

    const german = await handleApplicationRequest(
      request(path, { "cf-ipcountry": "DE" }),
      runtime,
      config,
    );
    const american = await handleApplicationRequest(
      request(path, { "cf-ipcountry": "US" }),
      runtime,
      config,
    );
    const authenticated = await handleApplicationRequest(
      request(path, { "cf-ipcountry": "US", cookie: "keeper.has_session=1" }),
      runtime,
      config,
    );

    const germanBody = await german.text();

    expect(await american.text()).toBe(germanBody);
    expect(await authenticated.text()).toBe(germanBody);
    expect(german.headers.get("etag")).toBe(american.headers.get("etag"));
    expect(runtime.renderApp).toHaveBeenCalledTimes(1);
  });

  it("serves a repeated blog post request from the cache without re-rendering", async () => {
    const path = "/blog/cached-post";
    const runtime = createRuntime([path]);

    await handleApplicationRequest(request(path), runtime, config);
    await handleApplicationRequest(request(path), runtime, config);

    expect(runtime.renderApp).toHaveBeenCalledTimes(1);
  });

  it("answers a matching conditional request with 304", async () => {
    const path = "/blog/conditional-post";
    const runtime = createRuntime([path]);

    const first = await handleApplicationRequest(request(path), runtime, config);
    const etag = first.headers.get("etag") ?? "";
    const second = await handleApplicationRequest(
      request(path, { "if-none-match": etag }),
      runtime,
      config,
    );

    expect(second.status).toBe(304);
    expect(second.headers.get("etag")).toBe(etag);
  });

  it("never caches or publicly labels an unknown blog slug", async () => {
    const runtime = createRuntime(["/blog/known-post"]);
    const path = "/blog/missing-post";

    const first = await handleApplicationRequest(request(path), runtime, config);
    await handleApplicationRequest(request(path), runtime, config);

    expect(first.headers.get("cache-control")).toBe("private, no-store");
    expect(first.headers.get("etag")).toBeNull();
    expect(runtime.renderApp).toHaveBeenCalledTimes(2);
  });

  it("keeps a marketing page private for a request carrying a session cookie", async () => {
    const path = "/blog/session-post";
    const runtime = createRuntime([path]);

    const response = await handleApplicationRequest(
      request(path, { cookie: "keeper.has_session=1" }),
      runtime,
      config,
    );

    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("etag")).toBeNull();
  });

  it("never lets a signed-in render reach the shared cache", async () => {
    const path = "/blog/authenticated-first-post";
    const runtime = createCountingRuntime([path]);

    const authenticated = await handleApplicationRequest(
      request(path, { cookie: "keeper.has_session=1" }),
      runtime,
      config,
    );
    const anonymous = await handleApplicationRequest(request(path), runtime, config);

    expect(await authenticated.text()).toBe("<html>render 1</html>");
    expect(await anonymous.text()).toBe("<html>render 2</html>");
    expect(runtime.renderApp).toHaveBeenCalledTimes(2);
  });

  it("serves an anonymous render to a later signed-in visitor", async () => {
    const path = "/blog/anonymous-first-post";
    const runtime = createCountingRuntime([path]);

    await handleApplicationRequest(request(path), runtime, config);
    const authenticated = await handleApplicationRequest(
      request(path, { cookie: "keeper.has_session=1" }),
      runtime,
      config,
    );

    expect(await authenticated.text()).toBe("<html>render 1</html>");
    expect(authenticated.headers.get("cache-control")).toBe("private, no-store");
    expect(authenticated.headers.get("etag")).toBeNull();
    expect(runtime.renderApp).toHaveBeenCalledTimes(1);
  });

  it("keeps dashboard responses out of every cache", async () => {
    const runtime = createRuntime(["/"]);

    const response = await handleApplicationRequest(
      request("/dashboard", { cookie: "keeper.has_session=1" }),
      runtime,
      config,
    );

    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("keeps redirects out of every cache", async () => {
    const runtime: Runtime = {
      ...createRuntime(["/"]),
      renderApp: async () => new Response(null, { status: 307, headers: { location: "/login" } }),
    };

    const response = await handleApplicationRequest(request("/dashboard"), runtime, config);

    expect(response.status).toBe(307);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
