import { eq } from "drizzle-orm";
import { user as userTable } from "@keeper.sh/database/auth-schema";
import { withAuth, withWideEvent } from "@/utils/middleware";
import { ErrorResponse } from "@/utils/responses";
import { accountSettingsPatchBodySchema } from "@/utils/request-body";
import { widelog } from "@/utils/logging";
import { database } from "@/context";

interface AccountSettings {
  agentFeedbackEnabled: boolean;
}

interface AccountSettingsStore {
  read: (userId: string) => Promise<AccountSettings | null>;
  write: (userId: string, settings: AccountSettings) => Promise<AccountSettings | null>;
}

const ACCOUNT_SETTINGS_COLUMNS = {
  agentFeedbackEnabled: userTable.agentFeedbackEnabled,
};

const respondWithSettings = (settings: AccountSettings | null): Response => {
  if (!settings) {
    return ErrorResponse.notFound("User not found.").toResponse();
  }
  return Response.json(settings);
};

const handleGetAccountSettings = async (
  userId: string,
  store: AccountSettingsStore,
): Promise<Response> => respondWithSettings(await store.read(userId));

const handlePatchAccountSettings = async (
  userId: string,
  body: unknown,
  store: AccountSettingsStore,
): Promise<Response> => {
  if (!accountSettingsPatchBodySchema.allows(body)) {
    return ErrorResponse.badRequest("Invalid account settings.").toResponse();
  }
  widelog.set("account_settings.agent_feedback_enabled", body.agentFeedbackEnabled);
  return respondWithSettings(await store.write(userId, body));
};

const databaseStore: AccountSettingsStore = {
  read: async (userId) => {
    const [settings] = await database
      .select(ACCOUNT_SETTINGS_COLUMNS)
      .from(userTable)
      .where(eq(userTable.id, userId))
      .limit(1);
    return settings ?? null;
  },
  write: async (userId, settings) => {
    const [updated] = await database
      .update(userTable)
      .set(settings)
      .where(eq(userTable.id, userId))
      .returning(ACCOUNT_SETTINGS_COLUMNS);
    return updated ?? null;
  },
};

const readJsonBody = (request: Request): Promise<unknown> => request.json().catch(() => null);

const GET = withWideEvent(
  withAuth(({ userId }) => handleGetAccountSettings(userId, databaseStore)),
);

const PATCH = withWideEvent(
  withAuth(async ({ request, userId }) =>
    handlePatchAccountSettings(userId, await readJsonBody(request), databaseStore)),
);

export { GET, PATCH, handleGetAccountSettings, handlePatchAccountSettings };
export type { AccountSettings, AccountSettingsStore };
