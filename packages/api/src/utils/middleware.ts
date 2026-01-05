import type { MaybePromise } from "bun";
import { WideEvent, emitWideEvent, getWideEvent, runWithWideEvent } from "@keeper.sh/log";
import type { WideEventFields } from "@keeper.sh/log";
import { ErrorResponse } from "./responses";
import { calendarDestinationsTable, remoteICalSourcesTable } from "@keeper.sh/database/schema";
import { count, eq } from "drizzle-orm";
import { auth, database, premiumService } from "../context";

const HTTP_ERROR_THRESHOLD = 400;
const HTTP_INTERNAL_SERVER_ERROR = 500;
const DEFAULT_COUNT = 0;

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

const extractHttpContext = (request: Request): Partial<WideEventFields> => {
  const url = new URL(request.url);
  return {
    httpMethod: request.method,
    httpOrigin: request.headers.get("origin") ?? null,
    httpPath: url.pathname,
    httpUserAgent: request.headers.get("user-agent") ?? null,
    operationName: `${request.method} ${url.pathname}`,
    operationType: "http",
  };
};

const handleResponseStatus = (event: WideEvent, status: number): void => {
  event.set({ httpStatusCode: status });
  if (status >= HTTP_ERROR_THRESHOLD) {
    event.set({
      error: true,
      errorMessage: `HTTP ${status}`,
      errorType: "HttpError",
    });
  }
};

const fetchUserPlan = async (userId: string): Promise<"free" | "pro" | null> => {
  try {
    return await premiumService.getUserPlan(userId);
  } catch (error) {
    getWideEvent()?.setError(error);
    return null;
  }
};

const fetchUserCounts = async (
  userId: string,
): Promise<{ sourceCount: number; destinationCount: number } | null> => {
  try {
    const [sources] = await database
      .select({ count: count() })
      .from(remoteICalSourcesTable)
      .where(eq(remoteICalSourcesTable.userId, userId));
    const [destinations] = await database
      .select({ count: count() })
      .from(calendarDestinationsTable)
      .where(eq(calendarDestinationsTable.userId, userId));
    return {
      destinationCount: destinations?.count ?? DEFAULT_COUNT,
      sourceCount: sources?.count ?? DEFAULT_COUNT,
    };
  } catch (error) {
    getWideEvent()?.setError(error);
    return null;
  }
};

const enrichWithUserContext = async (userId: string): Promise<void> => {
  const event = getWideEvent();
  if (!event) {
    return;
  }

  event.set({ userId });

  const [plan, counts] = await Promise.all([fetchUserPlan(userId), fetchUserCounts(userId)]);

  if (plan) {
    event.set({ subscriptionPlan: plan });
  }
  if (counts) {
    event.set(counts);
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
    const event = new WideEvent("api");
    event.set(extractHttpContext(request));

    return runWithWideEvent(event, async () => {
      try {
        const response = await handler({ params, request });
        handleResponseStatus(event, response.status);
        return response;
      } catch (error) {
        event.setError(error);
        event.set({ httpStatusCode: HTTP_INTERNAL_SERVER_ERROR });
        throw error;
      } finally {
        emitWideEvent(event.finalize());
      }
    });
  };

const withAuth =
  (handler: AuthenticatedRouteCallback): RouteCallback =>
  async ({ request, params }) => {
    const event = getWideEvent();
    event?.startTiming("auth");
    const session = await getSession(request);
    event?.endTiming("auth");

    if (!session?.user?.id) {
      return ErrorResponse.unauthorized().toResponse();
    }

    await enrichWithUserContext(session.user.id);
    return handler({ params, request, userId: session.user.id });
  };

const withTracing = withWideEvent;

export { withWideEvent, withAuth, withTracing };
export type { RouteHandler };
