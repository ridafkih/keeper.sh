import { calendarAccountsTable, icalFeedsTable } from "@keeper.sh/database/schema";
import type { Plan } from "@keeper.sh/data-schemas";
import { eq } from "drizzle-orm";
import { withAuth, withWideEvent } from "@/utils/middleware";
import { database, premiumService, webhookConfig } from "@/context";
import { getUserMappings } from "@/utils/source-destination-mappings";

interface EntitlementsRouteContext {
  userId: string;
}

interface EntitlementsDependencies {
  getAccountCount: (userId: string) => Promise<number>;
  getAccountLimit: (plan: Plan) => number;
  getFeedCount: (userId: string) => Promise<number>;
  getFeedLimit: (plan: Plan) => number;
  getMappingCount: (userId: string) => Promise<number>;
  getMappingLimit: (plan: Plan) => number;
  getUserPlan: (userId: string) => Promise<Plan>;
  webhookConfigured: boolean;
}

const toReportedLimit = (limit: number): number | null => {
  if (Number.isFinite(limit)) {
    return limit;
  }
  return null;
};

const handleEntitlementsRoute = async (
  context: EntitlementsRouteContext,
  dependencies: EntitlementsDependencies,
): Promise<Response> => {
  const [accountCount, mappingCount, feedCount, plan] = await Promise.all([
    dependencies.getAccountCount(context.userId),
    dependencies.getMappingCount(context.userId),
    dependencies.getFeedCount(context.userId),
    dependencies.getUserPlan(context.userId),
  ]);

  return Response.json({
    accounts: {
      current: accountCount,
      limit: toReportedLimit(dependencies.getAccountLimit(plan)),
    },
    canCustomizeIcalFeed: plan === "pro",
    canUseEventFilters: plan === "pro",
    feeds: {
      current: feedCount,
      limit: toReportedLimit(dependencies.getFeedLimit(plan)),
    },
    mappings: {
      current: mappingCount,
      limit: toReportedLimit(dependencies.getMappingLimit(plan)),
    },
    plan,
    realtimeSync: plan === "pro" && dependencies.webhookConfigured,
  });
};

const GET = withWideEvent(
  withAuth(({ userId }) => handleEntitlementsRoute({ userId }, {
    getAccountCount: async (resolvedUserId) => {
      const accounts = await database
        .select({ id: calendarAccountsTable.id })
        .from(calendarAccountsTable)
        .where(eq(calendarAccountsTable.userId, resolvedUserId));
      return accounts.length;
    },
    getAccountLimit: (plan) => premiumService.getAccountLimit(plan),
    getFeedCount: async (resolvedUserId) => {
      const feeds = await database
        .select({ id: icalFeedsTable.id })
        .from(icalFeedsTable)
        .where(eq(icalFeedsTable.userId, resolvedUserId));
      return feeds.length;
    },
    getFeedLimit: (plan) => premiumService.getFeedLimit(plan),
    getMappingCount: async (resolvedUserId) => {
      const mappings = await getUserMappings(resolvedUserId);
      return mappings.length;
    },
    getMappingLimit: (plan) => premiumService.getMappingLimit(plan),
    getUserPlan: (resolvedUserId) => premiumService.getUserPlan(resolvedUserId),
    webhookConfigured: webhookConfig !== null,
  })),
);

export { GET, handleEntitlementsRoute };
export type { EntitlementsDependencies, EntitlementsRouteContext };
