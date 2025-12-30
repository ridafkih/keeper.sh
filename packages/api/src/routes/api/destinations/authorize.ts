import { calendarDestinationsTable } from "@keeper.sh/database/schema";
import { eq, and } from "drizzle-orm";
import { withTracing, withAuth } from "../../../utils/middleware";
import {
  getAuthorizationUrl,
  isOAuthProvider,
} from "../../../utils/destinations";
import { database, premiumService, baseUrl } from "../../../context";

const userOwnsDestination = async (userId: string, destinationId: string) => {
  const [destination] = await database
    .select({ id: calendarDestinationsTable.id })
    .from(calendarDestinationsTable)
    .where(
      and(
        eq(calendarDestinationsTable.id, destinationId),
        eq(calendarDestinationsTable.userId, userId),
      ),
    )
    .limit(1);

  return destination !== undefined;
};

const countUserDestinations = async (userId: string) => {
  const destinations = await database
    .select({ id: calendarDestinationsTable.id })
    .from(calendarDestinationsTable)
    .where(eq(calendarDestinationsTable.userId, userId));

  return destinations.length;
};

export const GET = withTracing(
  withAuth(async ({ request, userId }) => {
    const url = new URL(request.url);
    const provider = url.searchParams.get("provider");
    const destinationId = url.searchParams.get("destinationId");

    if (!provider || !isOAuthProvider(provider)) {
      return Response.json({ error: "Unsupported provider" }, { status: 400 });
    }

    const isReauthentication = destinationId !== null;

    if (isReauthentication) {
      const ownsDestination = await userOwnsDestination(userId, destinationId);
      if (!ownsDestination) {
        return Response.json({ error: "Destination not found" }, { status: 404 });
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

    const callbackUrl = new URL(
      `/api/destinations/callback/${provider}`,
      baseUrl,
    );
    const authUrl = getAuthorizationUrl(provider, userId, {
      callbackUrl: callbackUrl.toString(),
      destinationId: destinationId ?? undefined,
    });

    return Response.redirect(authUrl);
  }),
);
