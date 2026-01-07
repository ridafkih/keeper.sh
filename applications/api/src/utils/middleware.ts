import type { MaybePromise } from "bun";
import { WideEvent } from "@keeper.sh/log";
import { ErrorResponse } from "./responses";
import { calendarDestinationsTable, calendarSourcesTable } from "@keeper.sh/database/schema";
import { user as userTable } from "@keeper.sh/database/auth-schema";
import { count, eq } from "drizzle-orm";
import { auth, database, premiumService } from "../context";

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

const handleResponseStatus = (event: WideEvent, status: number): void => {
  event.set({ "http.status_code": status });
  if (status >= HTTP_ERROR_THRESHOLD) {
    event.set({
      "error.occurred": true,
      "error.message": `HTTP ${status}`,
      "error.type": "HttpError",
    });
  }
};

const fetchUserPlan = async (userId: string): Promise<"free" | "pro" | null> => {
  try {
    return await premiumService.getUserPlan(userId);
  } catch (error) {
    WideEvent.error(error);
    return null;
  }
};

const fetchUserCounts = async (
  userId: string,
): Promise<{ "source.count": number; "destination.count": number } | null> => {
  try {
    const [sources] = await database
      .select({ count: count() })
      .from(calendarSourcesTable)
      .where(eq(calendarSourcesTable.userId, userId));
    const [destinations] = await database
      .select({ count: count() })
      .from(calendarDestinationsTable)
      .where(eq(calendarDestinationsTable.userId, userId));
    return {
      "destination.count": destinations?.count ?? DEFAULT_COUNT,
      "source.count": sources?.count ?? DEFAULT_COUNT,
    };
  } catch (error) {
    WideEvent.error(error);
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
    WideEvent.error(error);
    return null;
  }
};

const enrichWithUserContext = async (userId: string): Promise<void> => {
  const event = WideEvent.grasp();
  if (!event) {
    return;
  }

  event.set({ "user.id": userId });

  const [plan, counts, accountAgeDays] = await Promise.all([
    fetchUserPlan(userId),
    fetchUserCounts(userId),
    fetchAccountAgeDays(userId),
  ]);

  if (plan) {
    event.set({ "subscription.plan": plan });
  }
  if (counts) {
    event.set(counts);
  }
  if (accountAgeDays !== null) {
    event.set({ "account.age_days": accountAgeDays });
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
  (request, params) => {
    const event = new WideEvent();
    event.set(extractHttpContext(request));

    return event.run(async () => {
      try {
        const response = await handler({ params, request });
        handleResponseStatus(event, response.status);
        return response;
      } catch (error) {
        event.addError(error);
        event.set({ "http.status_code": HTTP_INTERNAL_SERVER_ERROR });
        throw error;
      } finally {
        event.emit();
      }
    });
  };

const withAuth =
  (handler: AuthenticatedRouteCallback): RouteCallback =>
  async ({ request, params }) => {
    const event = WideEvent.grasp();
    event?.startTiming("auth");
    const session = await getSession(request);
    event?.endTiming("auth");

    if (!session?.user?.id) {
      return ErrorResponse.unauthorized().toResponse();
    }

    await enrichWithUserContext(session.user.id);
    return handler({ params, request, userId: session.user.id });
  };

export { withAuth, withWideEvent };
export type { RouteHandler };
