import { count, eq } from "drizzle-orm";
import { syncsTable } from "@keeper.sh/database/schema";
import { user as userTable } from "@keeper.sh/database/auth-schema";
import { onboardingStatusSchema, onboardingUpdateBodySchema } from "@keeper.sh/data-schemas";
import type { OnboardingStatus } from "@keeper.sh/data-schemas";
import { withAuth, withWideEvent } from "@/utils/middleware";
import { ErrorResponse } from "@/utils/responses";
import { onboardingCookieFor } from "@/utils/onboarding-cookie";
import { database } from "@/context";

interface OnboardingRouteContext {
  userId: string;
}

interface OnboardingDependencies {
  getStatus: (userId: string) => Promise<OnboardingStatus | null>;
  getSyncCount: (userId: string) => Promise<number>;
  setStatus: (userId: string, status: OnboardingStatus) => Promise<void>;
}

const respondWithStatus = (status: OnboardingStatus): Response => {
  const response = Response.json({ status });
  response.headers.append("Set-Cookie", onboardingCookieFor(status));
  return response;
};

// Someone who already made a sync got past onboarding even if the step that records it never ran.
const handleGetOnboardingRoute = async (
  { userId }: OnboardingRouteContext,
  dependencies: OnboardingDependencies,
): Promise<Response> => {
  const status = await dependencies.getStatus(userId);
  if (!status) {
    return ErrorResponse.notFound().toResponse();
  }
  if (status === "pending" && await dependencies.getSyncCount(userId) > 0) {
    await dependencies.setStatus(userId, "completed");
    return respondWithStatus("completed");
  }
  return respondWithStatus(status);
};

const handlePatchOnboardingRoute = async (
  { body, userId }: OnboardingRouteContext & { body: unknown },
  dependencies: OnboardingDependencies,
): Promise<Response> => {
  if (!onboardingUpdateBodySchema.allows(body)) {
    return ErrorResponse.badRequest("Status must be completed or skipped").toResponse();
  }
  await dependencies.setStatus(userId, body.status);
  return respondWithStatus(body.status);
};

const dependencies: OnboardingDependencies = {
  getStatus: async (userId) => {
    const [row] = await database
      .select({ onboardingStatus: userTable.onboardingStatus })
      .from(userTable)
      .where(eq(userTable.id, userId))
      .limit(1);
    if (!row) {
      return null;
    }
    return onboardingStatusSchema.assert(row.onboardingStatus);
  },
  getSyncCount: async (userId) => {
    const [row] = await database
      .select({ total: count() })
      .from(syncsTable)
      .where(eq(syncsTable.userId, userId));
    return row?.total ?? 0;
  },
  setStatus: async (userId, status) => {
    await database
      .update(userTable)
      .set({ onboardingStatus: status })
      .where(eq(userTable.id, userId));
  },
};

const GET = withWideEvent(withAuth(({ userId }) => handleGetOnboardingRoute({ userId }, dependencies)));

const PATCH = withWideEvent(
  withAuth(async ({ request, userId }) => {
    const body = await request.json().catch(() => null);
    return handlePatchOnboardingRoute({ body, userId }, dependencies);
  }),
);

export { GET, PATCH, handleGetOnboardingRoute, handlePatchOnboardingRoute };
export type { OnboardingDependencies };
