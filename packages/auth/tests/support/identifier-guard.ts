import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");

const packageTestRoot = "packages/auth";
const packageTestGlob = "tests/**/*.ts";

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

const opaqueIdentifierPattern = /\b[A-Za-z0-9]{32}\b/g;
const wallClockTimestampPattern = /\b\d{2}:\d{2}:\d{2}(?:\.\d+)? UTC\b/g;

const looksLikeOpaqueIdentifier = (token: string) =>
  /[a-z]/.test(token) && /[A-Z]/.test(token) && /[0-9]/.test(token);

const readGuardedFile = async (relativePath: string) => {
  const file = Bun.file(resolve(repositoryRoot, relativePath));
  if (!(await file.exists())) {
    return null;
  }
  return await file.text();
};

const collectGuardedFiles = async () => {
  const paths = new Set<string>();
  const glob = new Bun.Glob(packageTestGlob);
  for await (const match of glob.scan({ cwd: resolve(repositoryRoot, packageTestRoot) })) {
    paths.add(`${packageTestRoot}/${match}`);
  }
  for (const relativePath of remediationTestFiles) {
    if ((await readGuardedFile(relativePath)) !== null) {
      paths.add(relativePath);
    }
  }
  return [...paths].toSorted();
};

const findOffenders = async (
  pattern: RegExp,
  accept: (token: string) => boolean,
  relativePaths?: string[],
) => {
  const offenders: string[] = [];
  for (const relativePath of relativePaths ?? (await collectGuardedFiles())) {
    const source = await readGuardedFile(relativePath);
    if (source === null) {
      continue;
    }
    for (const match of source.matchAll(pattern)) {
      if (accept(match[0])) {
        offenders.push(`${relativePath}: ${match[0]}`);
      }
    }
  }
  return offenders;
};

const findOpaqueIdentifierOffenders = (relativePaths?: string[]) =>
  findOffenders(opaqueIdentifierPattern, looksLikeOpaqueIdentifier, relativePaths);

const findWallClockTimestampOffenders = (relativePaths?: string[]) =>
  findOffenders(wallClockTimestampPattern, () => true, relativePaths);

export {
  collectGuardedFiles,
  findOpaqueIdentifierOffenders,
  findWallClockTimestampOffenders,
  readGuardedFile,
  remediationTestFiles,
};
