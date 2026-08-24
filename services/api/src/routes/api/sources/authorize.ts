import { oauthCredentialsTable } from "@keeper.sh/database/schema";
import { and, eq } from "drizzle-orm";
import { withAuth, withWideEvent } from "@/utils/middleware";
import { ErrorResponse } from "@/utils/responses";
import { getAuthorizationUrl, isOAuthProvider } from "@/utils/destinations";
import { sourceAuthorizeQuerySchema } from "@/utils/request-query";
import { baseUrl, database } from "@/context";

const FIRST_RESULT_LIMIT = 1;

const userOwnsSourceCredential = async (userId: string, credentialId: string): Promise<boolean> => {
  const [credential] = await database
    .select({ id: oauthCredentialsTable.id })
    .from(oauthCredentialsTable)
    .where(
      and(
        eq(oauthCredentialsTable.id, credentialId),
        eq(oauthCredentialsTable.userId, userId),
      ),
    )
    .limit(FIRST_RESULT_LIMIT);

  return Boolean(credential);
};

const GET = withWideEvent(
  withAuth(async ({ request, userId }) => {
    const url = new URL(request.url);
    const query = Object.fromEntries(url.searchParams.entries());
    const provider = url.searchParams.get("provider");
    const credentialId = url.searchParams.get("credentialId");

    if (
      !sourceAuthorizeQuerySchema.allows(query)
      || !provider
      || !isOAuthProvider(provider)
    ) {
      return ErrorResponse.badRequest("Unsupported provider").toResponse();
    }

    if (credentialId) {
      const ownsCredential = await userOwnsSourceCredential(userId, credentialId);
      if (!ownsCredential) {
        return ErrorResponse.notFound("Source credential not found").toResponse();
      }
    }

    const callbackUrl = new URL(`/api/sources/callback/${provider}`, baseUrl);
    const authorizationOptions: {
      callbackUrl: string;
      sourceCredentialId?: string;
    } = {
      callbackUrl: callbackUrl.toString(),
    };
    if (credentialId) {
      authorizationOptions.sourceCredentialId = credentialId;
    }
    const authUrl = await getAuthorizationUrl(provider, userId, authorizationOptions);

    return Response.redirect(authUrl);
  }),
);

export { GET };
