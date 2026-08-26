import { stat } from "node:fs/promises";
import { resolve } from "node:path";

const defaultRepositoryRoot = resolve(import.meta.dirname, "../../../..");

const packageTestRoot = "packages/auth";
const packageTestGlob = "tests/**/*.ts";

const remediationTestGlob = "**/*.test.ts";

interface GuardOptions {
  root?: string;
}

const rootOf = (options?: GuardOptions) => options?.root ?? defaultRepositoryRoot;

const remediationScanRoots = () => [
  "packages/calendar/tests",
  "packages/queue/tests",
  "packages/sync/tests",
  "services/api/tests",
];

const remediationTestFiles = () => [
  "packages/auth/tests/delete-user-teardown-ordering.test.ts",
  "packages/auth/tests/delete-user-teardown.test.ts",
  "packages/auth/tests/failed-delete-user-does-not-strand-the-account.test.ts",
  "packages/auth/tests/polar-customer-delete.test.ts",
  "packages/calendar/tests/core/sync-engine/aborted-run-is-alertable.test.ts",
  "packages/calendar/tests/core/sync-engine/aborted-run-is-visible-to-the-caller.test.ts",
  "packages/calendar/tests/core/sync-engine/in-flight-sync-aborts-when-user-is-deleted.test.ts",
  "packages/calendar/tests/core/sync-engine/tombstone-write-lost-halts-on-missing-user-row.test.ts",
  "packages/calendar/tests/core/sync-engine/user-deleted-check-reprobes-user-row.test.ts",
  "packages/calendar/tests/core/sync-engine/user-deleted-fallback-answers-before-the-first-chunk.test.ts",
  "packages/queue/tests/remove-user-sync-jobs.test.ts",
  "packages/sync/tests/aborted-run-does-not-clear-backoff.test.ts",
  "packages/sync/tests/aborted-run-verdict.test.ts",
  "services/api/tests/utils/delete-user-teardown-budget-fits-auth-deadline.test.ts",
  "services/api/tests/utils/delete-user-teardown-deadline.test.ts",
  "services/api/tests/utils/delete-user-teardown-push-restate.test.ts",
  "services/api/tests/utils/delete-user-teardown-tombstone-abort.test.ts",
  "services/api/tests/utils/delete-user-teardown.test.ts",
  "services/api/tests/utils/push-notifications/deregister-user-channels-abandoned-are-loud.test.ts",
  "services/api/tests/utils/push-notifications/deregister-user-channels-abandoned-attribution.test.ts",
  "services/api/tests/utils/push-notifications/deregister-user-channels-concurrency.test.ts",
  "services/api/tests/utils/push-notifications/deregister-user-channels-stop-deadline.test.ts",
  "services/api/tests/utils/push-notifications/deregister-user-channels.test.ts",
];

const looksLikeOpaqueIdentifier = (token: string) =>
  /[a-z]/.test(token) && /[A-Z]/.test(token) && /[0-9]/.test(token);

const directoryExists = async (absolutePath: string) => {
  const entry = await stat(absolutePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  });
  return entry !== null && entry.isDirectory();
};

const readGuardedFile = async (relativePath: string, options?: GuardOptions) => {
  const file = Bun.file(resolve(rootOf(options), relativePath));
  if (!(await file.exists())) {
    throw new Error(`guarded file is named by the identifier guard but is missing: ${relativePath}`);
  }
  return await file.text();
};

const scanRemediationTests = async (root: string) => {
  const remediationNamePattern =
    /aborted-run|deleted-user|delete-user|deregister-user-channels|remove-user-sync-jobs|tombstone|user-deleted|user-is-deleted/;
  const named = remediationTestFiles();
  const found: string[] = [];
  for (const scanRoot of remediationScanRoots()) {
    const directory = resolve(root, scanRoot);
    if (!(await directoryExists(directory))) {
      continue;
    }
    const glob = new Bun.Glob(remediationTestGlob);
    for await (const match of glob.scan({ cwd: directory })) {
      if (remediationNamePattern.test(match)) {
        found.push(`${scanRoot}/${match}`);
      }
    }
  }
  const unnamed = found.filter((relativePath) => !named.includes(relativePath));
  if (unnamed.length > 0) {
    throw new Error(
      `remediation test files are missing from the guarded corpus list: ${unnamed.toSorted().join(", ")}`,
    );
  }
  return found;
};

const collectGuardedFiles = async (options?: GuardOptions) => {
  const root = rootOf(options);
  const paths = new Set<string>();
  const packageTestDirectory = resolve(root, packageTestRoot);
  if (await directoryExists(packageTestDirectory)) {
    const glob = new Bun.Glob(packageTestGlob);
    for await (const match of glob.scan({ cwd: packageTestDirectory })) {
      paths.add(`${packageTestRoot}/${match}`);
    }
  }
  for (const relativePath of await scanRemediationTests(root)) {
    paths.add(relativePath);
  }
  return [...paths].toSorted();
};

const findOffenders = async (
  pattern: RegExp,
  accept: (token: string) => boolean,
  relativePaths?: string[],
  options?: GuardOptions,
) => {
  const root = rootOf(options);
  const offenders: string[] = [];
  for (const relativePath of relativePaths ?? (await collectGuardedFiles({ root }))) {
    const source = await readGuardedFile(relativePath, { root });
    for (const match of source.matchAll(pattern)) {
      if (accept(match[0])) {
        offenders.push(`${relativePath}: ${match[0]}`);
      }
    }
  }
  return offenders;
};

const findOpaqueIdentifierOffenders = (relativePaths?: string[], options?: GuardOptions) =>
  findOffenders(/\b[A-Za-z0-9]{32}\b/g, looksLikeOpaqueIdentifier, relativePaths, options);

const findWallClockTimestampOffenders = (relativePaths?: string[], options?: GuardOptions) =>
  findOffenders(/\b\d{2}:\d{2}:\d{2}(?:\.\d+)? UTC\b/g, () => true, relativePaths, options);

export {
  collectGuardedFiles,
  findOpaqueIdentifierOffenders,
  findWallClockTimestampOffenders,
  readGuardedFile,
  remediationTestFiles,
};
