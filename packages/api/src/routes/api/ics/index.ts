import { createSourceSchema } from "@keeper.sh/data-schemas";
import { HTTP_STATUS } from "@keeper.sh/constants";
import { withAuth, withTracing } from "../../../utils/middleware";
import { ErrorResponse } from "../../../utils/responses";
import {
  InvalidSourceUrlError,
  SourceLimitError,
  createSource,
  getUserSources,
} from "../../../utils/sources";

const GET = withTracing(
  withAuth(async ({ userId }) => {
    const sources = await getUserSources(userId);
    return Response.json(sources);
  }),
);

const POST = withTracing(
  withAuth(async ({ request, userId }) => {
    const body = await request.json();

    try {
      const { name, url } = createSourceSchema.assert(body);
      const source = await createSource(userId, name, url);
      return Response.json(source, { status: 201 });
    } catch (error) {
      if (error instanceof SourceLimitError) {
        return ErrorResponse.paymentRequired(error.message).toResponse();
      }
      if (error instanceof InvalidSourceUrlError) {
        return Response.json(
          { authRequired: error.authRequired, error: error.message },
          { status: HTTP_STATUS.BAD_REQUEST },
        );
      }

      return ErrorResponse.badRequest("Name and URL are required").toResponse();
    }
  }),
);

export { GET, POST };
