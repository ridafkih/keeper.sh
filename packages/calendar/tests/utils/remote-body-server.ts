import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { constants, createGzip } from "node:zlib";

type RouteHandler = (request: IncomingMessage, response: ServerResponse) => void;

interface RemoteBodyServer {
  close: () => Promise<void>;
  url: (path: string) => string;
}

interface EndlessBodyTracker {
  hangUp: () => void;
  stalled: () => Promise<number>;
  uncompressedBytes: () => number;
}

interface EndlessBody {
  handler: RouteHandler;
  tracker: EndlessBodyTracker;
}

const RUNTIME_STOPS_ABORTED_TRANSFERS = Bun.semver.satisfies(Bun.version, ">=1.4.4");

const STALL_SAMPLE_MS = 100;
const STALL_SAMPLES = 3;

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

const listen = (server: Server): Promise<number> =>
  new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("The test server did not bind to a port"));
        return;
      }
      resolve(address.port);
    });
  });

const startRemoteBodyServer = async (routes: Record<string, RouteHandler>): Promise<RemoteBodyServer> => {
  const server = createServer((request, response) => {
    const handler = routes[new URL(request.url ?? "/", "http://localhost").pathname];
    if (!handler) {
      response.writeHead(404);
      response.end();
      return;
    }
    handler(request, response);
  });
  const port = await listen(server);

  return {
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
    url: (path) => `http://127.0.0.1:${port}${path}`,
  };
};

type EndlessBodyEncoding = "deflated" | "stored";

const GZIP_LEVELS: Record<EndlessBodyEncoding, number> = {
  deflated: constants.Z_DEFAULT_COMPRESSION,
  stored: constants.Z_NO_COMPRESSION,
};

const createEndlessGzipBody = (
  block: Buffer,
  headers: Record<string, string>,
  encoding: EndlessBodyEncoding,
  status = 200,
): EndlessBody => {
  let uncompressedBytes = 0;
  const openResponses = new Set<ServerResponse>();

  const handler: RouteHandler = (_request, response) => {
    openResponses.add(response);
    const gzip = createGzip({ level: GZIP_LEVELS[encoding] });
    response.writeHead(status, { ...headers, "content-encoding": "gzip" });
    gzip.pipe(response);

    const pump = (): void => {
      while (!gzip.destroyed) {
        uncompressedBytes += block.byteLength;
        if (!gzip.write(block)) {
          gzip.once("drain", pump);
          return;
        }
      }
    };

    response.once("close", () => {
      openResponses.delete(response);
      gzip.destroy();
    });
    pump();
  };

  const hangUp = (): void => {
    for (const response of openResponses) {
      response.destroy();
    }
  };

  const stalled = async (): Promise<number> => {
    let unchangedSamples = 0;
    let lastSample = uncompressedBytes;

    while (unchangedSamples < STALL_SAMPLES) {
      await delay(STALL_SAMPLE_MS);
      if (uncompressedBytes === lastSample) {
        unchangedSamples += 1;
      } else {
        unchangedSamples = 0;
        lastSample = uncompressedBytes;
      }
    }

    return lastSample;
  };

  return { handler, tracker: { hangUp, stalled, uncompressedBytes: () => uncompressedBytes } };
};

export { createEndlessGzipBody, RUNTIME_STOPS_ABORTED_TRANSFERS, startRemoteBodyServer };
