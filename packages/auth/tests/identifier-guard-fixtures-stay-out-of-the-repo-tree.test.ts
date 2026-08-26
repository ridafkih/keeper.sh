import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectGuardedFiles,
  findOpaqueIdentifierOffenders,
  findWallClockTimestampOffenders,
} from "./support/identifier-guard";

const repositoryRoot = resolve(import.meta.dirname, "../../..");

const opaqueToken = ["aB3xQ9zK1mN7pR2s", "T5vW8yC4dF6gH0jL"].join("");
const wallClockTimestamp = ["06:15:33.956", "UTC"].join(" ");

const temporaryRoots: string[] = [];

const makeTemporaryRoot = async () => {
  const root = await mkdtemp(resolve(tmpdir(), "identifier-guard-root-"));
  temporaryRoots.push(root);
  return root;
};

const writeUnder = async (root: string, relativePath: string, body: string) => {
  const absolute = resolve(root, relativePath);
  await mkdir(resolve(absolute, ".."), { recursive: true });
  await writeFile(absolute, `export const fixtureValue = ${JSON.stringify(body)};\n`);
};

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

const probedDirectories = ["packages/auth/tests", "packages/queue/tests"];

const scanForFixtureLeaks = async () => {
  const seen: string[] = [];
  for (const directory of probedDirectories) {
    const entries = await readdir(resolve(repositoryRoot, directory)).catch(() => []);
    for (const entry of entries) {
      if (entry.startsWith("zz-")) {
        seen.push(`${directory}/${entry}`);
      }
    }
  }
  return seen;
};

describe("identifier guard fixtures stay out of the repository tree", () => {
  it("reports offenders in fixtures written under a root injected at call time", async () => {
    const root = await makeTemporaryRoot();
    const fixturePath = "packages/auth/tests/zz-injected-root-fixture.test.ts";
    await writeUnder(root, fixturePath, `${opaqueToken} deleted at ${wallClockTimestamp}`);

    const collected = await collectGuardedFiles({ root });
    expect(collected).toContain(fixturePath);

    const opaqueOffenders = await findOpaqueIdentifierOffenders(undefined, { root });
    expect(opaqueOffenders).toContain(`${fixturePath}: ${opaqueToken}`);

    const timestampOffenders = await findWallClockTimestampOffenders(undefined, { root });
    expect(timestampOffenders).toContain(`${fixturePath}: ${wallClockTimestamp}`);
  });

  it("leaves the guard's own real remediation files unreported under an empty injected root", async () => {
    const root = await makeTemporaryRoot();
    await expect(findOpaqueIdentifierOffenders(undefined, { root })).resolves.toEqual([]);
    expect(await collectGuardedFiles({ root })).toEqual([]);
  });

  it("never puts a zz- fixture inside the repository tree while the scoping test runs", async () => {
    expect(await scanForFixtureLeaks()).toEqual([]);

    const child = Bun.spawn(
      ["bun", "x", "--bun", "vitest", "run", "tests/identifier-guard-scopes-to-owned-files.test.ts"],
      {
        cwd: resolve(repositoryRoot, "packages/auth"),
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, CI: "1" },
      },
    );

    const sightings = new Set<string>();
    let running = true;
    const probe = (async () => {
      while (running) {
        for (const leaked of await scanForFixtureLeaks()) {
          sightings.add(leaked);
        }
        await Bun.sleep(1);
      }
    })();

    const exitCode = await child.exited;
    running = false;
    await probe;

    const output = `${await new Response(child.stdout).text()}${await new Response(child.stderr).text()}`;
    expect(exitCode, output).toBe(0);
    expect([...sightings], output).toEqual([]);
    expect(await scanForFixtureLeaks()).toEqual([]);
  }, 180_000);
});
