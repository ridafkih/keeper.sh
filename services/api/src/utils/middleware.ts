import type { MaybePromise } from "bun";
import { isKeeperMcpEnabledAuth } from "@keeper.sh/auth";
import { ErrorResponse } from "./responses";
import { apiTokensTable } from "@keeper.sh/database/schema";
import { isApiToken, hashApiToken } from "./api-tokens";
import { user as userTable } from "@keeper.sh/database/auth-schema";
import { eq } from "drizzle-orm";
import { auth, database, premiumService, redis } from "@/context";
import { checkAndIncrementApiUsage } from "./api-rate-limit";
import { context, widelog } from "./logging";

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

const resolveOutcome = (statusCode: number): "success" | "error" => {
  if (statusCode >= 400) {
    return "error";
  }
  return "success";
};

const fetchUserPlan = async (userId: string): Promise<"free" | "pro" | null> => {
  try {
    return await premiumService.getUserPlan(userId);
  } catch {
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
  } catch {
    return null;
  }
};

interface UserContext {
  plan: "free" | "pro" | null;
}

const enrichWithUserContext = async (userId: string): Promise<UserContext> => {
  widelog.set("user.id", userId);

  const [plan, accountAgeDays] = await Promise.all([
    fetchUserPlan(userId),
    fetchAccountAgeDays(userId),
  ]);

  if (plan) {
    widelog.set("user.plan", plan);
  }
  if (accountAgeDays !== null) {
    widelog.set("user.account_age_days", accountAgeDays);
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
    context(async () => {
      const url = new URL(request.url);
      const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();

      widelog.set("operation.name", `${request.method} ${url.pathname}`);
      widelog.set("operation.type", "http");
      widelog.set("request.id", requestId);
      widelog.set("http.method", request.method);
      widelog.set("http.path", url.pathname);

      const userAgent = request.headers.get("user-agent");
      if (userAgent) {
        widelog.set("http.user_agent", userAgent);
      }

      try {
        return await widelog.time.measure("duration_ms", async () => {
          const response = await handler({ params, request });
          widelog.set("status_code", response.status);
          widelog.set("outcome", resolveOutcome(response.status));
          return response;
        });
      } catch (error) {
        widelog.set("status_code", 500);
        widelog.set("outcome", "error");
        widelog.errorFields(error, { slug: "unclassified" });
        throw error;
      } finally {
        widelog.flush();
      }
    });

const withAuth =
  (handler: AuthenticatedRouteCallback): RouteCallback =>
  async ({ request, params }) => {
    const session = await widelog.time.measure("auth.duration_ms", () => getSession(request));
    widelog.set("auth.method", "session");

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
        widelog.set("auth.method", "api_token");

        if (!userId) {
          return ErrorResponse.unauthorized().toResponse();
        }

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
        widelog.set("auth.method", "mcp_token");

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
    widelog.set("auth.method", "session");

    if (!session?.user?.id) {
      return ErrorResponse.unauthorized().toResponse();
    }

    await enrichWithUserContext(session.user.id);
    return handler({ params, request, userId: session.user.id });
  };

export { resolveOutcome, withAuth, withV1Auth, withWideEvent };
export type { RouteHandler };
