import { calendarAccountsTable, userSubscriptionsTable } from "@keeper.sh/database/schema";
import { eq } from "drizzle-orm";
import { withAuth, withWideEvent } from "@/utils/middleware";
import { database, premiumService } from "@/context";
import { getUserMappings } from "@/utils/source-destination-mappings";

const GET = withWideEvent(
  withAuth(async ({ userId }) => {
    const [accounts, mappings, plan, subscriptionRow] = await Promise.all([
      database
        .select({ id: calendarAccountsTable.id })
        .from(calendarAccountsTable)
        .where(eq(calendarAccountsTable.userId, userId)),
      getUserMappings(userId),
      premiumService.getUserPlan(userId),
      database
        .select({ trialEndsAt: userSubscriptionsTable.trialEndsAt })
        .from(userSubscriptionsTable)
        .where(eq(userSubscriptionsTable.userId, userId))
        .then((rows) => rows[0] ?? null),
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

    const trialEndsAt = subscriptionRow?.trialEndsAt ?? null;
    let trial: { endsAt: string } | null = null;
    if (trialEndsAt && trialEndsAt.getTime() > Date.now()) {
      trial = { endsAt: trialEndsAt.toISOString() };
    }

    return Response.json({
      accounts: {
        current: accounts.length,
        limit: resolvedAccountLimit,
      },
      canUseEventFilters: plan === "pro" || plan === "unlimited",
      canCustomizeIcalFeed: plan === "pro" || plan === "unlimited",
      mappings: {
        current: mappings.length,
        limit: resolvedMappingLimit,
      },
      plan,
      trial,
    });
  }),
);

export { GET };
