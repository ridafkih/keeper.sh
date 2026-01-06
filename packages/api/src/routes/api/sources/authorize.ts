import { oauthSourceCredentialsTable } from "@keeper.sh/database/schema";
import { and, eq } from "drizzle-orm";
import { withAuth, withWideEvent } from "../../../utils/middleware";
import { ErrorResponse } from "../../../utils/responses";
import { getAuthorizationUrl, isOAuthProvider } from "../../../utils/destinations";
import { baseUrl, database } from "../../../context";

const FIRST_RESULT_LIMIT = 1;

const userOwnsSourceCredential = async (
  userId: string,
  credentialId: string,
): Promise<boolean> => {
  const [credential] = await database
    .select({ id: oauthSourceCredentialsTable.id })
    .from(oauthSourceCredentialsTable)
    .where(
      and(
        eq(oauthSourceCredentialsTable.id, credentialId),
        eq(oauthSourceCredentialsTable.userId, userId),
      ),
    )
    .limit(FIRST_RESULT_LIMIT);

  return Boolean(credential);
};

const GET = withWideEvent(
  withAuth(async ({ request, userId }) => {
    const url = new URL(request.url);
    const provider = url.searchParams.get("provider");
    const credentialId = url.searchParams.get("credentialId");

    if (!provider || !isOAuthProvider(provider)) {
      return ErrorResponse.badRequest("Unsupported provider").toResponse();
    }

    const isReauthentication = credentialId !== null;

    if (isReauthentication) {
      const ownsCredential = await userOwnsSourceCredential(userId, credentialId);
      if (!ownsCredential) {
        return ErrorResponse.notFound("Source credential not found").toResponse();
      }
    }

    const callbackUrl = new URL(`/api/sources/callback/${provider}`, baseUrl);
    const authorizationOptions = {
      callbackUrl: callbackUrl.toString(),
      ...(credentialId && { sourceCredentialId: credentialId }),
    };
    const authUrl = getAuthorizationUrl(provider, userId, authorizationOptions);

    return Response.redirect(authUrl);
  }),
);

export { GET };
