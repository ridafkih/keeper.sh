import {
  POLAR_CUSTOMER_RESIDUE_KIND,
  PUSH_CHANNEL_RESIDUE_KIND,
} from "./teardown-residue";
import type { TeardownResidueRecord, TeardownResidueStore } from "./teardown-residue";
import type {
  RegistrarContext,
  SourcePushRegistrar,
  StoredPushChannel,
} from "../source/push-channel";

const RESIDUE_REPAIR_FAILED_SLUG = "teardown-residue-repair-failed";
const RESIDUE_STALE_SLUG = "teardown-residue-stale";
const NO_ATTEMPTS = 0;

interface TeardownResidueReaperDependencies {
  createRegistrarContext: (record: TeardownResidueRecord) => Promise<RegistrarContext>;
  deletePolarCustomer: (externalId: string) => Promise<void>;
  now: () => Date;
  observe: (fields: Record<string, unknown>) => void;
  recordError: (error: unknown, slug: string) => void;
  residue: TeardownResidueStore;
  resolveRegistrar: (provider: string) => SourcePushRegistrar | null;
}

interface TeardownResidueReaperOutcome {
  clearedIds: string[];
  expiredIds: string[];
  failedIds: string[];
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

  const context = await dependencies.createRegistrarContext(record);

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
): Promise<void> => {
  if (record.kind === PUSH_CHANNEL_RESIDUE_KIND) {
    return repairPushChannel(record, dependencies, now);
  }

  if (record.kind === POLAR_CUSTOMER_RESIDUE_KIND) {
    return repairPolarCustomer(record, dependencies);
  }

  return Promise.reject(
    new Error(`Teardown residue ${record.id} has unrepairable kind ${record.kind}`),
  );
};

const isPastExpiry = (record: TeardownResidueRecord, now: Date): boolean =>
  record.expiresAt instanceof Date && record.expiresAt.getTime() <= now.getTime();

const outlivesItsProviderChannel = (
  record: TeardownResidueRecord,
  now: Date,
): boolean => record.kind === PUSH_CHANNEL_RESIDUE_KIND && isPastExpiry(record, now);

const createTeardownResidueReaper = (
  dependencies: TeardownResidueReaperDependencies,
) =>
async (): Promise<TeardownResidueReaperOutcome> => {
  const now = dependencies.now();
  const records = await dependencies.residue.list();
  const clearedIds: string[] = [];
  const expiredIds: string[] = [];
  const failedIds: string[] = [];

  for (const record of records) {
    if (outlivesItsProviderChannel(record, now)) {
      await dependencies.residue.clear(record.id);
      expiredIds.push(record.id);
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
      await repairResidue(record, dependencies, now);
      await dependencies.residue.clear(record.id);
      clearedIds.push(record.id);
    } catch (error) {
      dependencies.recordError(error, RESIDUE_REPAIR_FAILED_SLUG);
      failedIds.push(record.id);
    }
  }

  dependencies.observe({
    "teardown_residue.cleared_count": clearedIds.length,
    "teardown_residue.expired_count": expiredIds.length,
    "teardown_residue.failed_count": failedIds.length,
    "teardown_residue.scanned_count": records.length,
  });

  return { clearedIds, expiredIds, failedIds, scannedCount: records.length };
};

export {
  createTeardownResidueReaper,
  RESIDUE_REPAIR_FAILED_SLUG,
  RESIDUE_STALE_SLUG,
};
export type { TeardownResidueReaperDependencies, TeardownResidueReaperOutcome };
