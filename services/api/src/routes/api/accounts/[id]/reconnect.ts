import { HTTP_STATUS } from "@keeper.sh/constants";
import { createCalDAVClient, isCalDAVAuthenticationError } from "@keeper.sh/calendar/caldav";
import { withAuth, withWideEvent } from "@/utils/middleware";
import { ErrorResponse } from "@/utils/responses";
import { widelog } from "@/utils/logging";
import { idParamSchema } from "@/utils/request-query";
import { safeFetchOptions } from "@/utils/safe-fetch-options";
import { database } from "@/context";
import {
  applyCalDAVReconnect,
  getCalDAVReconnectTarget,
  ReconnectNotSupportedError,
} from "@/utils/reconnect-account";

const readPassword = (body: unknown): string | null => {
  if (typeof body !== "object" || body === null) {
    return null;
  }

  const password = Reflect.get(body, "password");
  if (typeof password !== "string" || password.length === 0) {
    return null;
  }

  return password;
};

const POST = withWideEvent(
  withAuth(async ({ params, request, userId }) => {
    if (!params.id || !idParamSchema.allows(params)) {
      return ErrorResponse.badRequest("Account ID is required").toResponse();
    }

    const password = readPassword(await request.json().catch(() => null));
    if (!password) {
      return ErrorResponse.badRequest("A password is required").toResponse();
    }

    let target: Awaited<ReturnType<typeof getCalDAVReconnectTarget>> = null;
    try {
      target = await getCalDAVReconnectTarget(database, userId, params.id);
    } catch (error) {
      if (error instanceof ReconnectNotSupportedError) {
        widelog.errorFields(error, { slug: "reconnect-unsupported" });
        return ErrorResponse.badRequest(error.message).toResponse();
      }
      throw error;
    }

    if (!target) {
      return ErrorResponse.notFound("Account not found").toResponse();
    }

    widelog.set("provider.account_id", target.accountId);

    /* Proving the credential works before storing it keeps a bad password from
       replacing a merely-expired one and leaving the account broken in a new way. */
    const client = createCalDAVClient({
      credentials: { password, username: target.username },
      serverUrl: target.serverUrl,
    }, safeFetchOptions);

    try {
      await client.discoverCalendars();
    } catch (error) {
      if (isCalDAVAuthenticationError(error)) {
        widelog.errorFields(error, { slug: "reconnect-credentials-rejected" });
        return ErrorResponse.unauthorized("Those credentials were rejected").toResponse();
      }

      /* An unreachable server is not a bad password; saying so would send the user off to
         mint app passwords that were never the problem. */
      widelog.errorFields(error, { slug: "reconnect-connection-failed" });
      return ErrorResponse
        .badRequest("Could not reach the server to check that password")
        .toResponse();
    }

    await applyCalDAVReconnect(
      database,
      target,
      password,
      client.getResolvedAuthMethod() ?? "basic",
    );

    widelog.set("reauth.action", "clear");
    widelog.set("reauth.provenance", "user-reconnect");

    return new Response(null, { status: HTTP_STATUS.NO_CONTENT });
  }),
);

export { POST };
