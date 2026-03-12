import { ErrorResponse } from "../../../../utils/responses";
import { respondWithLoggedError } from "../../../../utils/logging";
import { calendarIdsBodySchema } from "../../../../utils/request-body";
import { idParamSchema } from "../../../../utils/request-query";
import { MAPPING_LIMIT_ERROR_MESSAGE } from "../../../../utils/source-destination-mappings";

interface MappingRouteContext {
  params: Record<string, string>;
  userId: string;
}

interface MappingPutRouteContext extends MappingRouteContext {
  body: unknown;
}

interface GetSourceDestinationsDependencies {
  sourceExists: (userId: string, sourceCalendarId: string) => Promise<boolean>;
  getDestinationsForSource: (userId: string, sourceCalendarId: string) => Promise<string[]>;
}

interface PutSourceDestinationsDependencies {
  setDestinationsForSource: (
    userId: string,
    sourceCalendarId: string,
    destinationCalendarIds: string[],
  ) => Promise<void>;
}

interface GetSourcesForDestinationDependencies {
  destinationExists: (userId: string, destinationCalendarId: string) => Promise<boolean>;
  getSourcesForDestination: (userId: string, destinationCalendarId: string) => Promise<string[]>;
}

interface PutSourcesForDestinationDependencies {
  setSourcesForDestination: (
    userId: string,
    destinationCalendarId: string,
    sourceCalendarIds: string[],
  ) => Promise<void>;
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

const mapMappingDomainError = (
  error: unknown,
  missingCalendarMessage: string,
  invalidLinkedCalendarsMessage: string,
): Response | null => {
  if (!(error instanceof Error)) {
    return null;
  }

  if (error.message === missingCalendarMessage) {
    return ErrorResponse.notFound().toResponse();
  }

  if (error.message === invalidLinkedCalendarsMessage) {
    return ErrorResponse.badRequest(error.message).toResponse();
  }

  if (error.message === MAPPING_LIMIT_ERROR_MESSAGE) {
    return ErrorResponse.paymentRequired(error.message).toResponse();
  }

  return null;
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

const handlePutSourceDestinationsRoute = async (
  context: MappingPutRouteContext,
  dependencies: PutSourceDestinationsDependencies,
): Promise<Response> => {
  const resolved = resolveIdParam(context.params, "Source ID is required");
  if (resolved instanceof Response) {
    return resolved;
  }

  if (!calendarIdsBodySchema.allows(context.body)) {
    return ErrorResponse.badRequest("calendarIds array is required").toResponse();
  }

  try {
    await dependencies.setDestinationsForSource(
      context.userId,
      resolved.id,
      context.body.calendarIds,
    );
  } catch (error) {
    const mappedResponse = mapMappingDomainError(
      error,
      "Source calendar not found",
      "Some destination calendars not found",
    );
    if (mappedResponse) {
      return respondWithLoggedError(error, mappedResponse);
    }
    throw error;
  }

  return Response.json({ success: true });
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

const handlePutSourcesForDestinationRoute = async (
  context: MappingPutRouteContext,
  dependencies: PutSourcesForDestinationDependencies,
): Promise<Response> => {
  const resolved = resolveIdParam(context.params, "Destination ID is required");
  if (resolved instanceof Response) {
    return resolved;
  }

  if (!calendarIdsBodySchema.allows(context.body)) {
    return ErrorResponse.badRequest("calendarIds array is required").toResponse();
  }

  try {
    await dependencies.setSourcesForDestination(
      context.userId,
      resolved.id,
      context.body.calendarIds,
    );
  } catch (error) {
    const mappedResponse = mapMappingDomainError(
      error,
      "Destination calendar not found",
      "Some source calendars not found",
    );
    if (mappedResponse) {
      return respondWithLoggedError(error, mappedResponse);
    }
    throw error;
  }

  return Response.json({ success: true });
};

export {
  handleGetSourceDestinationsRoute,
  handlePutSourceDestinationsRoute,
  handleGetSourcesForDestinationRoute,
  handlePutSourcesForDestinationRoute,
};
