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
  "services/cron/tests",
];

const remediationTestFiles = () => [
  "packages/auth/tests/an-unresolvable-probe-marks-the-tombstone-provisional.test.ts",
  "packages/auth/tests/delete-user-teardown-ordering.test.ts",
  "packages/auth/tests/delete-user-teardown.test.ts",
  "packages/auth/tests/failed-delete-user-does-not-strand-the-account.test.ts",
  "packages/auth/tests/polar-customer-delete-cancels-a-hung-request.test.ts",
  "packages/auth/tests/polar-customer-delete.test.ts",
  "packages/auth/tests/survived-row-marks-the-tombstone-provisional-before-rollback.test.ts",
  "packages/auth/tests/tombstone-survives-an-unresolvable-user-row-probe.test.ts",
  "packages/auth/tests/unresolvable-probe-leaves-repairable-polar-residue.test.ts",
  "packages/calendar/tests/core/deletion/a-failing-purge-does-not-skip-the-whole-reaper-pass.test.ts",
  "packages/calendar/tests/core/deletion/a-failing-residue-clear-does-not-exile-the-rest-of-the-batch.test.ts",
  "packages/calendar/tests/core/deletion/a-permanently-failing-residue-repair-retires-at-its-attempt-cap.test.ts",
  "packages/calendar/tests/core/deletion/no-residue-is-retired-before-its-expiry.test.ts",
  "packages/calendar/tests/core/deletion/one-stalled-residue-repair-cannot-freeze-the-whole-reaper.test.ts",
  "packages/calendar/tests/core/deletion/push-repair-signal-reaches-registrar-context.test.ts",
  "packages/calendar/tests/core/deletion/residue-store-refuses-to-start-without-an-encryption-key.test.ts",
  "packages/calendar/tests/core/deletion/unstoppable-push-residue-retires-on-the-first-reaper-pass.test.ts",
  "packages/calendar/tests/core/source/unstoppable-channel-does-not-poison-the-cron-deregister-path.test.ts",
  "packages/calendar/tests/core/sync-engine/aborted-run-is-alertable.test.ts",
  "packages/calendar/tests/core/sync-engine/aborted-run-is-visible-to-the-caller.test.ts",
  "packages/calendar/tests/core/sync-engine/in-flight-sync-aborts-when-user-is-deleted.test.ts",
  "packages/calendar/tests/core/sync-engine/tombstone-write-lost-halts-on-missing-user-row.test.ts",
  "packages/calendar/tests/core/sync-engine/user-deleted-check-reprobes-user-row.test.ts",
  "packages/calendar/tests/core/sync-engine/user-deleted-fallback-answers-before-the-first-chunk.test.ts",
  "packages/calendar/tests/core/utils/a-failed-tombstone-read-reprobes-the-user-row.test.ts",
  "packages/calendar/tests/core/utils/a-provisional-tombstone-defers-to-the-user-row.test.ts",
  "packages/calendar/tests/core/utils/an-unreadable-provisional-marker-defers-to-the-user-row.test.ts",
  "packages/calendar/tests/core/utils/deleted-user-tombstone-present-answer-freshness.test.ts",
  "packages/queue/tests/remove-user-sync-jobs.test.ts",
  "packages/sync/tests/aborted-run-does-not-clear-backoff.test.ts",
  "packages/sync/tests/aborted-run-verdict.test.ts",
  "services/api/tests/utils/deadline-abort-preserves-abandoned-push-channel-residue.test.ts",
  "services/api/tests/utils/delete-user-teardown-budget-fits-auth-deadline.test.ts",
  "services/api/tests/utils/delete-user-teardown-deadline.test.ts",
  "services/api/tests/utils/delete-user-teardown-push-restate.test.ts",
  "services/api/tests/utils/delete-user-teardown-tombstone-abort.test.ts",
  "services/api/tests/utils/delete-user-teardown-worst-case-fits-the-auth-deadline.test.ts",
  "services/api/tests/utils/delete-user-teardown.test.ts",
  "services/api/tests/utils/every-residue-write-is-registered-before-it-is-awaited.test.ts",
  "services/api/tests/utils/failed-teardown-steps-leave-durable-repairable-residue.test.ts",
  "services/api/tests/utils/push-channel-residue-survives-work-that-settles-after-the-abort-window.test.ts",
  "services/api/tests/utils/push-notifications/delete-user-channel-listing-retries-a-transient-failure.test.ts",
  "services/api/tests/utils/push-notifications/deregister-user-channels-abandoned-are-loud.test.ts",
  "services/api/tests/utils/push-notifications/deregister-user-channels-abandoned-attribution.test.ts",
  "services/api/tests/utils/push-notifications/deregister-user-channels-concurrency.test.ts",
  "services/api/tests/utils/push-notifications/deregister-user-channels-stop-deadline.test.ts",
  "services/api/tests/utils/push-notifications/deregister-user-channels.test.ts",
  "services/api/tests/utils/push-residue-abandoned-before-dialing-carries-its-stored-credential.test.ts",
  "services/api/tests/utils/push-residue-cleared-per-stopped-channel.test.ts",
  "services/api/tests/utils/push-residue-from-an-earlier-attempt-survives-a-clean-teardown.test.ts",
  "services/api/tests/utils/push-residue-is-captured-from-the-rows-when-the-channel-listing-fails.test.ts",
  "services/api/tests/utils/push-residue-survives-an-unconfigured-webhook-url.test.ts",
  "services/api/tests/utils/residue-claim-skips-rows-whose-user-row-still-exists.test.ts",
  "services/api/tests/utils/residue-deletion-requires-a-surviving-user-row.test.ts",
  "services/api/tests/utils/residue-list-claims-a-bounded-batch.test.ts",
  "services/api/tests/utils/residue-orphaned-by-a-crashed-delete-is-purged.test.ts",
  "services/api/tests/utils/rollback-discards-push-residue-that-lands-after-the-abort-window.test.ts",
  "services/api/tests/utils/rollback-discards-recorded-residue-even-when-the-tombstone-erase-fails.test.ts",
  "services/api/tests/utils/teardown-blocked-error-survives-the-step-deadline.test.ts",
  "services/api/tests/utils/teardown-rollback-clears-push-channel-residue.test.ts",
  "services/api/tests/utils/teardown-rollback-fails-loudly-when-its-residue-store-cannot-delete.test.ts",
  "services/cron/tests/jobs/residue-token-refresh-honours-the-repair-deadline.test.ts",
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
    /aborted-run|deleted-user|delete-user|deregister-user-channels|grant|reaper|remove-user-sync-jobs|residue|revoke|tombstone|user-deleted|user-is-deleted/;
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
