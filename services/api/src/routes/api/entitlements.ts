import { calendarAccountsTable, icalFeedsTable, syncsTable } from "@keeper.sh/database/schema";
import type { Plan } from "@keeper.sh/data-schemas";
import { eq } from "drizzle-orm";
import { withAuth, withWideEvent } from "@/utils/middleware";
import { database, premiumService, webhookConfig } from "@/context";

interface EntitlementsRouteContext {
  userId: string;
}

interface EntitlementsDependencies {
  getAccountCount: (userId: string) => Promise<number>;
  getAccountLimit: (plan: Plan) => number;
  getFeedCount: (userId: string) => Promise<number>;
  getFeedLimit: (plan: Plan) => number;
  getSyncCount: (userId: string) => Promise<number>;
  getSyncLimit: (plan: Plan) => number;
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
  const [accountCount, syncCount, feedCount, plan] = await Promise.all([
    dependencies.getAccountCount(context.userId),
    dependencies.getSyncCount(context.userId),
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
    plan,
    realtimeSync: plan === "pro" && dependencies.webhookConfigured,
    syncs: {
      current: syncCount,
      limit: toReportedLimit(dependencies.getSyncLimit(plan)),
    },
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
    getSyncCount: async (resolvedUserId) => {
      const syncs = await database
        .select({ id: syncsTable.id })
        .from(syncsTable)
        .where(eq(syncsTable.userId, resolvedUserId));
      return syncs.length;
    },
    getSyncLimit: (plan) => premiumService.getSyncLimit(plan),
    getUserPlan: (resolvedUserId) => premiumService.getUserPlan(resolvedUserId),
    webhookConfigured: webhookConfig !== null,
  })),
);

export { GET, handleEntitlementsRoute };
export type { EntitlementsDependencies, EntitlementsRouteContext };
