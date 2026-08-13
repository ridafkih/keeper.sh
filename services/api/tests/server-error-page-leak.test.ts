import { readFileSync } from "node:fs";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { describe, expect, it } from "vitest";

const readSource = (relativePath: string): string =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

const indexSource = readSource("../src/index.ts");

const readServeOptionsSource = (source: string): string => {
  const start = source.indexOf("Bun.serve");
  const end = source.indexOf("await broadcastService", start);
  return source.slice(start, end);
};

const serveOptionsSource = readServeOptionsSource(indexSource);

const suppressesDevelopmentErrorPage = (options: string): boolean =>
  /\bdevelopment\s*:\s*false\b/.test(options) || /(^|[\s{,])error\s*:/m.test(options);

const SELECT_SQL =
  'select "username", "server_url", "encrypted_password" from "caldav_credentials" '
  + 'where "user_id" = $1';

const USERNAME = "rida@fastmail.com";
const SERVER_URL = "https://caldav.fastmail.com";
const ENCRYPTED_PASSWORD = "nacl:9f0c2a41d0";

const poolFailure = (): DrizzleQueryError =>
  new DrizzleQueryError(
    SELECT_SQL,
    ["user-1", USERNAME, SERVER_URL, ENCRYPTED_PASSWORD],
    Object.assign(new Error("Connection closed"), {
      code: "ERR_POSTGRES_CONNECTION_CLOSED",
      name: "PostgresError",
    }),
  );

const serverFailure = (): DrizzleQueryError =>
  new DrizzleQueryError(
    SELECT_SQL,
    ["user-1", USERNAME, SERVER_URL, ENCRYPTED_PASSWORD],
    Object.assign(new Error('relation "caldav_credentials" does not exist'), {
      code: "ERR_POSTGRES_SERVER_ERROR",
      errno: "42P01",
      name: "PostgresError",
    }),
  );

const decodeFallbackPayload = (body: string): string => {
  const match = body.match(/<script id="__bunfallback"[^>]*>([\s\S]*?)<\/script>/);
  if (!match?.[1]) {
    return "";
  }
  return Buffer.from(match[1].trim(), "base64").toString("latin1");
};

const readResponseSurface = async (response: Response): Promise<string> => {
  const body = await response.text();
  return `${body}\n${decodeFallbackPayload(body)}`;
};

const readDevelopmentOverride = (): { development?: false } => {
  if (suppressesDevelopmentErrorPage(serveOptionsSource)) {
    return { development: false };
  }
  return {};
};

const serveLikeApi = (fetchHandler: () => Response): ReturnType<typeof Bun.serve> =>
  Bun.serve({
    fetch: fetchHandler,
    port: 0,
    ...readDevelopmentOverride(),
  });

const requestFailureSurface = async (
  buildError: () => Error,
  requestCount: number,
): Promise<string[]> => {
  const server = serveLikeApi(() => {
    throw buildError();
  });
  const surfaces: string[] = [];
  try {
    for (let attempt = 0; attempt < requestCount; attempt += 1) {
      surfaces.push(await readResponseSurface(await fetch(server.url)));
    }
  } finally {
    server.stop(true);
  }
  return surfaces;
};

describe("api server configuration", () => {
  it("suppresses Bun's development error page so thrown errors are never rendered", () => {
    expect(suppressesDevelopmentErrorPage(serveOptionsSource)).toBe(true);
  });

  it("keeps the error page off even though no runtime pins NODE_ENV to production", () => {
    const runScript = readSource(
      "../../../docker/standalone/rootfs/etc/s6-overlay/s6-rc.d/api/run",
    );
    const pinsProductionEnvironment = /NODE_ENV\s*=\s*["']?production/.test(runScript);
    expect(suppressesDevelopmentErrorPage(serveOptionsSource) || pinsProductionEnvironment)
      .toBe(true);
  });
});

describe("uncaught database failures reaching the Bun server", () => {
  it("never returns the failing SQL to the caller", async () => {
    const [surface] = await requestFailureSurface(poolFailure, 1);
    expect(surface).not.toContain("caldav_credentials");
  });

  it("never returns bound parameters to the caller", async () => {
    const [surface] = await requestFailureSurface(poolFailure, 1);
    expect([
      surface?.includes(USERNAME),
      surface?.includes(SERVER_URL),
      surface?.includes(ENCRYPTED_PASSWORD),
    ]).toEqual([false, false, false]);
  });

  it("stays leak free for ordinary server-side failures as well as pool failures", async () => {
    const [surface] = await requestFailureSurface(serverFailure, 1);
    expect([surface?.includes("caldav_credentials"), surface?.includes(USERNAME)])
      .toEqual([false, false]);
  });

  it("stays leak free across repeated requests during a sustained outage", async () => {
    const surfaces = await requestFailureSurface(poolFailure, 3);
    expect(surfaces.map((surface) => surface.includes(USERNAME))).toEqual([
      false,
      false,
      false,
    ]);
  });
});
