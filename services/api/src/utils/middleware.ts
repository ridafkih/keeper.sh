import type { MaybePromise } from "bun";
import { isKeeperMcpEnabledAuth } from "@keeper.sh/auth";
import { ErrorResponse } from "./responses";
import { apiTokensTable, calendarsTable, sourceDestinationMappingsTable } from "@keeper.sh/database/schema";
import { isApiToken, hashApiToken } from "./api-tokens";
import { user as userTable } from "@keeper.sh/database/auth-schema";
import { and, count, eq, inArray } from "drizzle-orm";
import { auth, database, premiumService, redis } from "../context";
import { checkAndIncrementApiUsage } from "./api-rate-limit";
import {
  runApiWideEventContext,
  setWideEventFields,
  widelog,
  trackStatusError,
} from "./logging";

const HTTP_ERROR_THRESHOLD = 400;
const HTTP_INTERNAL_SERVER_ERROR = 500;
const DEFAULT_COUNT = 0;
const MS_PER_DAY = 86_400_000;

interface RouteContext {
  request: Request;
  params: Record<string, string>;
}

interface AuthenticatedRouteContext extends RouteContext {
  userId: string;
}

type RouteHandler = (request: Request, params: Record<string, string>) => MaybePromise<Response>;

type RouteCallback = (ctx: RouteContext) => MaybePromise<Response>;
type AuthenticatedRouteCallback = (ctx: AuthenticatedRouteContext) => MaybePromise<Response>;

const extractHttpContext = (request: Request): Record<string, unknown> => {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  const userAgent = request.headers.get("user-agent");
  return {
    http: {
      method: request.method,
      path: url.pathname,
      ...(origin && { origin }),
      ...(userAgent && { user_agent: userAgent }),
    },
    operation: {
      name: `${request.method} ${url.pathname}`,
      type: "http",
    },
    request: {
      id: request.headers.get("x-request-id") ?? crypto.randomUUID(),
    },
  };
};

const mapHttpStatusToOutcome = (status: number): "success" | "error" => {
  if (status >= HTTP_ERROR_THRESHOLD) {
    return "error";
  }

  return "success";
};

const handleResponseStatus = (status: number): void => {
  widelog.set("status_code", status);
  widelog.set("outcome", mapHttpStatusToOutcome(status));
  if (status >= HTTP_ERROR_THRESHOLD) {
    trackStatusError(status, "HttpError");
  }
};

const fetchUserPlan = async (userId: string): Promise<"free" | "pro" | null> => {
  try {
    return await premiumService.getUserPlan(userId);
  } catch (error) {
    widelog.set("user_context.plan.error", true);
    widelog.errorFields(error, { prefix: "user_context.plan" });
    return null;
  }
};

const fetchUserCounts = async (
  userId: string,
): Promise<{ "source.count": number; "destination.count": number } | null> => {
  try {
    const [sources] = await database
      .select({ count: count() })
      .from(calendarsTable)
      .where(
        and(
          eq(calendarsTable.userId, userId),
          inArray(calendarsTable.id,
            database.selectDistinct({ id: sourceDestinationMappingsTable.sourceCalendarId })
              .from(sourceDestinationMappingsTable)
          ),
        ),
      );
    const [destinations] = await database
      .select({ count: count() })
      .from(calendarsTable)
      .where(
        and(
          eq(calendarsTable.userId, userId),
          inArray(calendarsTable.id,
            database.selectDistinct({ id: sourceDestinationMappingsTable.destinationCalendarId })
              .from(sourceDestinationMappingsTable)
          ),
        ),
      );
    return {
      "destination.count": destinations?.count ?? DEFAULT_COUNT,
      "source.count": sources?.count ?? DEFAULT_COUNT,
    };
  } catch (error) {
    widelog.set("user_context.counts.error", true);
    widelog.errorFields(error, { prefix: "user_context.counts" });
    return null;
  }
};

const fetchAccountAgeDays = async (userId: string): Promise<number | null> => {
  try {
    const [result] = await database
      .select({ createdAt: userTable.createdAt })
      .from(userTable)
      .where(eq(userTable.id, userId))
      .limit(1);
    if (!result?.createdAt) {
      return null;
    }
    return Math.floor((Date.now() - result.createdAt.getTime()) / MS_PER_DAY);
  } catch (error) {
    widelog.set("user_context.account_age.error", true);
    widelog.errorFields(error, { prefix: "user_context.account_age" });
    return null;
  }
};

interface UserContext {
  plan: "free" | "pro" | null;
}

const enrichWithUserContext = async (userId: string): Promise<UserContext> => {
  widelog.set("user.id", userId);

  const [plan, counts, accountAgeDays] = await Promise.all([
    fetchUserPlan(userId),
    fetchUserCounts(userId),
    fetchAccountAgeDays(userId),
  ]);

  if (plan) {
    widelog.set("subscription.plan", plan);
  }
  if (counts) {
    setWideEventFields(counts);
  }
  if (accountAgeDays !== null) {
    widelog.set("account.age_days", accountAgeDays);
  }

  return { plan };
};

interface Session {
  user?: { id: string };
}

const getSession = async (request: Request): Promise<Session | null> => {
  const session = await auth.api.getSession({
    headers: request.headers,
  });
  return session;
};

const withWideEvent =
  (handler: RouteCallback): RouteHandler =>
  (request, params) =>
    runApiWideEventContext(async () => {
      setWideEventFields(extractHttpContext(request));
      try {
        return await widelog.time.measure("duration_ms", async () => {
          try {
            const response = await handler({ params, request });
            handleResponseStatus(response.status);
            return response;
          } catch (error) {
            widelog.set("status_code", HTTP_INTERNAL_SERVER_ERROR);
            widelog.set("outcome", "error");
            widelog.errorFields(error);
            throw error;
          }
        });
      } finally {
        widelog.flush();
      }
    });

const withAuth =
  (handler: AuthenticatedRouteCallback): RouteCallback =>
  async ({ request, params }) => {
    const session = await widelog.time.measure("auth.duration_ms", () => getSession(request));

    if (!session?.user?.id) {
      return ErrorResponse.unauthorized().toResponse();
    }

    await enrichWithUserContext(session.user.id);
    return handler({ params, request, userId: session.user.id });
  };

const resolveApiTokenUserId = async (bearerToken: string): Promise<string | null> => {
  const tokenHash = hashApiToken(bearerToken);
  const [match] = await database
    .select({
      userId: apiTokensTable.userId,
      expiresAt: apiTokensTable.expiresAt,
      id: apiTokensTable.id,
    })
    .from(apiTokensTable)
    .where(eq(apiTokensTable.tokenHash, tokenHash))
    .limit(1);

  if (!match) {
    return null;
  }

  if (match.expiresAt && match.expiresAt.getTime() < Date.now()) {
    return null;
  }

  await database
    .update(apiTokensTable)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiTokensTable.id, match.id));

  return match.userId;
};

const enforceApiRateLimit = async (userId: string, plan: "free" | "pro" | null): Promise<Response | null> => {
  const rateLimitResult = await checkAndIncrementApiUsage(redis, userId, plan);
  widelog.set("rate_limit.remaining", rateLimitResult.remaining);
  widelog.set("rate_limit.limit", rateLimitResult.limit);

  if (!rateLimitResult.allowed) {
    widelog.set("rate_limit.exceeded", true);
    return ErrorResponse.tooManyRequests("Daily API limit exceeded. Upgrade to Pro for unlimited access.").toResponse();
  }

  return null;
};

const withV1Auth =
  (handler: AuthenticatedRouteCallback): RouteCallback =>
  async ({ request, params }) => {
    const authHeader = request.headers.get("authorization");

    if (authHeader?.startsWith("Bearer ")) {
      const bearerToken = authHeader.slice("Bearer ".length);

      if (isApiToken(bearerToken)) {
        const userId = await widelog.time.measure("auth.duration_ms", () =>
          resolveApiTokenUserId(bearerToken),
        );

        if (!userId) {
          return ErrorResponse.unauthorized().toResponse();
        }

        widelog.set("auth.method", "api_token");
        const { plan } = await enrichWithUserContext(userId);
        const rateLimitResponse = await enforceApiRateLimit(userId, plan);
        if (rateLimitResponse) {
          return rateLimitResponse;
        }
        return handler({ params, request, userId });
      }

      if (isKeeperMcpEnabledAuth(auth)) {
        const mcpAuth = auth;
        const mcpSession = await widelog.time.measure("auth.duration_ms", () =>
          mcpAuth.api.getMcpSession({ headers: request.headers }),
        );

        if (!mcpSession?.userId) {
          return ErrorResponse.unauthorized().toResponse();
        }

        const { plan } = await enrichWithUserContext(mcpSession.userId);
        const rateLimitResponse = await enforceApiRateLimit(mcpSession.userId, plan);
        if (rateLimitResponse) {
          return rateLimitResponse;
        }
        return handler({ params, request, userId: mcpSession.userId });
      }
    }

    const session = await widelog.time.measure("auth.duration_ms", () => getSession(request));

    if (!session?.user?.id) {
      return ErrorResponse.unauthorized().toResponse();
    }

    await enrichWithUserContext(session.user.id);
    return handler({ params, request, userId: session.user.id });
  };

export { withAuth, withV1Auth, withWideEvent };
export type { RouteHandler };
