import { HTTP_STATUS } from "@keeper.sh/constants";
import type { IcsFeedFailureReason } from "@keeper.sh/data-schemas";
import { ErrorResponse } from "@/utils/responses";
import { widelog } from "@/utils/logging";
import { labelFailureResponse } from "@/utils/error-labelling";

interface IcsRouteContext {
  userId: string;
}

interface IcsPostRouteContext extends IcsRouteContext {
  body: unknown;
}

interface ParsedCreateSourceBody {
  name?: string;
  url: string;
}

interface InvalidSourceUrlErrorLike extends Error {
  authRequired: boolean;
  reason: string;
  feedFailureReason: IcsFeedFailureReason;
}

interface IcsItemRouteContext extends IcsRouteContext {
  params: Record<string, string>;
}

interface DeleteIcsSourceDependencies {
  findLinkAccountId: (userId: string, calendarId: string) => Promise<string | null>;
  deleteAccount: (userId: string, accountId: string) => Promise<boolean>;
}

interface GetIcsSourcesDependencies {
  getUserSources: (userId: string) => Promise<unknown[]>;
}

interface PostIcsSourceDependencies {
  parseCreateSourceBody: (body: unknown) => ParsedCreateSourceBody;
  createSource: (userId: string, name: string | undefined, url: string) => Promise<unknown>;
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
      widelog.errorFields(error, { slug: "invalid-source-url" });
      widelog.set("source.invalid_reason", error.reason);
      return Response.json(
        {
          authRequired: error.authRequired,
          error: error.message,
          reason: error.feedFailureReason,
        },
        { status: HTTP_STATUS.BAD_REQUEST },
      );
    }

    const databaseResponse = labelFailureResponse(error, { slug: "invalid-request-body" });
    if (databaseResponse) {
      return databaseResponse;
    }

    return ErrorResponse.badRequest("Name and URL are required").toResponse();
  }
};

const handleDeleteIcsSourceRoute = async (
  context: IcsItemRouteContext,
  dependencies: DeleteIcsSourceDependencies,
): Promise<Response> => {
  const calendarId = context.params.id;
  if (!calendarId) {
    return ErrorResponse.badRequest("Calendar ID is required").toResponse();
  }

  const accountId = await dependencies.findLinkAccountId(context.userId, calendarId);
  if (!accountId) {
    return ErrorResponse.notFound("Calendar link not found").toResponse();
  }

  const deleted = await dependencies.deleteAccount(context.userId, accountId);
  if (!deleted) {
    return ErrorResponse.notFound("Calendar link not found").toResponse();
  }

  return Response.json({ success: true });
};

export { handleDeleteIcsSourceRoute, handleGetIcsSourcesRoute, handlePostIcsSourceRoute };
