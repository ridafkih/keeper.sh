import { createSourceSchema } from "@keeper.sh/data-schemas";
import { withAuth, withWideEvent } from "../../../utils/middleware";
import {
  InvalidSourceUrlError,
  SourceLimitError,
  createSource,
  getUserSources,
} from "../../../utils/sources";
import {
  handleGetIcsSourcesRoute,
  handlePostIcsSourceRoute,
} from "./source-routes";

const GET = withWideEvent(
  withAuth(({ userId }) =>
    handleGetIcsSourcesRoute(
      { userId },
      {
        getUserSources,
      },
    )),
);

const POST = withWideEvent(
  withAuth(async ({ request, userId }) => {
    const body = await request.json();
    return handlePostIcsSourceRoute(
      { body, userId },
      {
        createSource,
        isInvalidSourceUrlError: (error): error is InvalidSourceUrlError =>
          error instanceof InvalidSourceUrlError,
        isSourceLimitError: (error): error is SourceLimitError =>
          error instanceof SourceLimitError,
        parseCreateSourceBody: (value) => createSourceSchema.assert(value),
      },
    );
  }),
);

export { GET, POST };
