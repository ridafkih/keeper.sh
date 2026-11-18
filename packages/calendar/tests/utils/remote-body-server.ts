import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { createGzip } from "node:zlib";

type RouteHandler = (request: IncomingMessage, response: ServerResponse) => void;

interface RemoteBodyServer {
  close: () => Promise<void>;
  url: (path: string) => string;
}

interface EndlessBodyTracker {
  hungUp: Promise<null>;
  uncompressedBytes: () => number;
}

interface EndlessBody {
  handler: RouteHandler;
  tracker: EndlessBodyTracker;
}

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

const createEndlessGzipBody = (block: Buffer, headers: Record<string, string>): EndlessBody => {
  let uncompressedBytes = 0;
  const hangUp = Promise.withResolvers<null>();

  const handler: RouteHandler = (_request, response) => {
    const gzip = createGzip();
    response.writeHead(200, { ...headers, "content-encoding": "gzip" });
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
      gzip.destroy();
      hangUp.resolve(null);
    });
    pump();
  };

  return {
    handler,
    tracker: { hungUp: hangUp.promise, uncompressedBytes: () => uncompressedBytes },
  };
};

export { createEndlessGzipBody, startRemoteBodyServer };
export type { RemoteBodyServer };
