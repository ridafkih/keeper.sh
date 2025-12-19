import { auth } from "@keeper.sh/auth";
import { database } from "@keeper.sh/database";
import {
  calendarSnapshotsTable,
  remoteICalSourcesTable,
  eventStatesTable,
} from "@keeper.sh/database/schema";
import { pullRemoteCalendar } from "@keeper.sh/pull-calendar";
import { log } from "@keeper.sh/log";
import { BunRequest } from "bun";
import { eq, and, inArray } from "drizzle-orm";

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

const server = Bun.serve({
  port: 3000,
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
          const { name, url } = body as { name?: string; url?: string };

          if (!url || !name) {
            return Response.json(
              { error: "Name and URL are required" },
              { status: 400 },
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

          return Response.json({ success: true });
        }),
      ),
    },
    "/api/events": {
      GET: withTracing(
        withAuth(async (_request, userId) => {
          const sources = await database
            .select({
              id: remoteICalSourcesTable.id,
              name: remoteICalSourcesTable.name,
            })
            .from(remoteICalSourcesTable)
            .where(eq(remoteICalSourcesTable.userId, userId));

          if (sources.length === 0) {
            return Response.json([]);
          }

          const sourceIds = sources.map((source) => source.id);
          const sourceMap = new Map(
            sources.map((source) => [source.id, source.name]),
          );

          const events = await database
            .select({
              id: eventStatesTable.id,
              sourceId: eventStatesTable.sourceId,
              startTime: eventStatesTable.startTime,
              endTime: eventStatesTable.endTime,
            })
            .from(eventStatesTable)
            .where(inArray(eventStatesTable.sourceId, sourceIds));

          const result = events.map((event) => ({
            id: event.id,
            startTime: event.startTime,
            endTime: event.endTime,
            calendarId: event.sourceId,
            sourceName: sourceMap.get(event.sourceId),
          }));

          return Response.json(result);
        }),
      ),
    },
  },
});

log.info({ port: server.port }, "server started");
