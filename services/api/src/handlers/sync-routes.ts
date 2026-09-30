import { HTTP_STATUS } from "@keeper.sh/constants";
import { createSyncBodySchema, patchSyncBodySchema } from "@keeper.sh/data-schemas";
import type { CreateSyncBody, PatchSyncBody, SyncDetail, SyncSummary } from "@keeper.sh/data-schemas";
import { ErrorResponse } from "@/utils/responses";
import {
  SYNC_NOT_FOUND_ERROR_MESSAGE,
  SyncConflictError,
  SyncContentNotAllowedError,
  SyncLimitError,
  SyncNotFoundError,
  SyncValidationError,
} from "@/utils/syncs";
import type { SyncActivityPage } from "@/utils/syncs";

const SYNC_ID_REQUIRED_MESSAGE = "Sync ID is required.";
const INVALID_SYNC_BODY_MESSAGE = "That sync isn't valid. Check its name, calendars and rules.";

interface RouteParams {
  params: Record<string, string | undefined>;
  userId: string;
}

const mapSyncWriteError = (error: unknown): Response | null => {
  if (error instanceof SyncConflictError) {
    return Response.json({ conflicts: error.conflicts, error: error.message }, { status: HTTP_STATUS.CONFLICT });
  }
  if (error instanceof SyncValidationError) {
    return ErrorResponse.badRequest(error.message).toResponse();
  }
  if (error instanceof SyncLimitError || error instanceof SyncContentNotAllowedError) {
    return ErrorResponse.forbidden(error.message).toResponse();
  }
  if (error instanceof SyncNotFoundError) {
    return ErrorResponse.notFound(error.message).toResponse();
  }
  return null;
};

const respondToWrite = async (write: () => Promise<Response>): Promise<Response> => {
  try {
    return await write();
  } catch (error) {
    const mapped = mapSyncWriteError(error);
    if (mapped) {
      return mapped;
    }
    throw error;
  }
};

const handleListSyncsRoute = async (
  context: { userId: string },
  dependencies: { listSyncs: (userId: string) => Promise<SyncSummary[]> },
): Promise<Response> => Response.json(await dependencies.listSyncs(context.userId));

interface CreateSyncDependencies {
  createSync: (userId: string, body: CreateSyncBody) => Promise<string>;
  findSync: (userId: string, syncId: string) => Promise<SyncDetail | null>;
}

const handleCreateSyncRoute = (
  context: { body: unknown; userId: string },
  dependencies: CreateSyncDependencies,
): Promise<Response> => {
  const { body } = context;
  if (!createSyncBodySchema.allows(body)) {
    return Promise.resolve(ErrorResponse.badRequest(INVALID_SYNC_BODY_MESSAGE).toResponse());
  }
  return respondToWrite(async () => {
    const syncId = await dependencies.createSync(context.userId, body);
    return Response.json(await dependencies.findSync(context.userId, syncId), { status: HTTP_STATUS.CREATED });
  });
};

const handleGetSyncRoute = async (
  context: RouteParams,
  dependencies: { findSync: (userId: string, syncId: string) => Promise<SyncDetail | null> },
): Promise<Response> => {
  const syncId = context.params.id;
  if (!syncId) {
    return ErrorResponse.badRequest(SYNC_ID_REQUIRED_MESSAGE).toResponse();
  }
  const sync = await dependencies.findSync(context.userId, syncId);
  if (!sync) {
    return ErrorResponse.notFound(SYNC_NOT_FOUND_ERROR_MESSAGE).toResponse();
  }
  return Response.json(sync);
};

interface PatchSyncDependencies {
  findSync: (userId: string, syncId: string) => Promise<SyncDetail | null>;
  updateSync: (userId: string, syncId: string, body: PatchSyncBody) => Promise<void>;
}

const handlePatchSyncRoute = (
  context: RouteParams & { body: unknown },
  dependencies: PatchSyncDependencies,
): Promise<Response> => {
  const { body } = context;
  const syncId = context.params.id;
  if (!syncId) {
    return Promise.resolve(ErrorResponse.badRequest(SYNC_ID_REQUIRED_MESSAGE).toResponse());
  }
  if (!patchSyncBodySchema.allows(body) || Object.keys(body).length === 0) {
    return Promise.resolve(ErrorResponse.badRequest(INVALID_SYNC_BODY_MESSAGE).toResponse());
  }
  return respondToWrite(async () => {
    await dependencies.updateSync(context.userId, syncId, body);
    return Response.json(await dependencies.findSync(context.userId, syncId));
  });
};

const handleDeleteSyncRoute = (
  context: RouteParams,
  dependencies: { deleteSync: (userId: string, syncId: string) => Promise<void> },
): Promise<Response> => {
  const syncId = context.params.id;
  if (!syncId) {
    return Promise.resolve(ErrorResponse.badRequest(SYNC_ID_REQUIRED_MESSAGE).toResponse());
  }
  return respondToWrite(async () => {
    await dependencies.deleteSync(context.userId, syncId);
    return new Response(null, { status: HTTP_STATUS.NO_CONTENT });
  });
};

interface SyncActivityDependencies {
  listActivity: (syncId: string, options: { before: string | null; limit: number | null }) => Promise<SyncActivityPage>;
  syncExists: (userId: string, syncId: string) => Promise<boolean>;
}

const readLimit = (value: string | null): number | null => {
  if (!value) {
    return null;
  }
  return Number(value);
};

const handleSyncActivityRoute = async (
  context: RouteParams & { searchParams: URLSearchParams },
  dependencies: SyncActivityDependencies,
): Promise<Response> => {
  const syncId = context.params.id;
  if (!syncId) {
    return ErrorResponse.badRequest(SYNC_ID_REQUIRED_MESSAGE).toResponse();
  }
  if (!(await dependencies.syncExists(context.userId, syncId))) {
    return ErrorResponse.notFound(SYNC_NOT_FOUND_ERROR_MESSAGE).toResponse();
  }
  return Response.json(await dependencies.listActivity(syncId, {
    before: context.searchParams.get("before"),
    limit: readLimit(context.searchParams.get("limit")),
  }));
};

export {
  handleCreateSyncRoute,
  handleDeleteSyncRoute,
  handleGetSyncRoute,
  handleListSyncsRoute,
  handlePatchSyncRoute,
  handleSyncActivityRoute,
};
