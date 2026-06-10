import { HTTP_STATUS } from "@keeper.sh/constants";
import { ErrorResponse } from "@/utils/responses";
import { widelog } from "@/utils/logging";

interface IcsRouteContext {
  userId: string;
}

interface IcsPostRouteContext extends IcsRouteContext {
  body: unknown;
}

interface ParsedCreateSourceBody {
  name: string;
  url: string;
}

interface InvalidSourceUrlErrorLike {
  authRequired: boolean;
  message: string;
}

interface GetIcsSourcesDependencies {
  getUserSources: (userId: string) => Promise<unknown[]>;
}

interface PostIcsSourceDependencies {
  parseCreateSourceBody: (body: unknown) => ParsedCreateSourceBody;
  createSource: (userId: string, name: string, url: string) => Promise<unknown>;
  isSourceLimitError: (error: unknown) => boolean;
  isInvalidSourceUrlError: (error: unknown) => error is InvalidSourceUrlErrorLike;
}

const handleGetIcsSourcesRoute = async (
  context: IcsRouteContext,
  dependencies: GetIcsSourcesDependencies,
): Promise<Response> => {
  const sources = await dependencies.getUserSources(context.userId);
  return Response.json(sources);
};

const handlePostIcsSourceRoute = async (
  context: IcsPostRouteContext,
  dependencies: PostIcsSourceDependencies,
): Promise<Response> => {
  try {
    const { name, url } = dependencies.parseCreateSourceBody(context.body);
    const source = await dependencies.createSource(context.userId, name, url);
    return Response.json(source, { status: HTTP_STATUS.CREATED });
  } catch (error) {
    if (dependencies.isSourceLimitError(error)) {
      widelog.errorFields(error, { slug: "source-limit-reached" });
      const fallbackMessage = "Source limit reached";
      if (error instanceof Error) {
        return ErrorResponse.paymentRequired(error.message).toResponse();
      }
      return ErrorResponse.paymentRequired(fallbackMessage).toResponse();
    }

    if (dependencies.isInvalidSourceUrlError(error)) {
      return Response.json(
        {
          authRequired: error.authRequired,
          error: error.message,
        },
        { status: HTTP_STATUS.BAD_REQUEST },
      );
    }

    return ErrorResponse.badRequest("Name and URL are required").toResponse();
  }
};

export { handleGetIcsSourcesRoute, handlePostIcsSourceRoute };
