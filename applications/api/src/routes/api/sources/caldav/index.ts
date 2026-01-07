import { createCalDAVSourceSchema } from "@keeper.sh/data-schemas";
import { HTTP_STATUS } from "@keeper.sh/constants";
import { withAuth, withWideEvent } from "../../../../utils/middleware";
import { ErrorResponse } from "../../../../utils/responses";
import {
  CalDAVSourceLimitError,
  DuplicateCalDAVSourceError,
  getUserCalDAVSources,
  createCalDAVSource,
} from "../../../../utils/caldav-sources";

const GET = withWideEvent(
  withAuth(async ({ request, userId }) => {
    const url = new URL(request.url);
    const provider = url.searchParams.get("provider");

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
      const source = await createCalDAVSource(userId, data);
      return Response.json(source, { status: HTTP_STATUS.CREATED });
    } catch (error) {
      if (error instanceof CalDAVSourceLimitError) {
        return ErrorResponse.paymentRequired(error.message).toResponse();
      }
      if (error instanceof DuplicateCalDAVSourceError) {
        return Response.json(
          { error: error.message },
          { status: HTTP_STATUS.CONFLICT },
        );
      }

      return ErrorResponse.badRequest("Invalid request body").toResponse();
    }
  }),
);

export { GET, POST };
