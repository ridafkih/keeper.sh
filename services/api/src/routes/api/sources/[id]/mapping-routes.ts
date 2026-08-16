import { ErrorResponse } from "@/utils/responses";
import {
  calendarIdsBodySchema,
  deleteConfirmationBodySchema,
  writeBackModeBodySchema,
} from "@/utils/request-body";
import { idParamSchema } from "@/utils/request-query";
import { MAPPING_LIMIT_ERROR_MESSAGE } from "@/utils/source-destination-mappings";
import {
  BLANK_READ_NOT_APPLICABLE_MESSAGE,
  DELETE_CONFIRMATION_NOT_APPLICABLE_MESSAGE,
  DISCONNECTED_DESTINATION_MESSAGE,
  EMPTY_DESTINATION_NOT_APPLICABLE_MESSAGE,
  NO_DELETE_CONFIRMATION_PENDING_MESSAGE,
} from "@/utils/delete-confirmation-policy";

/*
 * Both are the same answer to the caller — the pair is not in a position to be told to
 * delete originals — and they differ only in which evidence is missing, so each is
 * reported in its own words rather than flattened into one.
 */
const NOT_APPLICABLE_MESSAGES: ReadonlySet<string> = new Set([
  BLANK_READ_NOT_APPLICABLE_MESSAGE,
  DELETE_CONFIRMATION_NOT_APPLICABLE_MESSAGE,
  DISCONNECTED_DESTINATION_MESSAGE,
  EMPTY_DESTINATION_NOT_APPLICABLE_MESSAGE,
]);

const TWO_WAY_PRO_ERROR_MESSAGE = "Two-way sync requires a Pro plan.";
const MAPPING_NOT_FOUND_ERROR_MESSAGE = "Mapping not found";
const UNWRITABLE_SOURCE_ERROR_MESSAGE =
  "This source calendar cannot receive edits, so two-way sync is unavailable.";

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
  getWriteBackModesForSource?: (
    userId: string,
    sourceCalendarId: string,
  ) => Promise<Record<string, string>>;
  getWriteBackStatesForSource?: (
    userId: string,
    sourceCalendarId: string,
  ) => Promise<Record<string, { reason: string | null; state: string }>>;
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
  const writeBackModes = await dependencies.getWriteBackModesForSource?.(
    context.userId,
    resolved.id,
  ) ?? {};
  const writeBackStates = await dependencies.getWriteBackStatesForSource?.(
    context.userId,
    resolved.id,
  ) ?? {};
  return Response.json({ destinationIds, writeBackModes, writeBackStates });
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
      return mappedResponse;
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
      return mappedResponse;
    }
    throw error;
  }

  return Response.json({ success: true });
};

interface PatchMappingWriteBackModeDependencies {
  canUseTwoWaySync: (userId: string) => Promise<boolean>;
  setWriteBackMode: (
    userId: string,
    sourceCalendarId: string,
    destinationCalendarId: string,
    writeBackMode: string,
  ) => Promise<void>;
  sourceSupportsWriteBack: (userId: string, sourceCalendarId: string) => Promise<boolean>;
}

const handlePatchMappingWriteBackModeRoute = async (
  context: MappingPutRouteContext,
  dependencies: PatchMappingWriteBackModeDependencies,
): Promise<Response> => {
  const sourceCalendarId = context.params.id;
  const destinationCalendarId = context.params.destinationId;
  if (!sourceCalendarId || !destinationCalendarId) {
    return ErrorResponse.badRequest(
      "Source ID and destination ID are required",
    ).toResponse();
  }

  if (!writeBackModeBodySchema.allows(context.body)) {
    return ErrorResponse.badRequest(
      "writeBackMode must be off, edits or edits_and_deletes",
    ).toResponse();
  }
  const { writeBackMode } = writeBackModeBodySchema.assert(context.body);

  if (writeBackMode !== "off") {
    const allowed = await dependencies.canUseTwoWaySync(context.userId);
    if (!allowed) {
      return ErrorResponse.forbidden(TWO_WAY_PRO_ERROR_MESSAGE).toResponse();
    }
    const writable = await dependencies.sourceSupportsWriteBack(
      context.userId,
      sourceCalendarId,
    );
    if (!writable) {
      return ErrorResponse.badRequest(UNWRITABLE_SOURCE_ERROR_MESSAGE).toResponse();
    }
  }

  try {
    await dependencies.setWriteBackMode(
      context.userId,
      sourceCalendarId,
      destinationCalendarId,
      writeBackMode,
    );
  } catch (error) {
    if (error instanceof Error && error.message === MAPPING_NOT_FOUND_ERROR_MESSAGE) {
      return ErrorResponse.notFound().toResponse();
    }
    throw error;
  }

  return Response.json({ success: true });
};

interface PatchDeleteConfirmationDependencies {
  canUseTwoWaySync: (userId: string) => Promise<boolean>;
  resolveDeleteConfirmation: (
    userId: string,
    sourceCalendarId: string,
    destinationCalendarId: string,
    decision: string,
  ) => Promise<void>;
}

/*
 * The answer to a question the sync pass asked. Approving is a write to the user's real
 * calendar, so it carries the same plan gate the toggle does; declining only puts copies
 * back and is always allowed.
 */
const handlePatchDeleteConfirmationRoute = async (
  context: MappingPutRouteContext,
  dependencies: PatchDeleteConfirmationDependencies,
): Promise<Response> => {
  const sourceCalendarId = context.params.id;
  const destinationCalendarId = context.params.destinationId;
  if (!sourceCalendarId || !destinationCalendarId) {
    return ErrorResponse.badRequest(
      "Source ID and destination ID are required",
    ).toResponse();
  }

  if (!deleteConfirmationBodySchema.allows(context.body)) {
    return ErrorResponse.badRequest(
      "decision must be apply, apply_empty_destination or decline",
    ).toResponse();
  }
  const { decision } = deleteConfirmationBodySchema.assert(context.body);

  if (decision !== "decline" && !await dependencies.canUseTwoWaySync(context.userId)) {
    return ErrorResponse.forbidden(TWO_WAY_PRO_ERROR_MESSAGE).toResponse();
  }

  try {
    await dependencies.resolveDeleteConfirmation(
      context.userId,
      sourceCalendarId,
      destinationCalendarId,
      decision,
    );
  } catch (error) {
    if (error instanceof Error && error.message === MAPPING_NOT_FOUND_ERROR_MESSAGE) {
      return ErrorResponse.notFound().toResponse();
    }
    if (error instanceof Error && NOT_APPLICABLE_MESSAGES.has(error.message)) {
      return ErrorResponse.conflict(error.message).toResponse();
    }
    if (
      error instanceof Error
      && error.message === NO_DELETE_CONFIRMATION_PENDING_MESSAGE
    ) {
      return ErrorResponse.conflict(NO_DELETE_CONFIRMATION_PENDING_MESSAGE).toResponse();
    }
    throw error;
  }

  return Response.json({ success: true });
};

export {
  handleGetSourceDestinationsRoute,
  handlePatchDeleteConfirmationRoute,
  handlePatchMappingWriteBackModeRoute,
  MAPPING_NOT_FOUND_ERROR_MESSAGE,
  handlePutSourceDestinationsRoute,
  handleGetSourcesForDestinationRoute,
  handlePutSourcesForDestinationRoute,
};
