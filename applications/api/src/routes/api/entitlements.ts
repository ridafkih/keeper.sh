import { calendarAccountsTable } from "@keeper.sh/database/schema";
import { eq } from "drizzle-orm";
import { withAuth, withWideEvent } from "../../utils/middleware";
import { database, premiumService } from "../../context";
import { getUserMappings } from "../../utils/source-destination-mappings";

const GET = withWideEvent(
  withAuth(async ({ userId }) => {
    const [accounts, mappings, plan] = await Promise.all([
      database
        .select({ id: calendarAccountsTable.id })
        .from(calendarAccountsTable)
        .where(eq(calendarAccountsTable.userId, userId)),
      getUserMappings(userId),
      premiumService.getUserPlan(userId),
    ]);

    const accountLimit = premiumService.getAccountLimit(plan);
    const mappingLimit = premiumService.getMappingLimit(plan);
    let resolvedAccountLimit: number | null = null;
    let resolvedMappingLimit: number | null = null;

    if (Number.isFinite(accountLimit)) {
      resolvedAccountLimit = accountLimit;
    }

    if (Number.isFinite(mappingLimit)) {
      resolvedMappingLimit = mappingLimit;
    }

    return Response.json({
      accounts: {
        current: accounts.length,
        limit: resolvedAccountLimit,
      },
      canUseEventFilters: plan === "pro",
      canCustomizeIcalFeed: plan === "pro",
      mappings: {
        current: mappings.length,
        limit: resolvedMappingLimit,
      },
      plan,
    });
  }),
);

export { GET };
