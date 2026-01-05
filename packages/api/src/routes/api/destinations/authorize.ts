import { calendarDestinationsTable } from "@keeper.sh/database/schema";
import { and, eq } from "drizzle-orm";
import { withAuth, withTracing } from "../../../utils/middleware";
import { ErrorResponse } from "../../../utils/responses";
import { getAuthorizationUrl, isOAuthProvider } from "../../../utils/destinations";
import { baseUrl, database, premiumService } from "../../../context";

const FIRST_RESULT_LIMIT = 1;

const userOwnsDestination = async (userId: string, destinationId: string): Promise<boolean> => {
  const [destination] = await database
    .select({ id: calendarDestinationsTable.id })
    .from(calendarDestinationsTable)
    .where(
      and(
        eq(calendarDestinationsTable.id, destinationId),
        eq(calendarDestinationsTable.userId, userId),
      ),
    )
    .limit(FIRST_RESULT_LIMIT);

  return Boolean(destination);
};

const countUserDestinations = async (userId: string): Promise<number> => {
  const destinations = await database
    .select({ id: calendarDestinationsTable.id })
    .from(calendarDestinationsTable)
    .where(eq(calendarDestinationsTable.userId, userId));

  return destinations.length;
};

const GET = withTracing(
  withAuth(async ({ request, userId }) => {
    const url = new URL(request.url);
    const provider = url.searchParams.get("provider");
    const destinationId = url.searchParams.get("destinationId");

    if (!provider || !isOAuthProvider(provider)) {
      return ErrorResponse.badRequest("Unsupported provider").toResponse();
    }

    const isReauthentication = destinationId !== null;

    if (isReauthentication) {
      const ownsDestination = await userOwnsDestination(userId, destinationId);
      if (!ownsDestination) {
        return ErrorResponse.notFound("Destination not found").toResponse();
      }
    } else {
      const destinationCount = await countUserDestinations(userId);
      const allowed = await premiumService.canAddDestination(userId, destinationCount);

      if (!allowed) {
        const errorUrl = new URL("/dashboard/integrations", baseUrl);
        errorUrl.searchParams.set(
          "error",
          "Destination limit reached. Upgrade to Pro for unlimited destinations.",
        );
        return Response.redirect(errorUrl.toString());
      }
    }

    const callbackUrl = new URL(`/api/destinations/callback/${provider}`, baseUrl);
    const authorizationOptions = {
      callbackUrl: callbackUrl.toString(),
      ...(destinationId && { destinationId }),
    };
    const authUrl = getAuthorizationUrl(provider, userId, authorizationOptions);

    return Response.redirect(authUrl);
  }),
);

export { GET };
