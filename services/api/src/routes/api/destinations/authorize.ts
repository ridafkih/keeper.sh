import { calendarAccountsTable } from "@keeper.sh/database/schema";
import { and, count, eq } from "drizzle-orm";
import { withAuth, withWideEvent } from "@/utils/middleware";
import { ErrorResponse } from "@/utils/responses";
import { getAuthorizationUrl, isOAuthProvider } from "@/utils/destinations";
import { destinationAuthorizeQuerySchema } from "@/utils/request-query";
import { baseUrl, database, premiumService } from "@/context";

const FIRST_RESULT_LIMIT = 1;

const userOwnsDestination = async (userId: string, accountId: string): Promise<boolean> => {
  const [account] = await database
    .select({ id: calendarAccountsTable.id })
    .from(calendarAccountsTable)
    .where(
      and(
        eq(calendarAccountsTable.id, accountId),
        eq(calendarAccountsTable.userId, userId),
      ),
    )
    .limit(FIRST_RESULT_LIMIT);

  return Boolean(account);
};

const countUserAccounts = async (userId: string): Promise<number> => {
  const [result] = await database
    .select({ value: count() })
    .from(calendarAccountsTable)
    .where(eq(calendarAccountsTable.userId, userId));

  return result?.value ?? 0;
};

const GET = withWideEvent(
  withAuth(async ({ request, userId }) => {
    const url = new URL(request.url);
    const query = Object.fromEntries(url.searchParams.entries());
    const provider = url.searchParams.get("provider");
    const destinationId = url.searchParams.get("destinationId");

    if (
      !destinationAuthorizeQuerySchema.allows(query)
      || !provider
      || !isOAuthProvider(provider)
    ) {
      return ErrorResponse.badRequest("Unsupported provider").toResponse();
    }

    if (destinationId) {
      const ownsDestination = await userOwnsDestination(userId, destinationId);
      if (!ownsDestination) {
        return ErrorResponse.notFound("Destination not found").toResponse();
      }
    } else {
      const accountCount = await countUserAccounts(userId);
      const allowed = await premiumService.canAddAccount(userId, accountCount);

      if (!allowed) {
        const errorUrl = new URL("/dashboard/integrations", baseUrl);
        errorUrl.searchParams.set(
          "error",
          "Account limit reached. Upgrade to Pro for unlimited accounts.",
        );
        return Response.redirect(errorUrl.toString());
      }
    }

    const callbackUrl = new URL(`/api/destinations/callback/${provider}`, baseUrl);
    const authorizationOptions: {
      callbackUrl: string;
      destinationId?: string;
    } = {
      callbackUrl: callbackUrl.toString(),
    };
    if (destinationId) {
      authorizationOptions.destinationId = destinationId;
    }
    const authUrl = await getAuthorizationUrl(provider, userId, authorizationOptions);

    return Response.redirect(authUrl);
  }),
);

export { GET };
