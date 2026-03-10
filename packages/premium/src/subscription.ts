import { userSubscriptionsTable } from "@keeper.sh/database/schema";
import { eq } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import {
  FREE_ACCOUNT_LIMIT,
  FREE_MAPPING_LIMIT,
  PRO_ACCOUNT_LIMIT,
  PRO_MAPPING_LIMIT,
  planSchema,
} from "./constants";
import type { Plan } from "./constants";

const FIRST_RESULT_LIMIT = 1;

interface PremiumConfig {
  database: BunSQLDatabase;
  commercialMode: boolean;
}

interface UserSubscription {
  plan: Plan;
}

interface PremiumService {
  getUserPlan: (userId: string) => Promise<Plan>;
  getUserSubscription: (userId: string) => Promise<UserSubscription>;
  getAccountLimit: (plan: Plan) => number;
  getMappingLimit: (plan: Plan) => number;
  canAddAccount: (userId: string, currentCount: number) => Promise<boolean>;
  canAddMapping: (userId: string, currentCount: number) => Promise<boolean>;
  canUseEventFilters: (userId: string) => Promise<boolean>;
  canCustomizeIcalFeed: (userId: string) => Promise<boolean>;
}

const createPremiumService = (config: PremiumConfig): PremiumService => {
  const { database, commercialMode } = config;

  const fetchUserSubscription = async (userId: string): Promise<UserSubscription> => {
    const [subscription] = await database
      .select({
        plan: userSubscriptionsTable.plan,
      })
      .from(userSubscriptionsTable)
      .where(eq(userSubscriptionsTable.userId, userId))
      .limit(FIRST_RESULT_LIMIT);

    return {
      plan: planSchema.assert(subscription?.plan ?? "free"),
    };
  };

  const getUserSubscription = (userId: string): Promise<UserSubscription> => {
    if (!commercialMode) {
      return Promise.resolve({ plan: "pro" });
    }
    return fetchUserSubscription(userId);
  };

  const getUserPlan = async (userId: string): Promise<Plan> => {
    const subscription = await getUserSubscription(userId);
    return subscription.plan;
  };

  const getAccountLimit = (plan: Plan): number => {
    if (plan === "pro") {
      return PRO_ACCOUNT_LIMIT;
    }
    return FREE_ACCOUNT_LIMIT;
  };

  const getMappingLimit = (plan: Plan): number => {
    if (plan === "pro") {
      return PRO_MAPPING_LIMIT;
    }
    return FREE_MAPPING_LIMIT;
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
    return subscription.plan === "pro";
  };

  const canCustomizeIcalFeed = async (userId: string): Promise<boolean> => {
    const subscription = await getUserSubscription(userId);
    return subscription.plan === "pro";
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

export { createPremiumService };
export type { PremiumConfig, PremiumService };
