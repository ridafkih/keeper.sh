import { userSubscriptionsTable } from "@keeper.sh/database/schema";
import { eq } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import {
  FREE_SOURCE_LIMIT,
  PRO_SOURCE_LIMIT,
  FREE_DESTINATION_LIMIT,
  PRO_DESTINATION_LIMIT,
  planSchema,
  type Plan,
} from "./constants";

export interface PremiumConfig {
  database: BunSQLDatabase;
  commercialMode: boolean;
}

export interface PremiumService {
  getUserPlan: (userId: string) => Promise<Plan>;
  getSourceLimit: (plan: Plan) => number;
  getDestinationLimit: (plan: Plan) => number;
  canAddSource: (userId: string, currentCount: number) => Promise<boolean>;
  canAddDestination: (userId: string, currentCount: number) => Promise<boolean>;
}

export const createPremiumService = (config: PremiumConfig): PremiumService => {
  const { database, commercialMode } = config;

  const fetchUserSubscriptionPlan = async (userId: string): Promise<Plan> => {
    const [subscription] = await database
      .select({ plan: userSubscriptionsTable.plan })
      .from(userSubscriptionsTable)
      .where(eq(userSubscriptionsTable.userId, userId))
      .limit(1);

    return planSchema.assert(subscription?.plan ?? "free");
  };

  const getUserPlan = async (userId: string): Promise<Plan> => {
    if (!commercialMode) {
      return "pro";
    }
    return fetchUserSubscriptionPlan(userId);
  };

  const getSourceLimit = (plan: Plan): number => {
    return plan === "pro" ? PRO_SOURCE_LIMIT : FREE_SOURCE_LIMIT;
  };

  const getDestinationLimit = (plan: Plan): number => {
    return plan === "pro" ? PRO_DESTINATION_LIMIT : FREE_DESTINATION_LIMIT;
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
    getUserPlan,
    getSourceLimit,
    getDestinationLimit,
    canAddSource,
    canAddDestination,
  };
};
