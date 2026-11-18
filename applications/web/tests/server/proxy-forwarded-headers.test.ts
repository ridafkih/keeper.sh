import { createServer } from "node:http";
import type { IncomingHttpHeaders, Server } from "node:http";
import { afterAll, describe, expect, it } from "vitest";
import { proxyRequest, toForwardedHeaders } from "../../src/server/proxy/http";

interface ReceivedRequest {
  body: string;
  headers: IncomingHttpHeaders;
  method: string;
  url: string;
}

const received: ReceivedRequest[] = [];

const upstream: Server = createServer((request, response) => {
  const chunks: Buffer[] = [];
  request.on("data", (chunk: Buffer) => chunks.push(chunk));
  request.on("end", () => {
    received.push({
      body: Buffer.concat(chunks).toString("utf8"),
      headers: request.headers,
      method: request.method ?? "",
      url: request.url ?? "",
    });
    response.writeHead(200, { "content-type": "application/json" });
    response.end("{\"ok\":true}");
  });
});

const upstreamOrigin = await new Promise<string>((resolve) => {
  upstream.listen(0, "127.0.0.1", () => {
    const address = upstream.address();
    if (!address || typeof address === "string") {
      throw new Error("The test upstream did not bind to a port");
    }
    resolve(`http://127.0.0.1:${address.port}`);
  });
});

afterAll(() => {
  upstream.closeAllConnections();
  upstream.close();
});

const forward = async (init: RequestInit & { path?: string } = {}): Promise<ReceivedRequest> => {
  const { path = "/api/accounts?limit=5", ...requestInit } = init;
  const response = await proxyRequest(
    new Request(`https://keeper.example.com${path}`, requestInit),
    upstreamOrigin,
  );
  await response.text();
  const request = received[received.length - 1];
  if (!request) {
    throw new Error("The upstream received no request");
  }
  return request;
};

describe("toForwardedHeaders", () => {
  it("drops the header that only the edge and this server share", () => {
    const forwarded = toForwardedHeaders(new Headers({ "X-Origin-Auth": "shared-value" }));

    expect(forwarded.has("x-origin-auth")).toBe(false);
  });

  it("drops the host and hop-by-hop headers", () => {
    const forwarded = toForwardedHeaders(new Headers({
      connection: "keep-alive",
      host: "keeper.example.com",
      "keep-alive": "timeout=5",
      "proxy-authenticate": "Basic",
      "proxy-authorization": "Basic abc",
      te: "trailers",
      trailer: "Expires",
      "transfer-encoding": "chunked",
      upgrade: "h2c",
    }));

    expect([...forwarded.keys()]).toEqual([]);
  });

  it("keeps the headers the upstream services rely on", () => {
    const headers = {
      accept: "application/json",
      authorization: "Bearer token",
      "cf-connecting-ip": "203.0.113.7",
      "content-type": "application/json",
      cookie: "better-auth.session_token=abc",
      origin: "https://keeper.example.com",
      traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
      "x-forwarded-for": "203.0.113.7",
      "x-request-id": "request-1",
    };

    expect(Object.fromEntries(toForwardedHeaders(new Headers(headers)).entries())).toEqual(headers);
  });

  it("leaves the incoming headers untouched", () => {
    const incoming = new Headers({ "x-origin-auth": "shared-value" });

    toForwardedHeaders(incoming);

    expect(incoming.get("x-origin-auth")).toBe("shared-value");
  });
});

describe("proxyRequest", () => {
  it("does not pass the edge-only header to the upstream service", async () => {
    const request = await forward({
      headers: { cookie: "session=abc", "x-origin-auth": "shared-value" },
    });

    expect(request.headers).not.toHaveProperty("x-origin-auth");
    expect(JSON.stringify(request.headers)).not.toContain("shared-value");
  });

  it("still passes cookies, authorization and client address headers", async () => {
    const request = await forward({
      headers: {
        authorization: "Bearer token",
        "cf-connecting-ip": "203.0.113.7",
        cookie: "session=abc",
        "x-forwarded-for": "203.0.113.7",
        "x-origin-auth": "shared-value",
      },
    });

    expect(request.headers).toMatchObject({
      authorization: "Bearer token",
      "cf-connecting-ip": "203.0.113.7",
      cookie: "session=abc",
      "x-forwarded-for": "203.0.113.7",
    });
  });

  it("addresses the upstream by its own host and keeps the path and query", async () => {
    const request = await forward({ headers: { host: "keeper.example.com" } });

    expect(request.headers.host).toBe(new URL(upstreamOrigin).host);
    expect(request.url).toBe("/api/accounts?limit=5");
  });

  it("delivers a request body intact", async () => {
    const body = JSON.stringify({ name: "Team calendar", url: "https://example.com/team.ics" });

    const request = await forward({
      body,
      headers: { "content-type": "application/json", "x-origin-auth": "shared-value" },
      method: "POST",
      path: "/api/ics",
    });

    expect(request.method).toBe("POST");
    expect(request.body).toBe(body);
    expect(request.headers["content-type"]).toBe("application/json");
  });

  it("delivers a streamed request body intact", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        controller.enqueue(new TextEncoder().encode("{\"part\":1,"));
        controller.enqueue(new TextEncoder().encode("\"rest\":2}"));
        controller.close();
      },
    });

    const request = await forward({
      body: stream,
      headers: { "content-type": "application/json", "transfer-encoding": "chunked" },
      method: "PUT",
      path: "/api/v1/events/1",
    });

    expect(request.body).toBe("{\"part\":1,\"rest\":2}");
  });
});
