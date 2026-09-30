import { ErrorResponse } from "@/utils/responses";
import { idParamSchema } from "@/utils/request-query";

interface MappingRouteContext {
  params: Record<string, string>;
  userId: string;
}

interface GetSourceDestinationsDependencies {
  sourceExists: (userId: string, sourceCalendarId: string) => Promise<boolean>;
  getDestinationsForSource: (userId: string, sourceCalendarId: string) => Promise<string[]>;
}

interface GetSourcesForDestinationDependencies {
  destinationExists: (userId: string, destinationCalendarId: string) => Promise<boolean>;
  getSourcesForDestination: (userId: string, destinationCalendarId: string) => Promise<string[]>;
}

const resolveIdParam = (
  params: Record<string, string>,
  missingIdMessage: string,
): { id: string } | Response => {
  if (!params.id || !idParamSchema.allows(params)) {
    return ErrorResponse.badRequest(missingIdMessage).toResponse();
  }
  return { id: params.id };
};

const handleGetSourceDestinationsRoute = async (
  context: MappingRouteContext,
  dependencies: GetSourceDestinationsDependencies,
): Promise<Response> => {
  const resolved = resolveIdParam(context.params, "Source ID is required");
  if (resolved instanceof Response) {
    return resolved;
  }

  const sourceExists = await dependencies.sourceExists(context.userId, resolved.id);
  if (!sourceExists) {
    return ErrorResponse.notFound().toResponse();
  }

  const destinationIds = await dependencies.getDestinationsForSource(context.userId, resolved.id);
  return Response.json({ destinationIds });
};

const handleGetSourcesForDestinationRoute = async (
  context: MappingRouteContext,
  dependencies: GetSourcesForDestinationDependencies,
): Promise<Response> => {
  const resolved = resolveIdParam(context.params, "Destination ID is required");
  if (resolved instanceof Response) {
    return resolved;
  }

  const destinationExists = await dependencies.destinationExists(context.userId, resolved.id);
  if (!destinationExists) {
    return ErrorResponse.notFound().toResponse();
  }

  const sourceIds = await dependencies.getSourcesForDestination(context.userId, resolved.id);
  return Response.json({ sourceIds });
};

export {
  handleGetSourceDestinationsRoute,
  handleGetSourcesForDestinationRoute,
};
