import {
  log,
  WideEvent,
  runWithWideEvent,
  emitWideEvent,
  getWideEvent,
  type WideEventFields,
} from "@keeper.sh/log";
import {
  remoteICalSourcesTable,
  calendarDestinationsTable,
} from "@keeper.sh/database/schema";
import { eq, count } from "drizzle-orm";
import { auth, database, premiumService } from "../context";

interface RouteContext {
  request: Request;
  params: Record<string, string>;
}

interface AuthenticatedRouteContext extends RouteContext {
  userId: string;
}

export type RouteHandler = (
  request: Request,
  params: Record<string, string>
) => Promise<Response>;

type RouteCallback = (ctx: RouteContext) => Promise<Response>;
type AuthenticatedRouteCallback = (
  ctx: AuthenticatedRouteContext
) => Promise<Response>;

const extractHttpContext = (request: Request): Partial<WideEventFields> => {
  const url = new URL(request.url);
  return {
    operationType: "http",
    operationName: `${request.method} ${url.pathname}`,
    httpMethod: request.method,
    httpPath: url.pathname,
    httpUserAgent: request.headers.get("user-agent") ?? undefined,
    httpOrigin: request.headers.get("origin") ?? undefined,
  };
};

const handleResponseStatus = (event: WideEvent, status: number): void => {
  event.set({ httpStatusCode: status });
  if (status >= 400) {
    event.set({
      error: true,
      errorType: "HttpError",
      errorMessage: `HTTP ${status}`,
    });
  }
};

const fetchUserPlan = async (
  userId: string
): Promise<"free" | "pro" | undefined> => {
  try {
    return await premiumService.getUserPlan(userId);
  } catch {
    return undefined;
  }
};

const fetchUserCounts = async (
  userId: string
): Promise<{ sourceCount: number; destinationCount: number } | undefined> => {
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
      sourceCount: sources?.count ?? 0,
      destinationCount: destinations?.count ?? 0,
    };
  } catch {
    return undefined;
  }
};

const enrichWithUserContext = async (userId: string): Promise<void> => {
  const event = getWideEvent();
  if (!event) return;

  event.set({ userId });

  const [plan, counts] = await Promise.all([
    fetchUserPlan(userId),
    fetchUserCounts(userId),
  ]);

  if (plan) event.set({ subscriptionPlan: plan });
  if (counts) event.set(counts);
};

const getSession = async (request: Request) => {
  const session = await auth.api.getSession({
    headers: request.headers,
  });
  return session;
};

export const withWideEvent = (handler: RouteCallback): RouteHandler =>
  async (request, params) => {
    const event = new WideEvent("api");
    event.set(extractHttpContext(request));

    return runWithWideEvent(event, async () => {
      try {
        const response = await handler({ request, params });
        handleResponseStatus(event, response.status);
        return response;
      } catch (error) {
        event.setError(error);
        event.set({ httpStatusCode: 500 });
        throw error;
      } finally {
        emitWideEvent(event.finalize());
      }
    });
  };

export const withAuth = (
  handler: AuthenticatedRouteCallback
): RouteCallback =>
  async ({ request, params }) => {
    const event = getWideEvent();
    event?.startTiming("auth");
    const session = await getSession(request);
    event?.endTiming("auth");

    if (!session?.user?.id) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    await enrichWithUserContext(session.user.id);
    return handler({ request, params, userId: session.user.id });
  };

export const withTracing = withWideEvent;
