import type { MaybePromise } from "bun";
import { isKeeperMcpEnabledAuth } from "@keeper.sh/auth";
import { ErrorResponse } from "./responses";
import { calendarsTable, sourceDestinationMappingsTable } from "@keeper.sh/database/schema";
import { user as userTable } from "@keeper.sh/database/auth-schema";
import { and, count, eq, inArray } from "drizzle-orm";
import { auth, database, premiumService } from "../context";
import {
  endTiming,
  reportError,
  runWideEvent,
  setLogFields,
  startTiming,
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
  setLogFields({ "http.status_code": status });
  if (status >= HTTP_ERROR_THRESHOLD) {
    trackStatusError(status, "HttpError");
  }
};

const fetchUserPlan = async (userId: string): Promise<"free" | "pro" | null> => {
  try {
    return await premiumService.getUserPlan(userId);
  } catch (error) {
    reportError(error, {
      "operation.name": "http:user-context:plan",
      "operation.type": "http",
      "user.id": userId,
    });
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
    reportError(error, {
      "operation.name": "http:user-context:counts",
      "operation.type": "http",
      "user.id": userId,
    });
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
    reportError(error, {
      "operation.name": "http:user-context:account-age",
      "operation.type": "http",
      "user.id": userId,
    });
    return null;
  }
};

const enrichWithUserContext = async (userId: string): Promise<void> => {
  setLogFields({ "user.id": userId });

  const [plan, counts, accountAgeDays] = await Promise.all([
    fetchUserPlan(userId),
    fetchUserCounts(userId),
    fetchAccountAgeDays(userId),
  ]);

  if (plan) {
    setLogFields({ "subscription.plan": plan });
  }
  if (counts) {
    setLogFields(counts);
  }
  if (accountAgeDays !== null) {
    setLogFields({ "account.age_days": accountAgeDays });
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
    runWideEvent(extractHttpContext(request), async () => {
      try {
        const response = await handler({ params, request });
        handleResponseStatus(response.status);
        return response;
      } catch (error) {
        setLogFields({ "http.status_code": HTTP_INTERNAL_SERVER_ERROR });
        throw error;
      }
    });

const withAuth =
  (handler: AuthenticatedRouteCallback): RouteCallback =>
  async ({ request, params }) => {
    startTiming("auth");
    const session = await getSession(request);
    endTiming("auth");

    if (!session?.user?.id) {
      return ErrorResponse.unauthorized().toResponse();
    }

    await enrichWithUserContext(session.user.id);
    return handler({ params, request, userId: session.user.id });
  };

const withV1Auth =
  (handler: AuthenticatedRouteCallback): RouteCallback =>
  async ({ request, params }) => {
    startTiming("auth");

    const authHeader = request.headers.get("authorization");

    if (authHeader?.startsWith("Bearer ") && isKeeperMcpEnabledAuth(auth)) {
      const mcpSession = await auth.api.getMcpSession({ headers: request.headers });
      endTiming("auth");

      if (!mcpSession?.userId) {
        return ErrorResponse.unauthorized().toResponse();
      }

      await enrichWithUserContext(mcpSession.userId);
      return handler({ params, request, userId: mcpSession.userId });
    }

    const session = await getSession(request);
    endTiming("auth");

    if (!session?.user?.id) {
      return ErrorResponse.unauthorized().toResponse();
    }

    await enrichWithUserContext(session.user.id);
    return handler({ params, request, userId: session.user.id });
  };

export { withAuth, withV1Auth, withWideEvent };
export type { RouteHandler };
