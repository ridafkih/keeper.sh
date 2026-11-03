import { ErrorResponse } from "@/utils/responses";
import { calendarIdsBodySchema, calendarToggleBodySchema } from "@/utils/request-body";
import { idParamSchema } from "@/utils/request-query";
import { MAPPING_LIMIT_ERROR_MESSAGE } from "@/utils/source-destination-mappings";
import type { MappingChange, MappingChangeResult } from "@/utils/mapping-change";

interface MappingRouteContext {
  params: Record<string, string>;
  userId: string;
}

interface MappingChangeRouteContext extends MappingRouteContext {
  body: unknown;
}

type ChangeMappings = (
  userId: string,
  calendarId: string,
  change: MappingChange,
) => Promise<MappingChangeResult>;

interface GetSourceDestinationsDependencies {
  sourceExists: (userId: string, sourceCalendarId: string) => Promise<boolean>;
  getDestinationsForSource: (userId: string, sourceCalendarId: string) => Promise<string[]>;
}

interface ChangeSourceDestinationsDependencies {
  changeDestinationsForSource: ChangeMappings;
}

interface GetSourcesForDestinationDependencies {
  destinationExists: (userId: string, destinationCalendarId: string) => Promise<boolean>;
  getSourcesForDestination: (userId: string, destinationCalendarId: string) => Promise<string[]>;
}

interface ChangeSourcesForDestinationDependencies {
  changeSourcesForDestination: ChangeMappings;
}

interface MappingDirection {
  invalidLinkedCalendarsMessage: string;
  missingCalendarMessage: string;
  missingIdMessage: string;
  responseKey: "destinationIds" | "sourceIds";
}

const DESTINATIONS_OF_SOURCE: MappingDirection = {
  invalidLinkedCalendarsMessage: "Some destination calendars not found",
  missingCalendarMessage: "Source calendar not found",
  missingIdMessage: "Source ID is required",
  responseKey: "destinationIds",
};

const SOURCES_OF_DESTINATION: MappingDirection = {
  invalidLinkedCalendarsMessage: "Some source calendars not found",
  missingCalendarMessage: "Destination calendar not found",
  missingIdMessage: "Destination ID is required",
  responseKey: "sourceIds",
};

type MappingChangeParser = (body: unknown) => MappingChange | Response;

const parseReplaceChange: MappingChangeParser = (body) => {
  if (!calendarIdsBodySchema.allows(body)) {
    return ErrorResponse.badRequest("calendarIds array is required").toResponse();
  }
  return { calendarIds: body.calendarIds, kind: "replace" };
};

const parseToggleChange: MappingChangeParser = (body) => {
  if (!calendarToggleBodySchema.allows(body)) {
    return ErrorResponse.badRequest("calendarId and enabled are required").toResponse();
  }
  return { calendarId: body.calendarId, enabled: body.enabled, kind: "toggle" };
};

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
  direction: MappingDirection,
): Response | null => {
  if (!(error instanceof Error)) {
    return null;
  }

  if (error.message === direction.missingCalendarMessage) {
    return ErrorResponse.notFound().toResponse();
  }

  if (error.message === direction.invalidLinkedCalendarsMessage) {
    return ErrorResponse.badRequest(error.message).toResponse();
  }

  if (error.message === MAPPING_LIMIT_ERROR_MESSAGE) {
    return ErrorResponse.paymentRequired(error.message).toResponse();
  }

  return null;
};

const handleMappingChange = async (
  context: MappingChangeRouteContext,
  direction: MappingDirection,
  parseChange: MappingChangeParser,
  changeMappings: ChangeMappings,
): Promise<Response> => {
  const resolved = resolveIdParam(context.params, direction.missingIdMessage);
  if (resolved instanceof Response) {
    return resolved;
  }

  const change = parseChange(context.body);
  if (change instanceof Response) {
    return change;
  }

  try {
    const result = await changeMappings(context.userId, resolved.id, change);
    if (change.kind === "replace") {
      return Response.json({ success: true });
    }
    return Response.json({ [direction.responseKey]: result.nextIds });
  } catch (error) {
    const mappedResponse = mapMappingDomainError(error, direction);
    if (mappedResponse) {
      return mappedResponse;
    }
    throw error;
  }
};

const handleGetSourceDestinationsRoute = async (
  context: MappingRouteContext,
  dependencies: GetSourceDestinationsDependencies,
): Promise<Response> => {
  const resolved = resolveIdParam(context.params, DESTINATIONS_OF_SOURCE.missingIdMessage);
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

const handlePutSourceDestinationsRoute = (
  context: MappingChangeRouteContext,
  dependencies: ChangeSourceDestinationsDependencies,
): Promise<Response> =>
  handleMappingChange(
    context,
    DESTINATIONS_OF_SOURCE,
    parseReplaceChange,
    dependencies.changeDestinationsForSource,
  );

const handlePatchSourceDestinationsRoute = (
  context: MappingChangeRouteContext,
  dependencies: ChangeSourceDestinationsDependencies,
): Promise<Response> =>
  handleMappingChange(
    context,
    DESTINATIONS_OF_SOURCE,
    parseToggleChange,
    dependencies.changeDestinationsForSource,
  );

const handleGetSourcesForDestinationRoute = async (
  context: MappingRouteContext,
  dependencies: GetSourcesForDestinationDependencies,
): Promise<Response> => {
  const resolved = resolveIdParam(context.params, SOURCES_OF_DESTINATION.missingIdMessage);
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

const handlePutSourcesForDestinationRoute = (
  context: MappingChangeRouteContext,
  dependencies: ChangeSourcesForDestinationDependencies,
): Promise<Response> =>
  handleMappingChange(
    context,
    SOURCES_OF_DESTINATION,
    parseReplaceChange,
    dependencies.changeSourcesForDestination,
  );

const handlePatchSourcesForDestinationRoute = (
  context: MappingChangeRouteContext,
  dependencies: ChangeSourcesForDestinationDependencies,
): Promise<Response> =>
  handleMappingChange(
    context,
    SOURCES_OF_DESTINATION,
    parseToggleChange,
    dependencies.changeSourcesForDestination,
  );

export {
  handleGetSourceDestinationsRoute,
  handleGetSourcesForDestinationRoute,
  handlePatchSourceDestinationsRoute,
  handlePatchSourcesForDestinationRoute,
  handlePutSourceDestinationsRoute,
  handlePutSourcesForDestinationRoute,
};
