import {
  MAX_PUSH_REPAIR_ATTEMPTS_BLOCKING_REVOCATION,
  OAUTH_GRANT_RESIDUE_KIND,
  POLAR_CUSTOMER_RESIDUE_KIND,
  PUSH_CHANNEL_RESIDUE_KIND,
  RESIDUE_LIFETIME_MS,
} from "./teardown-residue";
import type { TeardownResidueRecord, TeardownResidueStore } from "./teardown-residue";
import type {
  RegistrarContext,
  SourcePushRegistrar,
  StoredPushChannel,
} from "../source/push-channel";

const RESIDUE_REPAIR_FAILED_SLUG = "teardown-residue-repair-failed";
const RESIDUE_STALE_SLUG = "teardown-residue-stale";
const RESIDUE_IDENTITY_UNRESOLVED_SLUG = "teardown-residue-identity-unresolved";
const RESIDUE_GRANT_RETIRED_UNREVOKED_SLUG = "teardown-residue-retired-unrevoked";
const NO_ATTEMPTS = 0;
const MAX_RESIDUE_REPAIR_ATTEMPTS = 6;
const PERMANENT_FAILURE_ATTEMPT_CAP = 24;
const NO_SURVIVING_ACCOUNT_LINKS = 0;
const GRANT_REVOCATION_QUIET_PERIOD_MS = 15 * 60 * 1000;

type ResidueRetirementReason =
  | "expired_after_max_attempts"
  | "outlived_its_provider_channel"
  | "permanent_failure_attempt_cap";

type ResidueRepairOutcome =
  | "repaired"
  | "revocation_skipped"
  | "revocation_unresolved";

interface SurvivingAccountLinkCensus {
  coHolders: number;
  identityResolved: boolean;
}

interface TeardownResidueReaperDependencies {
  countSurvivingAccountLinks: (
    record: TeardownResidueRecord,
  ) => Promise<SurvivingAccountLinkCensus>;
  createRegistrarContext: (record: TeardownResidueRecord) => Promise<RegistrarContext>;
  deletePolarCustomer: (externalId: string) => Promise<void>;
  now: () => Date;
  observe: (fields: Record<string, unknown>) => void;
  recordError: (error: unknown, slug: string) => void;
  repairDeadlineMs: number;
  residue: TeardownResidueStore;
  resolveRegistrar: (provider: string) => SourcePushRegistrar | null;
  revokeOAuthGrant: (record: TeardownResidueRecord, token: string) => Promise<void>;
  waitForRepairDeadline: (deadlineMs: number) => Promise<void>;
}

interface TeardownResidueReaperOutcome {
  clearedIds: string[];
  deferredIds: string[];
  expiredIds: string[];
  failedIds: string[];
  purgedIds: string[];
  revocationSkippedIds: string[];
  scannedCount: number;
  unresolvedIds: string[];
}

const stopTargetFromResidue = (
  record: TeardownResidueRecord,
  providerChannelId: string,
  provider: string,
  now: Date,
): StoredPushChannel => ({
  accountId: "",
  calendarId: null,
  createdAt: record.createdAt ?? now,
  expiresAt: record.expiresAt ?? null,
  failureCount: record.attempts ?? NO_ATTEMPTS,
  id: record.id,
  lastFailureAt: null,
  lastNotificationAt: null,
  nextAttemptAt: null,
  provider,
  providerChannelId,
  providerResourceId: record.providerResourceId ?? null,
  reauthorizeRequestedAt: null,
  resourcePath: null,
  secretHash: "",
  state: "active",
  updatedAt: now,
  userId: record.userId,
  verifiedAt: null,
});

const repairPushChannel = async (
  record: TeardownResidueRecord,
  dependencies: TeardownResidueReaperDependencies,
  now: Date,
): Promise<ResidueRepairOutcome> => {
  const { provider, providerChannelId } = record;

  if (!provider || !providerChannelId) {
    throw new Error(
      `Push channel residue ${record.id} for user ${record.userId} carries no provider channel identity, so the channel cannot be stopped`,
    );
  }

  const registrar = dependencies.resolveRegistrar(provider);

  if (!registrar) {
    throw new Error(
      `No push registrar is available for provider ${provider}, so residue ${record.id} cannot be repaired`,
    );
  }

  const context = await dependencies.createRegistrarContext(record);

  await registrar.deregister(
    stopTargetFromResidue(record, providerChannelId, provider, now),
    context,
  );

  return "repaired";
};

const revocationTokenFromResidue = (record: TeardownResidueRecord): string => {
  const { credential } = record;

  if (!credential) {
    throw new Error(
      `OAuth grant residue ${record.id} for user ${record.userId} carries no credential, so the grant cannot be revoked`,
    );
  }

  return credential.refreshToken ?? credential.accessToken;
};

const repairOAuthGrant = async (
  record: TeardownResidueRecord,
  dependencies: TeardownResidueReaperDependencies,
): Promise<ResidueRepairOutcome> => {
  if (!record.accountEmail) {
    throw new Error(
      `OAuth grant residue ${record.id} for user ${record.userId} names no provider account, so a co-holder of the grant cannot be ruled out and the grant must not be revoked`,
    );
  }

  if (!record.providerAccountId) {
    return "revocation_unresolved";
  }

  const census = await dependencies.countSurvivingAccountLinks(record);

  if (!census.identityResolved) {
    return "revocation_unresolved";
  }

  if (census.coHolders > NO_SURVIVING_ACCOUNT_LINKS) {
    return "revocation_skipped";
  }

  await dependencies.revokeOAuthGrant(record, revocationTokenFromResidue(record));

  return "repaired";
};

const repairPolarCustomer = async (
  record: TeardownResidueRecord,
  dependencies: TeardownResidueReaperDependencies,
): Promise<ResidueRepairOutcome> => {
  if (!record.externalId) {
    throw new Error(
      `Polar residue ${record.id} for user ${record.userId} carries no externalId, so the customer cannot be deleted`,
    );
  }

  await dependencies.deletePolarCustomer(record.externalId);

  return "repaired";
};

const repairResidue = (
  record: TeardownResidueRecord,
  dependencies: TeardownResidueReaperDependencies,
  now: Date,
): Promise<ResidueRepairOutcome> => {
  if (record.kind === PUSH_CHANNEL_RESIDUE_KIND) {
    return repairPushChannel(record, dependencies, now);
  }

  if (record.kind === OAUTH_GRANT_RESIDUE_KIND) {
    return repairOAuthGrant(record, dependencies);
  }

  if (record.kind === POLAR_CUSTOMER_RESIDUE_KIND) {
    return repairPolarCustomer(record, dependencies);
  }

  return Promise.reject(
    new Error(`Teardown residue ${record.id} has unrepairable kind ${record.kind}`),
  );
};

const REPAIR_SETTLED_UNAIDED = Symbol("repair-settled-unaided");

const nextEventLoopTurn = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

const abandonRepairOnDeadline = async (
  record: TeardownResidueRecord,
  dependencies: TeardownResidueReaperDependencies,
): Promise<ResidueRepairOutcome> => {
  await dependencies.waitForRepairDeadline(dependencies.repairDeadlineMs);

  throw new Error(
    `Repair of teardown residue ${record.id} (${record.kind}) for user ${record.userId} outran its ${dependencies.repairDeadlineMs}ms deadline and was abandoned`,
  );
};

const repairResidueWithinDeadline = async (
  record: TeardownResidueRecord,
  dependencies: TeardownResidueReaperDependencies,
  now: Date,
): Promise<ResidueRepairOutcome> => {
  const repair = repairResidue(record, dependencies, now);
  const settledUnaided = repair.then(
    () => REPAIR_SETTLED_UNAIDED,
    () => REPAIR_SETTLED_UNAIDED,
  );

  const probe = await Promise.race([settledUnaided, nextEventLoopTurn()]);

  if (probe === REPAIR_SETTLED_UNAIDED) {
    return repair;
  }

  return Promise.race([repair, abandonRepairOnDeadline(record, dependencies)]);
};

const isPastExpiry = (record: TeardownResidueRecord, now: Date): boolean =>
  record.expiresAt instanceof Date && record.expiresAt.getTime() <= now.getTime();

const retirementReason = (
  record: TeardownResidueRecord,
  now: Date,
): ResidueRetirementReason | null => {
  const attempts = record.attempts ?? NO_ATTEMPTS;

  if (!isPastExpiry(record, now)) {
    return null;
  }

  if (attempts >= PERMANENT_FAILURE_ATTEMPT_CAP) {
    return "permanent_failure_attempt_cap";
  }

  if (attempts >= MAX_RESIDUE_REPAIR_ATTEMPTS) {
    return "expired_after_max_attempts";
  }

  return null;
};

const outlivesItsProviderChannel = (
  record: TeardownResidueRecord,
  now: Date,
): boolean => record.kind === PUSH_CHANNEL_RESIDUE_KIND && isPastExpiry(record, now);

const claimedBatchHoldsPushResidue = (
  record: TeardownResidueRecord,
  records: TeardownResidueRecord[],
): boolean =>
  records.some(
    (candidate) =>
      candidate.kind === PUSH_CHANNEL_RESIDUE_KIND
      && candidate.userId === record.userId
      && candidate.provider === record.provider
      && (candidate.attempts ?? NO_ATTEMPTS)
        < MAX_PUSH_REPAIR_ATTEMPTS_BLOCKING_REVOCATION,
  );

const storeHoldsPushResidue = async (
  record: TeardownResidueRecord,
  dependencies: TeardownResidueReaperDependencies,
): Promise<boolean> => {
  const askStore = dependencies.residue.hasUnreapedPushResidue;

  if (!askStore || !record.provider) {
    return false;
  }

  try {
    return await askStore(record.userId, record.provider);
  } catch (error) {
    dependencies.recordError(error, RESIDUE_REPAIR_FAILED_SLUG);

    return true;
  }
};

const awaitsPushChannelReaping = (
  record: TeardownResidueRecord,
  records: TeardownResidueRecord[],
  dependencies: TeardownResidueReaperDependencies,
): Promise<boolean> => {
  if (record.kind !== OAUTH_GRANT_RESIDUE_KIND) {
    return Promise.resolve(false);
  }

  if (claimedBatchHoldsPushResidue(record, records)) {
    return Promise.resolve(true);
  }

  return storeHoldsPushResidue(record, dependencies);
};

const residueRecordedAt = (record: TeardownResidueRecord): Date | null => {
  if (record.createdAt instanceof Date) {
    return record.createdAt;
  }

  if (record.expiresAt instanceof Date) {
    return new Date(record.expiresAt.getTime() - RESIDUE_LIFETIME_MS);
  }

  return null;
};

const awaitsTheInFlightPushResidueWindow = (
  record: TeardownResidueRecord,
  now: Date,
): boolean => {
  if (record.kind !== OAUTH_GRANT_RESIDUE_KIND) {
    return false;
  }

  const recordedAt = residueRecordedAt(record);

  if (!recordedAt) {
    return false;
  }

  return now.getTime() - recordedAt.getTime() < GRANT_REVOCATION_QUIET_PERIOD_MS;
};

const clearResidueOrRecordFailure = async (
  record: TeardownResidueRecord,
  dependencies: TeardownResidueReaperDependencies,
  failedIds: string[],
): Promise<boolean> => {
  try {
    await dependencies.residue.clear(record.id);

    return true;
  } catch (error) {
    dependencies.recordError(error, RESIDUE_REPAIR_FAILED_SLUG);
    failedIds.push(record.id);

    return false;
  }
};

interface ResidueRetirementLedger {
  expiredIds: string[];
  failedIds: string[];
  retirementReasons: Record<string, ResidueRetirementReason>;
}

const retireResidue = async (
  record: TeardownResidueRecord,
  dependencies: TeardownResidueReaperDependencies,
  reason: ResidueRetirementReason,
  ledger: ResidueRetirementLedger,
): Promise<void> => {
  if (!(await clearResidueOrRecordFailure(record, dependencies, ledger.failedIds))) {
    return;
  }

  ledger.expiredIds.push(record.id);
  ledger.retirementReasons[record.id] = reason;
};

const purgeOrphanedOrRecordFailure = async (
  dependencies: TeardownResidueReaperDependencies,
  now: Date,
): Promise<string[]> => {
  try {
    return await dependencies.residue.purgeOrphaned(now);
  } catch (error) {
    dependencies.recordError(error, RESIDUE_REPAIR_FAILED_SLUG);

    return [];
  }
};

const createTeardownResidueReaper = (
  dependencies: TeardownResidueReaperDependencies,
) =>
async (): Promise<TeardownResidueReaperOutcome> => {
  const now = dependencies.now();
  const purgedIds = await purgeOrphanedOrRecordFailure(dependencies, now);
  const records = await dependencies.residue.list();
  const clearedIds: string[] = [];
  const deferredIds: string[] = [];
  const expiredIds: string[] = [];
  const retirementReasons: Record<string, ResidueRetirementReason> = {};
  const failedIds: string[] = [];
  const retiredUnrevokedIds: string[] = [];
  const revocationSkippedIds: string[] = [];
  const unresolvedIds: string[] = [];

  for (const record of records) {
    if (
      (await awaitsPushChannelReaping(record, records, dependencies))
      || awaitsTheInFlightPushResidueWindow(record, now)
    ) {
      deferredIds.push(record.id);
      continue;
    }

    if (outlivesItsProviderChannel(record, now)) {
      await retireResidue(record, dependencies, "outlived_its_provider_channel", {
        expiredIds,
        failedIds,
        retirementReasons,
      });
      continue;
    }

    if (isPastExpiry(record, now)) {
      dependencies.recordError(
        new Error(
          `Teardown residue ${record.id} (${record.kind}) for user ${record.userId} has outlived its repair window and still needs a hand`,
        ),
        RESIDUE_STALE_SLUG,
      );
    }

    try {
      const repairOutcome = await repairResidueWithinDeadline(
        record,
        dependencies,
        now,
      );

      if (repairOutcome === "revocation_unresolved") {
        const unresolvedRetirement = retirementReason(record, now);

        if (unresolvedRetirement) {
          dependencies.recordError(
            new Error(
              `OAuth grant residue ${record.id} for user ${record.userId} is being retired without revoking the ${record.provider} grant held for ${record.accountEmail ?? "an unknown account"}; that refresh token stays live and unaccounted for`,
            ),
            RESIDUE_GRANT_RETIRED_UNREVOKED_SLUG,
          );
          retiredUnrevokedIds.push(record.id);
          await retireResidue(record, dependencies, unresolvedRetirement, {
            expiredIds,
            failedIds,
            retirementReasons,
          });
          continue;
        }

        dependencies.recordError(
          new Error(
            `OAuth grant residue ${record.id} for user ${record.userId} cannot be tied to a provider account whose co-holders are all known, so the grant stays unrevoked and the residue waits for the next pass`,
          ),
          RESIDUE_IDENTITY_UNRESOLVED_SLUG,
        );
        unresolvedIds.push(record.id);
        continue;
      }

      if (!(await clearResidueOrRecordFailure(record, dependencies, failedIds))) {
        continue;
      }

      clearedIds.push(record.id);

      if (repairOutcome === "revocation_skipped") {
        revocationSkippedIds.push(record.id);
      }
    } catch (error) {
      dependencies.recordError(error, RESIDUE_REPAIR_FAILED_SLUG);

      const failureRetirement = retirementReason(record, now);

      if (failureRetirement) {
        await retireResidue(record, dependencies, failureRetirement, {
          expiredIds,
          failedIds,
          retirementReasons,
        });
        continue;
      }

      failedIds.push(record.id);
    }
  }

  dependencies.observe({
    "teardown_residue.cleared_count": clearedIds.length,
    "teardown_residue.deferred_count": deferredIds.length,
    "teardown_residue.expired_count": expiredIds.length,
    "teardown_residue.failed_count": failedIds.length,
    "teardown_residue.hopeless_count": expiredIds.filter(
      (id) => retirementReasons[id] === "permanent_failure_attempt_cap",
    ).length,
    "teardown_residue.purged_count": purgedIds.length,
    "teardown_residue.retired_unrevoked_count": retiredUnrevokedIds.length,
    "teardown_residue.retirement_reasons": retirementReasons,
    "teardown_residue.revocation_skipped_count": revocationSkippedIds.length,
    "teardown_residue.scanned_count": records.length,
    "teardown_residue.unresolved_count": unresolvedIds.length,
  });

  return {
    clearedIds,
    deferredIds,
    expiredIds,
    failedIds,
    purgedIds,
    revocationSkippedIds,
    scannedCount: records.length,
    unresolvedIds,
  };
};

export {
  createTeardownResidueReaper,
  GRANT_REVOCATION_QUIET_PERIOD_MS,
  RESIDUE_GRANT_RETIRED_UNREVOKED_SLUG,
  RESIDUE_IDENTITY_UNRESOLVED_SLUG,
  RESIDUE_REPAIR_FAILED_SLUG,
  RESIDUE_STALE_SLUG,
};
export type {
  SurvivingAccountLinkCensus,
  TeardownResidueReaperDependencies,
  TeardownResidueReaperOutcome,
};
