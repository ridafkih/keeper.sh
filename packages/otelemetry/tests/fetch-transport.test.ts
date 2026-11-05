import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createFetchTransport } from "../src/fetch-transport";
import type { FetchTransportParameters } from "../src/fetch-transport";

const PAYLOAD = new TextEncoder().encode("{}");
const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

const parametersFor = (url: string, compression: FetchTransportParameters["compression"] = "none") => ({
  url,
  headers: () => Promise.resolve({ "Content-Type": "application/json" }),
  compression,
});

const listenSilently = async () => {
  const sockets: net.Socket[] = [];
  const server = net.createServer((socket) => {
    sockets.push(socket);
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  cleanups.push(() => {
    for (const socket of sockets) {
      socket.destroy();
    }
    server.close();
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("server has no port");
  }
  return address.port;
};

const serve = (respond: (request: Request) => Response | Promise<Response>) => {
  const server = Bun.serve({ port: 0, fetch: respond });
  cleanups.push(() => server.stop(true));
  return `http://127.0.0.1:${server.port}/v1/logs`;
};

const timeSend = async (url: string, timeoutMillis: number) => {
  const started = performance.now();
  const response = await createFetchTransport(parametersFor(url)).send(PAYLOAD, timeoutMillis);
  return { response, elapsedMillis: performance.now() - started };
};

describe("fetch transport", () => {
  it("gives up on a collector that never completes the TLS handshake", async () => {
    const port = await listenSilently();
    const { response, elapsedMillis } = await timeSend(`https://127.0.0.1:${port}/v1/logs`, 300);

    expect(response.status).toBe("retryable");
    expect(elapsedMillis).toBeLessThan(2000);
  });

  it("gives up on a collector that accepts the request but never answers", async () => {
    const port = await listenSilently();
    const { response, elapsedMillis } = await timeSend(`http://127.0.0.1:${port}/v1/logs`, 300);

    expect(response.status).toBe("retryable");
    expect(elapsedMillis).toBeLessThan(2000);
  });

  it("retries while the collector pushes back and then succeeds", async () => {
    let requests = 0;
    const url = serve(() => {
      requests += 1;
      if (requests < 3) {
        return new Response("slow down", { status: 503, headers: { "retry-after": "0" } });
      }
      return new Response("{}");
    });

    const response = await createFetchTransport(parametersFor(url)).send(PAYLOAD, 5000);

    expect(response.status).toBe("success");
    expect(requests).toBe(3);
  });

  it("does not retry a request the collector rejects", async () => {
    let requests = 0;
    const url = serve(() => {
      requests += 1;
      return new Response("bad payload", { status: 400 });
    });

    const response = await createFetchTransport(parametersFor(url)).send(PAYLOAD, 5000);

    expect(response.status).toBe("failure");
    expect(requests).toBe(1);
  });

  it("compresses the payload when gzip is configured", async () => {
    const received: { encoding: string | null; body: string }[] = [];
    const url = serve(async (request) => {
      const body = new Uint8Array(await request.arrayBuffer());
      received.push({
        encoding: request.headers.get("content-encoding"),
        body: new TextDecoder().decode(Bun.gunzipSync(body)),
      });
      return new Response("{}");
    });

    await createFetchTransport(parametersFor(url, "gzip")).send(PAYLOAD, 5000);

    expect(received).toEqual([{ encoding: "gzip", body: "{}" }]);
  });
});
