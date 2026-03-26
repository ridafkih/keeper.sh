import { userSubscriptionsTable } from "@keeper.sh/database/schema";
import { eq } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import {
  PRO_ACCOUNT_LIMIT,
  PRO_MAPPING_LIMIT,
  UNLIMITED_ACCOUNT_LIMIT,
  UNLIMITED_MAPPING_LIMIT,
} from "./constants";
import { planSchema } from "@keeper.sh/data-schemas";
import type { EffectivePlan } from "@keeper.sh/data-schemas";

const FIRST_RESULT_LIMIT = 1;
const TRIAL_DURATION_MS = 3 * 24 * 60 * 60 * 1000;
const NO_LIMIT = 0;

interface PremiumConfig {
  database: BunSQLDatabase;
  commercialMode: boolean;
}

interface UserSubscription {
  plan: EffectivePlan;
}

interface PremiumService {
  getUserPlan: (userId: string) => Promise<EffectivePlan>;
  getUserSubscription: (userId: string) => Promise<UserSubscription>;
  getAccountLimit: (plan: EffectivePlan) => number;
  getMappingLimit: (plan: EffectivePlan) => number;
  canAddAccount: (userId: string, currentCount: number) => Promise<boolean>;
  canAddMapping: (userId: string, currentCount: number) => Promise<boolean>;
  canUseEventFilters: (userId: string) => Promise<boolean>;
  canCustomizeIcalFeed: (userId: string) => Promise<boolean>;
}

const createPremiumService = (config: PremiumConfig): PremiumService => {
  const { database, commercialMode } = config;

  const resolveEffectivePlan = (row: {
    plan: string | null;
    grandfatheredPlan: string | null;
    polarSubscriptionId: string | null;
    trialEndsAt: Date | null;
  }): EffectivePlan => {
    if (row.polarSubscriptionId && row.plan) {
      return planSchema.assert(row.plan);
    }

    if (row.grandfatheredPlan) {
      return planSchema.assert(row.grandfatheredPlan);
    }

    if (row.trialEndsAt && row.trialEndsAt.getTime() > Date.now()) {
      return "unlimited";
    }

    return null;
  };

  const createTrialRow = async (userId: string): Promise<UserSubscription> => {
    const trialEndsAt = new Date(Date.now() + TRIAL_DURATION_MS);

    await database
      .insert(userSubscriptionsTable)
      .values({
        trialEndsAt,
        userId,
      })
      .onConflictDoUpdate({
        set: { trialEndsAt },
        target: userSubscriptionsTable.userId,
      });

    return { plan: "unlimited" };
  };

  const fetchUserSubscription = async (userId: string): Promise<UserSubscription> => {
    const [subscription] = await database
      .select({
        grandfatheredPlan: userSubscriptionsTable.grandfatheredPlan,
        plan: userSubscriptionsTable.plan,
        polarSubscriptionId: userSubscriptionsTable.polarSubscriptionId,
        trialEndsAt: userSubscriptionsTable.trialEndsAt,
      })
      .from(userSubscriptionsTable)
      .where(eq(userSubscriptionsTable.userId, userId))
      .limit(FIRST_RESULT_LIMIT);

    if (!subscription) {
      return createTrialRow(userId);
    }

    return { plan: resolveEffectivePlan(subscription) };
  };

  const getUserSubscription = (userId: string): Promise<UserSubscription> => {
    if (!commercialMode) {
      return Promise.resolve({ plan: "unlimited" });
    }
    return fetchUserSubscription(userId);
  };

  const getUserPlan = async (userId: string): Promise<EffectivePlan> => {
    const subscription = await getUserSubscription(userId);
    return subscription.plan;
  };

  const getAccountLimit = (plan: EffectivePlan): number => {
    if (plan === "unlimited") {
      return UNLIMITED_ACCOUNT_LIMIT;
    }
    if (plan === "pro") {
      return PRO_ACCOUNT_LIMIT;
    }
    return NO_LIMIT;
  };

  const getMappingLimit = (plan: EffectivePlan): number => {
    if (plan === "unlimited") {
      return UNLIMITED_MAPPING_LIMIT;
    }
    if (plan === "pro") {
      return PRO_MAPPING_LIMIT;
    }
    return NO_LIMIT;
  };

  const canAddAccount = async (userId: string, currentCount: number): Promise<boolean> => {
    const subscription = await getUserSubscription(userId);
    const limit = getAccountLimit(subscription.plan);
    return currentCount < limit;
  };

  const canAddMapping = async (userId: string, currentCount: number): Promise<boolean> => {
    const subscription = await getUserSubscription(userId);
    const limit = getMappingLimit(subscription.plan);
    return currentCount < limit;
  };

  const canUseEventFilters = async (userId: string): Promise<boolean> => {
    const subscription = await getUserSubscription(userId);
    return subscription.plan === "pro" || subscription.plan === "unlimited";
  };

  const canCustomizeIcalFeed = async (userId: string): Promise<boolean> => {
    const subscription = await getUserSubscription(userId);
    return subscription.plan === "pro" || subscription.plan === "unlimited";
  };

  return {
    canAddAccount,
    canAddMapping,
    canCustomizeIcalFeed,
    canUseEventFilters,
    getAccountLimit,
    getMappingLimit,
    getUserPlan,
    getUserSubscription,
  };
};

export { createPremiumService, TRIAL_DURATION_MS };
export type { PremiumConfig, PremiumService };
