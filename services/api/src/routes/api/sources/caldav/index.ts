import { TraversalError } from "arktype";
import { createCalDAVSourceSchema } from "@keeper.sh/data-schemas";
import { HTTP_STATUS } from "@keeper.sh/constants";
import { withAuth, withWideEvent } from "@/utils/middleware";
import { ErrorResponse } from "@/utils/responses";
import { widelog } from "@/utils/logging";
import { labelFailureResponse } from "@/utils/error-labelling";
import { caldavSourcesQuerySchema } from "@/utils/request-query";
import {
  CalDAVSourceLimitError,
  DuplicateCalDAVSourceError,
  getUserCalDAVSources,
  createCalDAVSource,
} from "@/utils/caldav-sources";

const SOURCE_CREATE_FAILED_MESSAGE = "Failed to create CalDAV source";

const GET = withWideEvent(
  withAuth(async ({ request, userId }) => {
    const url = new URL(request.url);
    const query = Object.fromEntries(url.searchParams.entries());
    const provider = url.searchParams.get("provider");

    if (!caldavSourcesQuerySchema.allows(query)) {
      return ErrorResponse.badRequest("Invalid query params").toResponse();
    }

    if (provider) {
      const sources = await getUserCalDAVSources(userId, provider);
      return Response.json(sources);
    }

    const sources = await getUserCalDAVSources(userId);
    return Response.json(sources);
  }),
);

const POST = withWideEvent(
  withAuth(async ({ request, userId }) => {
    const body = await request.json();

    try {
      const data = createCalDAVSourceSchema.assert(body);

      widelog.set("provider.name", data.provider);

      const { reconnected, source } = await createCalDAVSource(userId, data);

      widelog.set("caldav.reconnected", reconnected);

      if (reconnected) {
        return Response.json(source, { status: HTTP_STATUS.OK });
      }

      return Response.json(source, { status: HTTP_STATUS.CREATED });
    } catch (error) {
      if (error instanceof CalDAVSourceLimitError) {
        widelog.errorFields(error, { slug: "account-limit-reached" });
        return ErrorResponse.paymentRequired(error.message).toResponse();
      }
      if (error instanceof DuplicateCalDAVSourceError) {
        widelog.errorFields(error, { slug: "duplicate-source" });
        return Response.json({ error: error.message }, { status: HTTP_STATUS.CONFLICT });
      }

      if (error instanceof TraversalError) {
        widelog.errorFields(error, { slug: "invalid-request-body" });
        return ErrorResponse.badRequest(error.message).toResponse();
      }

      const databaseResponse = labelFailureResponse(error, {
        slug: "caldav-connection-failed",
      });
      if (databaseResponse) {
        return databaseResponse;
      }

      // Fixed message: an arbitrary error's message here may carry SQL text and bound parameters.
      return ErrorResponse.internal(SOURCE_CREATE_FAILED_MESSAGE).toResponse();
    }
  }),
);

export { GET, POST };
