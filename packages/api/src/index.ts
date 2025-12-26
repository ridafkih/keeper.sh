import { createSourceSchema } from "@keeper.sh/data-schemas";
import { generateIcsCalendar, type IcsCalendar, type IcsEvent } from "ts-ics";
import { auth } from "@keeper.sh/auth";
import { database } from "@keeper.sh/database";
import env from "@keeper.sh/env/auth";
import {
  remoteICalSourcesTable,
  eventStatesTable,
  syncStatusTable,
} from "@keeper.sh/database/schema";
import { user as userTable } from "@keeper.sh/database";
import { pullRemoteCalendar, fetchAndSyncSource } from "@keeper.sh/calendar";
import { canAddSource } from "@keeper.sh/premium";
import { syncDestinationsForUser } from "@keeper.sh/integrations";
import "@keeper.sh/integration-google-calendar";
import { log } from "@keeper.sh/log";
import {
  createWebsocketHandler,
  startSubscriber,
  type BroadcastData,
  type Socket,
} from "@keeper.sh/broadcast";
import { BunRequest } from "bun";
import { eq, and, inArray, gte, lte, asc } from "drizzle-orm";
import { socketTokens } from "./state";
import {
  getAuthorizationUrl,
  exchangeCodeForTokens,
  fetchUserInfo,
  saveCalendarDestination,
  listCalendarDestinations,
  deleteCalendarDestination,
  validateState,
} from "./destinations";

const TOKEN_TTL = 30_000;

const generateSocketToken = (userId: string): string => {
  const token = crypto.randomUUID();
  const timeout = setTimeout(() => socketTokens.delete(token), TOKEN_TTL);
  socketTokens.set(token, { userId, timeout });
  return token;
};

const validateSocketToken = (token: string): string | null => {
  const entry = socketTokens.get(token);
  if (!entry) return null;
  clearTimeout(entry.timeout);
  socketTokens.delete(token);
  return entry.userId;
};

const sendInitialSyncStatus = async (userId: string, socket: Socket) => {
  const statuses = await database
    .select()
    .from(syncStatusTable)
    .where(eq(syncStatusTable.userId, userId));

  for (const status of statuses) {
    socket.send(
      JSON.stringify({
        event: "sync:status",
        data: {
          provider: status.provider,
          status: "idle",
          localEventCount: status.localEventCount,
          remoteEventCount: status.remoteEventCount,
          lastSyncedAt: status.lastSyncedAt?.toISOString(),
          inSync: status.localEventCount === status.remoteEventCount,
        },
      }),
    );
  }
};

type BunRouteCallback = (request: BunRequest<string>) => Promise<Response>;

const withTracing = (callback: BunRouteCallback): BunRouteCallback => {
  return async (request) => {
    const url = request.url;
    log.trace("request to %s started", url);
    const result = await callback(request);
    log.trace("request to %s complete", url);
    return result;
  };
};

const getSession = async (request: Request) => {
  const session = await auth.api.getSession({
    headers: request.headers,
  });
  return session;
};

const withAuth = (
  callback: (request: BunRequest<string>, userId: string) => Promise<Response>,
): BunRouteCallback => {
  return async (request) => {
    const session = await getSession(request);
    if (!session?.user?.id) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    return callback(request, session.user.id);
  };
};

const websocketHandler = createWebsocketHandler({
  onConnect: sendInitialSyncStatus,
});

const server = Bun.serve<BroadcastData>({
  port: 3000,
  websocket: websocketHandler,
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname !== "/socket") {
      return undefined;
    }

    const token = url.searchParams.get("token");
    const userId = token ? validateSocketToken(token) : null;

    if (!userId) {
      log.debug("socket upgrade unauthorized - invalid or missing token");
      return new Response("Unauthorized", { status: 401 });
    }

    log.debug({ userId }, "socket upgrade authorized");

    const upgraded = server.upgrade(request, {
      data: { userId },
    });

    if (!upgraded) {
      return new Response("WebSocket upgrade failed", { status: 500 });
    }

    return undefined;
  },
  routes: {
    "/api/ics": {
      GET: withTracing(
        withAuth(async (_request, userId) => {
          const sources = await database
            .select()
            .from(remoteICalSourcesTable)
            .where(eq(remoteICalSourcesTable.userId, userId));

          return Response.json(sources);
        }),
      ),
      POST: withTracing(
        withAuth(async (request, userId) => {
          const body = await request.json();

          if (!createSourceSchema.allows(body)) {
            return Response.json(
              { error: "Name and URL are required" },
              { status: 400 },
            );
          }

          const { name, url } = body;

          const existingSources = await database
            .select({ id: remoteICalSourcesTable.id })
            .from(remoteICalSourcesTable)
            .where(eq(remoteICalSourcesTable.userId, userId));

          const allowed = await canAddSource(userId, existingSources.length);
          if (!allowed) {
            return Response.json(
              {
                error:
                  "Source limit reached. Upgrade to Pro for unlimited sources.",
              },
              { status: 402 },
            );
          }

          try {
            await pullRemoteCalendar("json", url);
          } catch {
            return Response.json(
              { error: "URL does not return a valid iCal file" },
              { status: 400 },
            );
          }

          const [source] = await database
            .insert(remoteICalSourcesTable)
            .values({ userId, name, url })
            .returning();

          if (!source) {
            throw new Error("Failed to create source");
          }

          fetchAndSyncSource(source)
            .then(() => syncDestinationsForUser(userId))
            .catch((error) => {
              log.error(error, "failed initial sync for source '%s'", source.id);
            });

          return Response.json(source, { status: 201 });
        }),
      ),
    },
    "/api/ics/:id": {
      DELETE: withTracing(
        withAuth(async (request, userId) => {
          const { id } = request.params;

          if (!id) {
            return Response.json({ error: "ID is required" }, { status: 400 });
          }

          const [deleted] = await database
            .delete(remoteICalSourcesTable)
            .where(
              and(
                eq(remoteICalSourcesTable.id, id),
                eq(remoteICalSourcesTable.userId, userId),
              ),
            )
            .returning();

          if (!deleted) {
            return Response.json({ error: "Not found" }, { status: 404 });
          }

          syncDestinationsForUser(userId).catch((error) => {
            log.error(
              error,
              "failed to sync destinations after source deletion",
            );
          });

          return Response.json({ success: true });
        }),
      ),
    },
    "/api/events": {
      GET: withTracing(
        withAuth(async (request, userId) => {
          const url = new URL(request.url);
          const fromParam = url.searchParams.get("from");
          const toParam = url.searchParams.get("to");

          log.debug(
            { fromParam, toParam, url: request.url },
            "events query params",
          );

          const now = new Date();
          const fromDate = fromParam ? new Date(fromParam) : now;
          const toDate = toParam
            ? new Date(toParam)
            : new Date(fromDate.getTime() + 7 * 24 * 60 * 60 * 1000);

          const fromNormalized = new Date(fromDate);
          fromNormalized.setHours(0, 0, 0, 0);

          const toNormalized = new Date(toDate);
          toNormalized.setHours(23, 59, 59, 999);

          log.debug({ from: fromNormalized, to: toNormalized }, "date range");

          const sources = await database
            .select({
              id: remoteICalSourcesTable.id,
              name: remoteICalSourcesTable.name,
              url: remoteICalSourcesTable.url,
            })
            .from(remoteICalSourcesTable)
            .where(eq(remoteICalSourcesTable.userId, userId));

          if (sources.length === 0) {
            return Response.json([]);
          }

          const sourceIds = sources.map((source) => source.id);
          const sourceMap = new Map(
            sources.map((source) => [
              source.id,
              { name: source.name, url: source.url },
            ]),
          );

          const events = await database
            .select({
              id: eventStatesTable.id,
              sourceId: eventStatesTable.sourceId,
              startTime: eventStatesTable.startTime,
              endTime: eventStatesTable.endTime,
            })
            .from(eventStatesTable)
            .where(
              and(
                inArray(eventStatesTable.sourceId, sourceIds),
                gte(eventStatesTable.startTime, fromNormalized),
                lte(eventStatesTable.startTime, toNormalized),
              ),
            )
            .orderBy(asc(eventStatesTable.startTime));

          const result = events.map((event) => {
            const source = sourceMap.get(event.sourceId);
            return {
              id: event.id,
              startTime: event.startTime,
              endTime: event.endTime,
              calendarId: event.sourceId,
              sourceName: source?.name,
              sourceUrl: source?.url,
            };
          });

          return Response.json(result);
        }),
      ),
    },
    "/api/sync/status": {
      GET: withTracing(
        withAuth(async (_request, userId) => {
          const statuses = await database
            .select()
            .from(syncStatusTable)
            .where(eq(syncStatusTable.userId, userId));

          const providers = statuses.map((status) => ({
            provider: status.provider,
            localEventCount: status.localEventCount,
            remoteEventCount: status.remoteEventCount,
            lastSyncedAt: status.lastSyncedAt,
            inSync: status.localEventCount === status.remoteEventCount,
          }));

          return Response.json({ providers });
        }),
      ),
    },
    "/api/socket/token": {
      GET: withTracing(
        withAuth(async (_request, userId) => {
          const token = generateSocketToken(userId);
          return Response.json({ token });
        }),
      ),
    },
    "/api/ical/token": {
      GET: withTracing(
        withAuth(async (_request, userId) => {
          const [userData] = await database
            .select({ username: userTable.username })
            .from(userTable)
            .where(eq(userTable.id, userId))
            .limit(1);

          const identifier = userData?.username ?? userId;
          return Response.json({ token: identifier });
        }),
      ),
    },
    "/api/destinations": {
      GET: withTracing(
        withAuth(async (_request, userId) => {
          const destinations = await listCalendarDestinations(userId);
          return Response.json(destinations);
        }),
      ),
    },
    "/api/destinations/authorize": {
      GET: withTracing(
        withAuth(async (request, userId) => {
          const url = new URL(request.url);
          const provider = url.searchParams.get("provider");

          if (provider !== "google") {
            return Response.json(
              { error: "Unsupported provider" },
              { status: 400 },
            );
          }

          const callbackUrl = new URL(
            `/api/destinations/callback/${provider}`,
            env.BETTER_AUTH_URL,
          );
          const authUrl = getAuthorizationUrl(userId, {
            callbackUrl: callbackUrl.toString(),
          });

          return Response.redirect(authUrl);
        }),
      ),
    },
    "/api/destinations/callback/:provider": {
      GET: withTracing(async (request) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const error = url.searchParams.get("error");

        const successUrl = new URL("/dashboard/integrations", env.BETTER_AUTH_URL);
        successUrl.searchParams.set("destination", "connected");

        const errorUrl = new URL("/dashboard/integrations", env.BETTER_AUTH_URL);
        errorUrl.searchParams.set("destination", "error");

        if (error) {
          log.warn({ error }, "OAuth error returned from provider");
          return Response.redirect(errorUrl.toString());
        }

        if (!code || !state) {
          log.warn("Missing code or state in callback");
          return Response.redirect(errorUrl.toString());
        }

        const userId = validateState(state);
        if (!userId) {
          log.warn("Invalid or expired state");
          return Response.redirect(errorUrl.toString());
        }

        try {
          const callbackUrl = new URL(
            "/api/destinations/callback",
            env.BETTER_AUTH_URL,
          );
          const tokens = await exchangeCodeForTokens(code, callbackUrl.toString());

          if (!tokens.refresh_token) {
            log.error("No refresh token in response");
            return Response.redirect(errorUrl.toString());
          }

          const userInfo = await fetchUserInfo(tokens.access_token);
          const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

          await saveCalendarDestination(
            userId,
            "google",
            userInfo.id,
            userInfo.email,
            tokens.access_token,
            tokens.refresh_token,
            expiresAt,
          );

          log.info({ userId, provider: "google" }, "calendar destination connected");

          syncDestinationsForUser(userId).catch((err) => {
            log.error(err, "failed to sync after destination connection");
          });

          return Response.redirect(successUrl.toString());
        } catch (err) {
          log.error(err, "failed to complete OAuth callback");
          return Response.redirect(errorUrl.toString());
        }
      }),
    },
    "/api/destinations/:provider": {
      DELETE: withTracing(
        withAuth(async (request, userId) => {
          const { provider } = request.params;

          if (!provider) {
            return Response.json(
              { error: "Provider is required" },
              { status: 400 },
            );
          }

          const deleted = await deleteCalendarDestination(userId, provider);

          if (!deleted) {
            return Response.json({ error: "Not found" }, { status: 404 });
          }

          return Response.json({ success: true });
        }),
      ),
    },
    "/cal/:identifier": {
      GET: withTracing(async (request) => {
        const { identifier } = request.params;

        if (!identifier?.endsWith(".ics")) {
          return new Response("Not found", { status: 404 });
        }

        const cleanIdentifier = identifier.slice(0, -4);

        const [userByUsername] = await database
          .select({ id: userTable.id })
          .from(userTable)
          .where(eq(userTable.username, cleanIdentifier))
          .limit(1);

        const [userById] = userByUsername
          ? []
          : await database
              .select({ id: userTable.id })
              .from(userTable)
              .where(eq(userTable.id, cleanIdentifier))
              .limit(1);

        const userId = userByUsername?.id ?? userById?.id;

        if (!userId) {
          return new Response("Not found", { status: 404 });
        }

        const sources = await database
          .select({ id: remoteICalSourcesTable.id })
          .from(remoteICalSourcesTable)
          .where(eq(remoteICalSourcesTable.userId, userId));

        if (sources.length === 0) {
          return new Response(formatIcal([]), {
            headers: { "Content-Type": "text/calendar; charset=utf-8" },
          });
        }

        const sourceIds = sources.map((s) => s.id);
        const events = await database
          .select()
          .from(eventStatesTable)
          .where(inArray(eventStatesTable.sourceId, sourceIds))
          .orderBy(asc(eventStatesTable.startTime));

        return new Response(formatIcal(events), {
          headers: { "Content-Type": "text/calendar; charset=utf-8" },
        });
      }),
    },
  },
});

interface CalendarEvent {
  id: string;
  startTime: Date;
  endTime: Date;
}

const formatIcal = (events: CalendarEvent[]): string => {
  const icsEvents: IcsEvent[] = events.map((event) => ({
    uid: `${event.id}@keeper.sh`,
    stamp: { date: new Date() },
    start: { date: event.startTime },
    end: { date: event.endTime },
    summary: "Busy",
  }));

  const calendar: IcsCalendar = {
    version: "2.0",
    prodId: "-//Keeper//Keeper Calendar//EN",
    events: icsEvents,
  };

  return generateIcsCalendar(calendar);
};

startSubscriber();

log.info({ port: server.port }, "server started");
