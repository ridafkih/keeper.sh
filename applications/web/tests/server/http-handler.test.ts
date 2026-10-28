import { describe, expect, it, vi } from "vitest";
import { handleApplicationRequest, resolveCanonicalRedirect } from "../../src/server/http-handler";

const MOVED_PATHS: Record<string, string> = {
  "/blog/keeper-sh-vs-calendarbridge": "/compare/calendarbridge-alternative",
  "/blog/keeper-sh-vs-onecal": "/compare/onecal-alternative",
};

vi.mock("../../src/lib/moved-paths", () => ({
  resolveMovedPath: (pathname: string) => MOVED_PATHS[pathname] ?? null,
}));
import type { Runtime, ServerConfig } from "../../src/server/types";

const config: ServerConfig = {
  apiProxyOrigin: "http://api.test",
  mcpProxyOrigin: null,
  openaiAppsChallengeToken: null,
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
    renderMarkdown: async (path) => (path === MARKDOWN_PAGE_PATH ? MARKDOWN_BODY : null),
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

const MARKDOWN_PAGE_PATH = "/docs/plans-and-limits";
const MARKDOWN_BODY = "# Plans and limits\n";

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

describe("handleApplicationRequest markdown", () => {
  it("serves the markdown version of a content page at its .md path", async () => {
    const runtime = createRuntime([]);

    const response = await handleApplicationRequest(request(`${MARKDOWN_PAGE_PATH}.md`), runtime, config);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(response.headers.get("link")).toBe(`<https://www.keeper.sh${MARKDOWN_PAGE_PATH}>; rel="canonical"`);
    expect(await response.text()).toBe(MARKDOWN_BODY);
    expect(runtime.renderApp).not.toHaveBeenCalled();
  });

  it("serves markdown when the Accept header prefers it", async () => {
    const runtime = createRuntime([MARKDOWN_PAGE_PATH]);

    const response = await handleApplicationRequest(
      request(MARKDOWN_PAGE_PATH, { accept: "text/markdown, text/html;q=0.5" }),
      runtime,
      config,
    );

    expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(response.headers.get("vary")).toBe("accept, accept-encoding");
    expect(response.headers.get("cache-control")).toBe("private, max-age=600");
    expect(await response.text()).toBe(MARKDOWN_BODY);
  });

  it("serves HTML to browsers on the same path", async () => {
    const runtime = createRuntime([MARKDOWN_PAGE_PATH]);

    const response = await handleApplicationRequest(
      request(MARKDOWN_PAGE_PATH, { accept: "text/html,application/xhtml+xml,*/*;q=0.8" }),
      runtime,
      config,
    );

    expect(response.headers.get("content-type")).toContain("text/html");
    expect(runtime.renderApp).toHaveBeenCalledOnce();
  });

  it("sends markdown with the same security headers as pages", async () => {
    for (const markdownRequest of [
      request(`${MARKDOWN_PAGE_PATH}.md`),
      request(MARKDOWN_PAGE_PATH, { accept: "text/markdown" }),
    ]) {
      const response = await handleApplicationRequest(markdownRequest, createRuntime([]), config);

      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("content-security-policy")).toContain("default-src 'self'");
      expect(response.headers.get("set-cookie")).toBeNull();
    }
  });

  it("serves the same public document whether or not the reader is signed in", async () => {
    const response = await handleApplicationRequest(
      request(`${MARKDOWN_PAGE_PATH}.md`, { cookie: "better-auth.session_token=abc" }),
      createRuntime([]),
      config,
    );

    expect(await response.text()).toBe(MARKDOWN_BODY);
  });

  it("resolves dot segments before looking up a markdown page", async () => {
    const runtime = createRuntime([]);

    const response = await handleApplicationRequest(request("/blog/%2e%2e/docs/plans-and-limits.md"), runtime, config);

    expect(response.headers.get("link")).toBe(`<https://www.keeper.sh${MARKDOWN_PAGE_PATH}>; rel="canonical"`);
  });

  it("falls through to the app for a .md path with no content page", async () => {
    const runtime = createRuntime([]);

    await handleApplicationRequest(request("/docs/missing.md"), runtime, config);

    expect(runtime.renderApp).toHaveBeenCalledOnce();
  });
});

describe("resolveCanonicalRedirect", () => {
  it("permanently redirects trailing-slash paths to their canonical form", () => {
    const response = resolveCanonicalRedirect(new URL("https://www.keeper.sh/blog/"));
    expect(response?.status).toBe(308);
    expect(response?.headers.get("location")).toBe("/blog");
  });

  it("preserves the query string when normalizing a trailing slash", () => {
    const response = resolveCanonicalRedirect(new URL("https://www.keeper.sh/blog/?page=2"));
    expect(response?.headers.get("location")).toBe("/blog?page=2");
  });

  it("collapses repeated trailing slashes", () => {
    const response = resolveCanonicalRedirect(new URL("https://www.keeper.sh/blog///"));
    expect(response?.headers.get("location")).toBe("/blog");
  });

  it("permanently redirects the client shell to the site root", () => {
    const response = resolveCanonicalRedirect(new URL("https://www.keeper.sh/index.html"));
    expect(response?.status).toBe(308);
    expect(response?.headers.get("location")).toBe("/");
  });

  it("leaves the root path untouched", () => {
    expect(resolveCanonicalRedirect(new URL("https://www.keeper.sh/"))).toBeNull();
  });

  it("leaves canonical paths untouched", () => {
    expect(resolveCanonicalRedirect(new URL("https://www.keeper.sh/blog"))).toBeNull();
  });

  it("permanently redirects a moved comparison post to its /compare path", () => {
    const response = resolveCanonicalRedirect(
      new URL("https://www.keeper.sh/blog/keeper-sh-vs-calendarbridge"),
    );

    expect(response?.status).toBe(308);
    expect(response?.headers.get("location")).toBe("/compare/calendarbridge-alternative");
  });

  it("reaches the moved comparison post in one hop from a trailing slash", () => {
    const response = resolveCanonicalRedirect(
      new URL("https://www.keeper.sh/blog/keeper-sh-vs-onecal/?ref=newsletter"),
    );

    expect(response?.headers.get("location")).toBe(
      "/compare/onecal-alternative?ref=newsletter",
    );
  });
});

function cspDirectives(header: string): Map<string, string[]> {
  return new Map(
    header
      .split(";")
      .map((directive) => directive.trim())
      .filter((directive) => directive.length > 0)
      .map((directive) => {
        const [name, ...sources] = directive.split(/\s+/);
        return [name ?? "", sources] as const;
      }),
  );
}

async function productionCsp(): Promise<Map<string, string[]>> {
  const response = await handleApplicationRequest(request("/"), createRuntime([]), config);
  const header = response.headers.get("content-security-policy");
  if (!header) throw new Error("Expected a content-security-policy header in production");
  return cspDirectives(header);
}

describe("content security policy", () => {
  it("allows the hosts Google Analytics sends hits to", async () => {
    const directives = await productionCsp();

    expect(directives.get("connect-src")).toContain("https://*.google-analytics.com");
    expect(directives.get("connect-src")).toContain("https://*.analytics.google.com");
    expect(directives.get("img-src")).toContain("https://*.google-analytics.com");
  });

  it("allows the hosts Google Ads loads conversion scripts from", async () => {
    const scriptSrc = (await productionCsp()).get("script-src") ?? [];

    expect(scriptSrc).toContain("https://www.googletagmanager.com");
    expect(scriptSrc).toContain("https://www.googleadservices.com");
    expect(scriptSrc).toContain("https://googleads.g.doubleclick.net");
  });

  it("allows the hosts Google Ads pings conversions to over fetch", async () => {
    const connectSrc = (await productionCsp()).get("connect-src") ?? [];

    expect(connectSrc).toContain("https://www.googleadservices.com");
    expect(connectSrc).toContain("https://googleads.g.doubleclick.net");
    expect(connectSrc).toContain("https://ad.doubleclick.net");
    expect(connectSrc).toContain("https://www.google.com");
    expect(connectSrc).toContain("https://pagead2.googlesyndication.com");
  });

  it("allows the hosts Google Ads falls back to pixel pings on", async () => {
    const imgSrc = (await productionCsp()).get("img-src") ?? [];

    expect(imgSrc).toContain("https://www.googleadservices.com");
    expect(imgSrc).toContain("https://googleads.g.doubleclick.net");
    expect(imgSrc).toContain("https://www.google.com");
    expect(imgSrc).toContain("https://pagead2.googlesyndication.com");
  });
});
