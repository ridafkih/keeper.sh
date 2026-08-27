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
  "packages/auth/tests/delete-user-teardown-ordering.test.ts",
  "packages/auth/tests/delete-user-teardown.test.ts",
  "packages/auth/tests/failed-delete-user-does-not-strand-the-account.test.ts",
  "packages/auth/tests/polar-customer-delete.test.ts",
  "packages/calendar/tests/core/deletion/a-permanently-failing-residue-repair-retires-at-its-attempt-cap.test.ts",
  "packages/calendar/tests/core/deletion/expired-oauth-grant-residue-is-retired-instead-of-retried-forever.test.ts",
  "packages/calendar/tests/core/deletion/grant-revocation-waits-out-the-in-flight-push-residue-window.test.ts",
  "packages/calendar/tests/core/deletion/no-residue-is-retired-before-its-expiry.test.ts",
  "packages/calendar/tests/core/deletion/one-stalled-residue-repair-cannot-freeze-the-whole-reaper.test.ts",
  "packages/calendar/tests/core/deletion/reaper-refuses-oauth-residue-without-account-email.test.ts",
  "packages/calendar/tests/core/deletion/reaper-refuses-to-revoke-a-google-account-a-surviving-user-still-holds.test.ts",
  "packages/calendar/tests/core/deletion/reaper-revokes-oauth-grant-residue.test.ts",
  "packages/calendar/tests/core/deletion/unresolved-grant-identity-keeps-its-residue.test.ts",
  "packages/calendar/tests/core/sync-engine/aborted-run-is-alertable.test.ts",
  "packages/calendar/tests/core/sync-engine/aborted-run-is-visible-to-the-caller.test.ts",
  "packages/calendar/tests/core/sync-engine/in-flight-sync-aborts-when-user-is-deleted.test.ts",
  "packages/calendar/tests/core/sync-engine/tombstone-write-lost-halts-on-missing-user-row.test.ts",
  "packages/calendar/tests/core/sync-engine/user-deleted-check-reprobes-user-row.test.ts",
  "packages/calendar/tests/core/sync-engine/user-deleted-fallback-answers-before-the-first-chunk.test.ts",
  "packages/queue/tests/remove-user-sync-jobs.test.ts",
  "packages/sync/tests/aborted-run-does-not-clear-backoff.test.ts",
  "packages/sync/tests/aborted-run-verdict.test.ts",
  "services/api/tests/utils/deadline-abort-preserves-abandoned-push-channel-residue.test.ts",
  "services/api/tests/utils/delete-user-teardown-budget-fits-auth-deadline.test.ts",
  "services/api/tests/utils/delete-user-teardown-deadline.test.ts",
  "services/api/tests/utils/delete-user-teardown-push-restate.test.ts",
  "services/api/tests/utils/delete-user-teardown-tombstone-abort.test.ts",
  "services/api/tests/utils/delete-user-teardown.test.ts",
  "services/api/tests/utils/every-residue-write-is-registered-before-it-is-awaited.test.ts",
  "services/api/tests/utils/failed-teardown-steps-leave-durable-repairable-residue.test.ts",
  "services/api/tests/utils/grants-revoked-only-after-the-delete-commits.test.ts",
  "services/api/tests/utils/oauth-grant-residue-carries-the-provider-account-id.test.ts",
  "services/api/tests/utils/oauth-grant-residue-records-the-google-account.test.ts",
  "services/api/tests/utils/push-channel-residue-survives-work-that-settles-after-the-abort-window.test.ts",
  "services/api/tests/utils/push-notifications/delete-user-channel-listing-retries-a-transient-failure.test.ts",
  "services/api/tests/utils/push-notifications/deregister-user-channels-abandoned-are-loud.test.ts",
  "services/api/tests/utils/push-notifications/deregister-user-channels-abandoned-attribution.test.ts",
  "services/api/tests/utils/push-notifications/deregister-user-channels-concurrency.test.ts",
  "services/api/tests/utils/push-notifications/deregister-user-channels-stop-deadline.test.ts",
  "services/api/tests/utils/push-notifications/deregister-user-channels.test.ts",
  "services/api/tests/utils/push-residue-abandoned-before-dialing-carries-its-stored-credential.test.ts",
  "services/api/tests/utils/residue-claim-skips-rows-whose-user-row-still-exists.test.ts",
  "services/api/tests/utils/residue-deletion-requires-a-surviving-user-row.test.ts",
  "services/api/tests/utils/residue-list-claims-a-bounded-batch.test.ts",
  "services/api/tests/utils/residue-orphaned-by-a-crashed-delete-is-purged.test.ts",
  "services/api/tests/utils/revocable-grants-recorded-for-the-reaper.test.ts",
  "services/api/tests/utils/rollback-discards-push-residue-that-lands-after-the-abort-window.test.ts",
  "services/api/tests/utils/rollback-discards-recorded-residue-even-when-the-tombstone-erase-fails.test.ts",
  "services/api/tests/utils/teardown-rollback-clears-push-channel-residue.test.ts",
  "services/api/tests/utils/teardown-rollback-fails-loudly-when-its-residue-store-cannot-delete.test.ts",
  "services/cron/tests/jobs/a-google-credential-linked-to-no-calendar-account-does-not-block-every-revocation.test.ts",
  "services/cron/tests/jobs/an-already-revoked-grant-stops-being-retried-for-eight-days.test.ts",
  "services/cron/tests/jobs/census-defers-when-only-an-email-distinguishes-a-credential-from-the-residue-account.test.ts",
  "services/cron/tests/jobs/reaper-cohort-guard-is-case-insensitive-on-account-email.test.ts",
  "services/cron/tests/jobs/reaper-counts-a-co-holder-by-its-calendar-account-email.test.ts",
  "services/cron/tests/jobs/reaper-counts-calendar-account-holders-as-co-holders.test.ts",
  "services/cron/tests/jobs/reaper-counts-social-sign-in-account-rows-as-co-holders.test.ts",
  "services/cron/tests/jobs/reaper-counts-unknown-account-identity-as-a-co-holder.test.ts",
  "services/cron/tests/jobs/reaper-ignores-null-email-credentials-for-a-different-account.test.ts",
  "services/cron/tests/jobs/reaper-refuses-to-revoke-a-google-account-a-surviving-user-still-holds.test.ts",
  "services/cron/tests/jobs/reaper-treats-a-null-account-id-calendar-row-as-unresolved-identity.test.ts",
  "services/cron/tests/jobs/reaper-treats-a-stale-email-credential-with-a-null-account-id-as-unresolved.test.ts",
  "services/cron/tests/jobs/unknown-identity-credential-row-defers-instead-of-blocking-every-revocation.test.ts",
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
