import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../../..");

const remediationTestFiles = [
  "packages/auth/tests/delete-user-teardown-ordering.test.ts",
  "packages/auth/tests/delete-user-teardown.test.ts",
  "packages/auth/tests/failed-delete-user-does-not-strand-the-account.test.ts",
  "packages/auth/tests/polar-customer-delete.test.ts",
  "packages/calendar/tests/core/sync-engine/aborted-run-is-alertable.test.ts",
  "packages/calendar/tests/core/sync-engine/aborted-run-is-visible-to-the-caller.test.ts",
  "packages/calendar/tests/core/sync-engine/in-flight-sync-aborts-when-user-is-deleted.test.ts",
  "packages/calendar/tests/core/sync-engine/tombstone-write-lost-halts-on-missing-user-row.test.ts",
  "packages/calendar/tests/core/sync-engine/user-deleted-check-reprobes-user-row.test.ts",
  "packages/queue/tests/remove-user-sync-jobs.test.ts",
  "packages/sync/tests/aborted-run-does-not-clear-backoff.test.ts",
  "packages/sync/tests/aborted-run-verdict.test.ts",
  "services/api/tests/utils/delete-user-teardown-deadline.test.ts",
  "services/api/tests/utils/delete-user-teardown-push-restate.test.ts",
  "services/api/tests/utils/delete-user-teardown.test.ts",
  "services/api/tests/utils/push-notifications/deregister-user-channels-concurrency.test.ts",
  "services/api/tests/utils/push-notifications/deregister-user-channels.test.ts",
];

const testCorpusGlobs = [
  "packages/*/tests/**/*.ts",
  "services/*/tests/**/*.ts",
];

const opaqueIdentifierPattern = /\b[A-Za-z0-9]{32}\b/g;
const wallClockTimestampPattern = /\b\d{2}:\d{2}:\d{2}(?:\.\d+)? UTC\b/g;

const looksLikeOpaqueIdentifier = (token: string) =>
  /[a-z]/.test(token) && /[A-Z]/.test(token) && /[0-9]/.test(token);

const collectCorpusFiles = async () => {
  const paths: string[] = [];
  for (const pattern of testCorpusGlobs) {
    const glob = new Bun.Glob(pattern);
    for await (const match of glob.scan({ cwd: repositoryRoot })) {
      paths.push(match);
    }
  }
  return paths.toSorted();
};

const readCorpusFile = async (relativePath: string) => {
  const file = Bun.file(resolve(repositoryRoot, relativePath));
  if (!(await file.exists())) {
    throw new Error(`expected remediation test file to exist: ${relativePath}`);
  }
  return await file.text();
};

const findCommentLines = (source: string) => {
  const lines: number[] = [];
  let index = 0;
  let line = 1;
  let quote: string | null = null;
  while (index < source.length) {
    const character = source[index];
    if (character === "\n") {
      line += 1;
      index += 1;
      continue;
    }
    if (quote) {
      if (character === "\\") {
        index += 2;
        continue;
      }
      if (character === quote) {
        quote = null;
      }
      index += 1;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      index += 1;
      continue;
    }
    if (character === "/" && (source[index + 1] === "/" || source[index + 1] === "*")) {
      lines.push(line);
      if (source[index + 1] === "/") {
        while (index < source.length && source[index] !== "\n") {
          index += 1;
        }
        continue;
      }
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
        if (source[index] === "\n") {
          line += 1;
        }
        index += 1;
      }
      index += 2;
      continue;
    }
    index += 1;
  }
  return lines;
};

describe("incident remediation tests carry no customer identifier and no comment blocks", () => {
  it("places no production-shaped opaque user identifier anywhere in the public test corpus", async () => {
    const offenders: string[] = [];
    for (const relativePath of await collectCorpusFiles()) {
      const source = await readCorpusFile(relativePath);
      for (const match of source.matchAll(opaqueIdentifierPattern)) {
        if (looksLikeOpaqueIdentifier(match[0])) {
          offenders.push(`${relativePath}: ${match[0]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("places no deletion wall-clock timestamp anywhere in the public test corpus", async () => {
    const offenders: string[] = [];
    for (const relativePath of await collectCorpusFiles()) {
      const source = await readCorpusFile(relativePath);
      for (const match of source.matchAll(wallClockTimestampPattern)) {
        offenders.push(`${relativePath}: ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps every test file this remediation added free of block and line comments", async () => {
    const offenders: string[] = [];
    for (const relativePath of remediationTestFiles) {
      const source = await readCorpusFile(relativePath);
      for (const line of findCommentLines(source)) {
        offenders.push(`${relativePath}:${line}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
