import {
  OAUTH_GRANT_RESIDUE_KIND,
  POLAR_CUSTOMER_RESIDUE_KIND,
  PUSH_CHANNEL_RESIDUE_KIND,
} from "./teardown-residue";
import type { TeardownResidueRecord, TeardownResidueStore } from "./teardown-residue";
import { GOOGLE_PUSH_PROFILE } from "../source/push-provider-profile";
import type {
  RegistrarContext,
  SourcePushRegistrar,
  StoredPushChannel,
} from "../source/push-channel";

const RESIDUE_REPAIR_FAILED_SLUG = "teardown-residue-repair-failed";
const RESIDUE_STALE_SLUG = "teardown-residue-stale";
const RESIDUE_UNSTOPPABLE_SLUG = "teardown-residue-unstoppable-without-resource-id";
const RESOURCE_ID_REQUIRING_PUSH_PROVIDER = GOOGLE_PUSH_PROFILE.provider;
const NO_ATTEMPTS = 0;
const MAX_RESIDUE_REPAIR_ATTEMPTS = 6;
const PERMANENT_FAILURE_ATTEMPT_CAP = 24;

type ResidueRetirementReason =
  | "expired_after_max_attempts"
  | "outlived_its_provider_channel"
  | "permanent_failure_attempt_cap"
  | "revocation_deferral_expired"
  | "unstoppable_without_resource_id";

interface TeardownResidueReaperDependencies {
  createRegistrarContext: (
    record: TeardownResidueRecord,
    signal: AbortSignal,
  ) => Promise<RegistrarContext>;
  deletePolarCustomer: (externalId: string) => Promise<void>;
  now: () => Date;
  observe: (fields: Record<string, unknown>) => void;
  recordError: (error: unknown, slug: string) => void;
  repairDeadlineMs: number;
  residue: TeardownResidueStore;
  resolveRegistrar: (provider: string) => SourcePushRegistrar | null;
  waitForRepairDeadline: (deadlineMs: number) => Promise<void>;
}

interface TeardownResidueReaperOutcome {
  clearedIds: string[];
  expiredIds: string[];
  failedIds: string[];
  purgedIds: string[];
  revocationSkippedIds: string[];
  scannedCount: number;
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
  signal: AbortSignal,
): Promise<void> => {
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

  const context = await dependencies.createRegistrarContext(record, signal);

  if (signal.aborted) {
    throw new Error(
      `Repair of push channel residue ${record.id} for user ${record.userId} was abandoned on its deadline, so ${provider} channel ${providerChannelId} must not be deregistered by this continuation`,
    );
  }

  await registrar.deregister(
    stopTargetFromResidue(record, providerChannelId, provider, now),
    context,
  );
};

const repairPolarCustomer = async (
  record: TeardownResidueRecord,
  dependencies: TeardownResidueReaperDependencies,
): Promise<void> => {
  if (!record.externalId) {
    throw new Error(
      `Polar residue ${record.id} for user ${record.userId} carries no externalId, so the customer cannot be deleted`,
    );
  }

  await dependencies.deletePolarCustomer(record.externalId);
};

const repairResidue = (
  record: TeardownResidueRecord,
  dependencies: TeardownResidueReaperDependencies,
  now: Date,
  signal: AbortSignal,
): Promise<void> => {
  if (record.kind === PUSH_CHANNEL_RESIDUE_KIND) {
    return repairPushChannel(record, dependencies, now, signal);
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
  abandonment: AbortController,
): Promise<void> => {
  await dependencies.waitForRepairDeadline(dependencies.repairDeadlineMs);

  const abandoned = new Error(
    `Repair of teardown residue ${record.id} (${record.kind}) for user ${record.userId} outran its ${dependencies.repairDeadlineMs}ms deadline and was abandoned`,
  );

  abandonment.abort(abandoned);

  throw abandoned;
};

const repairResidueWithinDeadline = async (
  record: TeardownResidueRecord,
  dependencies: TeardownResidueReaperDependencies,
  now: Date,
): Promise<void> => {
  const abandonment = new AbortController();
  const repair = repairResidue(record, dependencies, now, abandonment.signal);
  const settledUnaided = repair.then(
    () => REPAIR_SETTLED_UNAIDED,
    () => REPAIR_SETTLED_UNAIDED,
  );

  const probe = await Promise.race([settledUnaided, nextEventLoopTurn()]);

  if (probe === REPAIR_SETTLED_UNAIDED) {
    return repair;
  }

  return Promise.race([
    repair,
    abandonRepairOnDeadline(record, dependencies, abandonment),
  ]);
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

const isUnstoppableWithoutResourceId = (record: TeardownResidueRecord): boolean =>
  record.kind === PUSH_CHANNEL_RESIDUE_KIND
  && record.provider === RESOURCE_ID_REQUIRING_PUSH_PROVIDER
  && !record.providerResourceId;

const spendRepairAttemptOrRecordFailure = async (
  record: TeardownResidueRecord,
  dependencies: TeardownResidueReaperDependencies,
  failedIds: string[],
): Promise<TeardownResidueRecord | null> => {
  try {
    return {
      ...record,
      attempts: await dependencies.residue.spendRepairAttempt(record.id),
    };
  } catch (error) {
    dependencies.recordError(error, RESIDUE_REPAIR_FAILED_SLUG);
    failedIds.push(record.id);

    return null;
  }
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
  const expiredIds: string[] = [];
  const retirementReasons: Record<string, ResidueRetirementReason> = {};
  const failedIds: string[] = [];
  const revocationSkippedIds: string[] = [];
  const revocationSkippedUserIds: string[] = [];

  for (const record of records) {
    if (outlivesItsProviderChannel(record, now)) {
      await retireResidue(record, dependencies, "outlived_its_provider_channel", {
        expiredIds,
        failedIds,
        retirementReasons,
      });
      continue;
    }

    if (isUnstoppableWithoutResourceId(record)) {
      dependencies.recordError(
        new Error(
          `Push channel residue ${record.id} for user ${record.userId} names ${record.provider} channel ${String(record.providerChannelId)} with no recorded resource id, so the channel can never be stopped and is being retired as orphaned at the provider`,
        ),
        RESIDUE_UNSTOPPABLE_SLUG,
      );
      await retireResidue(record, dependencies, "unstoppable_without_resource_id", {
        expiredIds,
        failedIds,
        retirementReasons,
      });
      continue;
    }

    if (record.kind === OAUTH_GRANT_RESIDUE_KIND) {
      if (isPastExpiry(record, now)) {
        await retireResidue(record, dependencies, "revocation_deferral_expired", {
          expiredIds,
          failedIds,
          retirementReasons,
        });
        continue;
      }

      revocationSkippedIds.push(record.id);
      revocationSkippedUserIds.push(record.userId);
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

    const attempted = await spendRepairAttemptOrRecordFailure(
      record,
      dependencies,
      failedIds,
    );

    if (!attempted) {
      continue;
    }

    try {
      await repairResidueWithinDeadline(attempted, dependencies, now);

      if (!(await clearResidueOrRecordFailure(record, dependencies, failedIds))) {
        continue;
      }

      clearedIds.push(record.id);
    } catch (error) {
      dependencies.recordError(error, RESIDUE_REPAIR_FAILED_SLUG);

      const failureRetirement = retirementReason(attempted, now);

      if (failureRetirement) {
        await retireResidue(attempted, dependencies, failureRetirement, {
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
    "teardown_residue.expired_count": expiredIds.length,
    "teardown_residue.failed_count": failedIds.length,
    "teardown_residue.hopeless_count": expiredIds.filter(
      (id) => retirementReasons[id] === "permanent_failure_attempt_cap",
    ).length,
    "teardown_residue.purged_count": purgedIds.length,
    "teardown_residue.retirement_reasons": retirementReasons,
    "teardown_residue.revocation_skipped_count": revocationSkippedIds.length,
    "teardown_residue.revocation_skipped_ids": revocationSkippedIds,
    "teardown_residue.revocation_skipped_user_ids": revocationSkippedUserIds,
    "teardown_residue.scanned_count": records.length,
  });

  return {
    clearedIds,
    expiredIds,
    failedIds,
    purgedIds,
    revocationSkippedIds,
    scannedCount: records.length,
  };
};

export {
  createTeardownResidueReaper,
  RESIDUE_REPAIR_FAILED_SLUG,
  RESIDUE_STALE_SLUG,
};
export type {
  TeardownResidueReaperDependencies,
  TeardownResidueReaperOutcome,
};
