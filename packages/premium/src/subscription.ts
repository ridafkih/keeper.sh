import { userSubscriptionsTable } from "@keeper.sh/database/schema";
import { eq } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import {
  FREE_DESTINATION_LIMIT,
  FREE_SOURCE_LIMIT,
  PRO_DESTINATION_LIMIT,
  PRO_SOURCE_LIMIT,
  planSchema,
} from "./constants";
import type { Plan } from "./constants";

const FIRST_RESULT_LIMIT = 1;

interface PremiumConfig {
  database: BunSQLDatabase;
  commercialMode: boolean;
}

interface PremiumService {
  getUserPlan: (userId: string) => Promise<Plan>;
  getSourceLimit: (plan: Plan) => number;
  getDestinationLimit: (plan: Plan) => number;
  canAddSource: (userId: string, currentCount: number) => Promise<boolean>;
  canAddDestination: (userId: string, currentCount: number) => Promise<boolean>;
}

const createPremiumService = (config: PremiumConfig): PremiumService => {
  const { database, commercialMode } = config;

  const fetchUserSubscriptionPlan = async (userId: string): Promise<Plan> => {
    const [subscription] = await database
      .select({ plan: userSubscriptionsTable.plan })
      .from(userSubscriptionsTable)
      .where(eq(userSubscriptionsTable.userId, userId))
      .limit(FIRST_RESULT_LIMIT);

    return planSchema.assert(subscription?.plan ?? "free");
  };

  const getUserPlan = (userId: string): Promise<Plan> => {
    if (!commercialMode) {
      return Promise.resolve("pro");
    }
    return fetchUserSubscriptionPlan(userId);
  };

  const getSourceLimit = (plan: Plan): number => {
    if (plan === "pro") {
      return PRO_SOURCE_LIMIT;
    }
    return FREE_SOURCE_LIMIT;
  };

  const getDestinationLimit = (plan: Plan): number => {
    if (plan === "pro") {
      return PRO_DESTINATION_LIMIT;
    }
    return FREE_DESTINATION_LIMIT;
  };

  const canAddSource = async (userId: string, currentCount: number): Promise<boolean> => {
    const plan = await getUserPlan(userId);
    const limit = getSourceLimit(plan);
    return currentCount < limit;
  };

  const canAddDestination = async (userId: string, currentCount: number): Promise<boolean> => {
    const plan = await getUserPlan(userId);
    const limit = getDestinationLimit(plan);
    return currentCount < limit;
  };

  return {
    canAddDestination,
    canAddSource,
    getDestinationLimit,
    getSourceLimit,
    getUserPlan,
  };
};

export { createPremiumService };
export type { PremiumConfig, PremiumService };
