import { createSourceSchema } from "@keeper.sh/data-schemas";
import { withTracing, withAuth } from "../../../utils/middleware";
import {
  getUserSources,
  createSource,
  SourceLimitError,
  InvalidSourceUrlError,
} from "../../../utils/sources";

export const GET = withTracing(
  withAuth(async ({ userId }) => {
    const sources = await getUserSources(userId);
    return Response.json(sources);
  }),
);

export const POST = withTracing(
  withAuth(async ({ request, userId }) => {
    const body = await request.json();

    try {
      const { name, url } = createSourceSchema.assert(body);
      const source = await createSource(userId, name, url);
      return Response.json(source, { status: 201 });
    } catch (error) {
      if (error instanceof SourceLimitError) {
        return Response.json({ error: error.message }, { status: 402 });
      }
      if (error instanceof InvalidSourceUrlError) {
        return Response.json(
          { error: error.message, authRequired: error.authRequired },
          { status: 400 },
        );
      }

      return Response.json(
        { error: "Name and URL are required" },
        { status: 400 },
      );
    }
  }),
);
