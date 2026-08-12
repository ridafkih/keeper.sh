import { calendarAccountsTable, icalFeedsTable } from "@keeper.sh/database/schema";
import { eq } from "drizzle-orm";
import { withAuth, withWideEvent } from "@/utils/middleware";
import { database, premiumService } from "@/context";
import { getUserMappings } from "@/utils/source-destination-mappings";

const GET = withWideEvent(
  withAuth(async ({ userId }) => {
    const [accounts, mappings, feeds, plan] = await Promise.all([
      database
        .select({ id: calendarAccountsTable.id })
        .from(calendarAccountsTable)
        .where(eq(calendarAccountsTable.userId, userId)),
      getUserMappings(userId),
      database
        .select({ id: icalFeedsTable.id })
        .from(icalFeedsTable)
        .where(eq(icalFeedsTable.userId, userId)),
      premiumService.getUserPlan(userId),
    ]);

    const accountLimit = premiumService.getAccountLimit(plan);
    const mappingLimit = premiumService.getMappingLimit(plan);
    const feedLimit = premiumService.getFeedLimit(plan);
    let resolvedAccountLimit: number | null = null;
    let resolvedMappingLimit: number | null = null;
    let resolvedFeedLimit: number | null = null;

    if (Number.isFinite(accountLimit)) {
      resolvedAccountLimit = accountLimit;
    }

    if (Number.isFinite(mappingLimit)) {
      resolvedMappingLimit = mappingLimit;
    }

    if (Number.isFinite(feedLimit)) {
      resolvedFeedLimit = feedLimit;
    }

    return Response.json({
      accounts: {
        current: accounts.length,
        limit: resolvedAccountLimit,
      },
      canUseEventFilters: plan === "pro",
      canCustomizeIcalFeed: plan === "pro",
      feeds: {
        current: feeds.length,
        limit: resolvedFeedLimit,
      },
      mappings: {
        current: mappings.length,
        limit: resolvedMappingLimit,
      },
      plan,
    });
  }),
);

export { GET };
