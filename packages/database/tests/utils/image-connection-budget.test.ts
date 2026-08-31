import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPOSITORY_ROOT = join(import.meta.dirname, "..", "..", "..", "..");
const STANDALONE_ROOT = join(REPOSITORY_ROOT, "docker", "standalone");
const SERVICES_ROOT = join(REPOSITORY_ROOT, "docker", "services");

const INITDB_DEFAULT_MAX_CONNECTIONS = 100;
const CONNECTIONS_RESERVED_FOR_OPERATORS = 10;

const read = (...segments: string[]): string => readFileSync(join(...segments), "utf8");

const serviceRoot = (imageRoot: string): string =>
  join(imageRoot, "rootfs", "etc", "s6-overlay", "s6-rc.d");

const readServiceRun = (imageRoot: string, service: string): string =>
  read(serviceRoot(imageRoot), service, "run");

const readInitDatabase = (imageRoot: string): string =>
  read(imageRoot, "rootfs", "etc", "s6-overlay", "scripts", "init-db");

const readDefault = (script: string, variable: string): number => {
  const match = script.match(new RegExp(`\\$\\{${variable}:-(\\d+)\\}`));
  expect(match, `${variable} has no shipped default`).not.toBeNull();
  return Number((match as RegExpMatchArray)[1]);
};

const peakConnectionDemand = (imageRoot: string, services: string[]): number => {
  const pools = services.map((service) =>
    readDefault(readServiceRun(imageRoot, service), "DATABASE_POOL_MAX"),
  );
  const flushPool = readDefault(readServiceRun(imageRoot, "cron"), "CRON_FLUSH_POOL_MAX");
  return pools.reduce((total, pool) => total + pool, 0) + flushPool;
};

const images = [
  { name: "keeper-standalone", root: STANDALONE_ROOT, services: ["api", "cron", "mcp", "worker"] },
  { name: "keeper-services", root: SERVICES_ROOT, services: ["api", "cron", "worker"] },
];

describe.each(images)("$name connection budget", ({ root, services }) => {
  it("keeps every co-located pool inside a Postgres left at the initdb default", () => {
    expect(
      peakConnectionDemand(root, services) + CONNECTIONS_RESERVED_FOR_OPERATORS,
    ).toBeLessThanOrEqual(INITDB_DEFAULT_MAX_CONNECTIONS);
  });
});

describe("keeper-standalone bundled Postgres", () => {
  const postgres = (): string => readServiceRun(STANDALONE_ROOT, "postgres");

  it("is sized past the demand the image itself ships", () => {
    const match = postgres().match(/max_connections=(\d+)/);
    expect(match, "the bundled Postgres ships no max_connections").not.toBeNull();

    const maxConnections = Number((match as RegExpMatchArray)[1]);
    const demand = peakConnectionDemand(STANDALONE_ROOT, ["api", "cron", "mcp", "worker"]);
    expect(demand + CONNECTIONS_RESERVED_FOR_OPERATORS).toBeLessThanOrEqual(maxConnections);
  });

  it("is dialled over IPv4 only", () => {
    const dockerfile = read(STANDALONE_ROOT, "Dockerfile");

    expect(dockerfile).toContain(
      "ENV DATABASE_URL=postgresql://keeper:keeper@127.0.0.1:5432/keeper",
    );
    expect(dockerfile).toContain("ENV REDIS_URL=redis://127.0.0.1:6379");
    expect(readInitDatabase(STANDALONE_ROOT)).not.toMatch(/@localhost:5432/);
    expect(postgres()).toContain("listen_addresses=127.0.0.1");
  });

  it("does not grant the application role superuser", () => {
    const initDatabase = readInitDatabase(STANDALONE_ROOT);

    expect(initDatabase).not.toMatch(/createuser\s+-s/);
    expect(initDatabase).toContain("ALTER ROLE keeper NOSUPERUSER");
  });
});
