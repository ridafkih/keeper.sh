import type { MaybePromise } from "bun";
import { isKeeperMcpEnabledAuth } from "@keeper.sh/auth";
import { ErrorResponse } from "./responses";
import { calendarsTable, sourceDestinationMappingsTable } from "@keeper.sh/database/schema";
import { user as userTable } from "@keeper.sh/database/auth-schema";
import { and, count, eq, inArray } from "drizzle-orm";
import { auth, database, premiumService } from "../context";
import {
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
    "http.method": request.method,
    "http.path": url.pathname,
    "operation.name": `${request.method} ${url.pathname}`,
    "operation.type": "http",
    ...(origin && { "http.origin": origin }),
    ...(userAgent && { "http.user_agent": userAgent }),
  };
};

const handleResponseStatus = (status: number): void => {
  widelog.set("http.status_code", status);
  if (status >= HTTP_ERROR_THRESHOLD) {
    trackStatusError(status, "HttpError");
  }
};

const fetchUserPlan = async (userId: string): Promise<"free" | "pro" | null> => {
  try {
    return await premiumService.getUserPlan(userId);
  } catch (error) {
    widelog.set("operation.name", "http:user-context:plan");
    widelog.set("operation.type", "http");
    widelog.set("user.id", userId);
    widelog.errorFields(error);
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
    widelog.set("operation.name", "http:user-context:counts");
    widelog.set("operation.type", "http");
    widelog.set("user.id", userId);
    widelog.errorFields(error);
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
    widelog.set("operation.name", "http:user-context:account-age");
    widelog.set("operation.type", "http");
    widelog.set("user.id", userId);
    widelog.errorFields(error);
    return null;
  }
};

const enrichWithUserContext = async (userId: string): Promise<void> => {
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
    for (const [key, value] of Object.entries(counts)) {
      widelog.set(key, value);
    }
  }
  if (accountAgeDays !== null) {
    widelog.set("account.age_days", accountAgeDays);
  }
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
    widelog.context(async () => {
      const httpContext = extractHttpContext(request);
      for (const [key, value] of Object.entries(httpContext)) {
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
          widelog.set(key, value);
        }
      }
      widelog.time.start("duration_ms");
      try {
        const response = await handler({ params, request });
        handleResponseStatus(response.status);
        return response;
      } catch (error) {
        widelog.set("http.status_code", HTTP_INTERNAL_SERVER_ERROR);
        throw error;
      } finally {
        widelog.time.stop("duration_ms");
        widelog.flush();
      }
    });

const withAuth =
  (handler: AuthenticatedRouteCallback): RouteCallback =>
  async ({ request, params }) => {
    widelog.time.start("auth");
    const session = await getSession(request);
    widelog.time.stop("auth");

    if (!session?.user?.id) {
      return ErrorResponse.unauthorized().toResponse();
    }

    await enrichWithUserContext(session.user.id);
    return handler({ params, request, userId: session.user.id });
  };

const withV1Auth =
  (handler: AuthenticatedRouteCallback): RouteCallback =>
  async ({ request, params }) => {
    widelog.time.start("auth");

    const authHeader = request.headers.get("authorization");

    if (authHeader?.startsWith("Bearer ") && isKeeperMcpEnabledAuth(auth)) {
      const mcpSession = await auth.api.getMcpSession({ headers: request.headers });
      widelog.time.stop("auth");

      if (!mcpSession?.userId) {
        return ErrorResponse.unauthorized().toResponse();
      }

      await enrichWithUserContext(mcpSession.userId);
      return handler({ params, request, userId: mcpSession.userId });
    }

    const session = await getSession(request);
    widelog.time.stop("auth");

    if (!session?.user?.id) {
      return ErrorResponse.unauthorized().toResponse();
    }

    await enrichWithUserContext(session.user.id);
    return handler({ params, request, userId: session.user.id });
  };

export { withAuth, withV1Auth, withWideEvent };
export type { RouteHandler };
