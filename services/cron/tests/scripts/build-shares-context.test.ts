import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Every job is its own build entrypoint and is dynamically imported at boot. Without
 * splitting, each bundle inlines its own copy of context.ts, so the one cron process ends
 * up holding one pooled database, one flush database and one Redis client per job rather
 * than one of each — measured at 100 Postgres connections for a service configured for 20.
 */
describe("cron build", () => {
  it("shares one copy of the modules its entrypoints have in common", () => {
    const script = readFileSync(join(import.meta.dirname, "..", "..", "scripts", "build.ts"), "utf8");

    expect(script).toContain("splitting: true");
  });
});
