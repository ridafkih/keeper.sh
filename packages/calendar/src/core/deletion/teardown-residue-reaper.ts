import {
  OAUTH_GRANT_RESIDUE_KIND,
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
const RESIDUE_IDENTITY_UNRESOLVED_SLUG = "teardown-residue-identity-unresolved";
const NO_ATTEMPTS = 0;
const MAX_PUSH_REPAIR_ATTEMPTS_BLOCKING_REVOCATION = 5;
const MAX_RESIDUE_REPAIR_ATTEMPTS = 6;
const NO_SURVIVING_ACCOUNT_LINKS = 0;

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
  residue: TeardownResidueStore;
  resolveRegistrar: (provider: string) => SourcePushRegistrar | null;
  revokeOAuthGrant: (record: TeardownResidueRecord, token: string) => Promise<void>;
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

const isPastExpiry = (record: TeardownResidueRecord, now: Date): boolean =>
  record.expiresAt instanceof Date && record.expiresAt.getTime() <= now.getTime();

const hasExhaustedItsRepairAttempts = (
  record: TeardownResidueRecord,
  now: Date,
): boolean =>
  isPastExpiry(record, now)
  && (record.attempts ?? NO_ATTEMPTS) >= MAX_RESIDUE_REPAIR_ATTEMPTS;

const outlivesItsProviderChannel = (
  record: TeardownResidueRecord,
  now: Date,
): boolean => record.kind === PUSH_CHANNEL_RESIDUE_KIND && isPastExpiry(record, now);

const awaitsPushChannelReaping = (
  record: TeardownResidueRecord,
  records: TeardownResidueRecord[],
): boolean =>
  record.kind === OAUTH_GRANT_RESIDUE_KIND
  && records.some(
    (candidate) =>
      candidate.kind === PUSH_CHANNEL_RESIDUE_KIND
      && candidate.userId === record.userId
      && candidate.provider === record.provider
      && (candidate.attempts ?? NO_ATTEMPTS)
        < MAX_PUSH_REPAIR_ATTEMPTS_BLOCKING_REVOCATION,
  );

const createTeardownResidueReaper = (
  dependencies: TeardownResidueReaperDependencies,
) =>
async (): Promise<TeardownResidueReaperOutcome> => {
  const now = dependencies.now();
  const purgedIds = await dependencies.residue.purgeOrphaned(now);
  const records = await dependencies.residue.list();
  const clearedIds: string[] = [];
  const deferredIds: string[] = [];
  const expiredIds: string[] = [];
  const failedIds: string[] = [];
  const revocationSkippedIds: string[] = [];
  const unresolvedIds: string[] = [];

  for (const record of records) {
    if (awaitsPushChannelReaping(record, records)) {
      deferredIds.push(record.id);
      continue;
    }

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
      const repairOutcome = await repairResidue(record, dependencies, now);

      if (repairOutcome === "revocation_unresolved") {
        if (hasExhaustedItsRepairAttempts(record, now)) {
          await dependencies.residue.clear(record.id);
          expiredIds.push(record.id);
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

      await dependencies.residue.clear(record.id);
      clearedIds.push(record.id);

      if (repairOutcome === "revocation_skipped") {
        revocationSkippedIds.push(record.id);
      }
    } catch (error) {
      dependencies.recordError(error, RESIDUE_REPAIR_FAILED_SLUG);

      if (hasExhaustedItsRepairAttempts(record, now)) {
        await dependencies.residue.clear(record.id);
        expiredIds.push(record.id);
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
    "teardown_residue.purged_count": purgedIds.length,
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
  RESIDUE_IDENTITY_UNRESOLVED_SLUG,
  RESIDUE_REPAIR_FAILED_SLUG,
  RESIDUE_STALE_SLUG,
};
export type {
  SurvivingAccountLinkCensus,
  TeardownResidueReaperDependencies,
  TeardownResidueReaperOutcome,
};
