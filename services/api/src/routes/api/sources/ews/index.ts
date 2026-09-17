import {
  EwsClient,
  ewsConnectionIdentity,
  type EwsConfig,
  type EwsRuntimeOptions,
} from "@keeper.sh/calendar/ews";
import {
  calendarAccountsTable,
  calendarsTable,
  ewsCredentialsTable,
} from "@keeper.sh/database/schema";
import { encryptPassword } from "@keeper.sh/database";
import { and, count, eq, sql } from "drizzle-orm";
import { database, encryptionKey, premiumService } from "@/context";
import { withAuth, withWideEvent } from "@/utils/middleware";
import { ErrorResponse } from "@/utils/responses";
import { resolveEwsRequest, removeEwsSession } from "@/utils/ews-oauth-session";
import {
  createSourceCalendarInsertDependencies,
  insertSourceCalendars,
} from "@/utils/source-calendar-insert";

const POST = withWideEvent(
  withAuth(async ({ request, userId }) => {
    if (!encryptionKey) {
      return ErrorResponse.internal(
        "Encryption is not configured",
      ).toResponse();
    }
    let body: {
      config?: unknown;
      sessionId?: unknown;
      name?: unknown;
      calendarIds?: unknown;
      accountId?: unknown;
    } = { config: null };
    let config: EwsConfig | null = null;
    let runtime: EwsRuntimeOptions = {};
    try {
      body = (await request.json()) as typeof body;
      ({ config, runtime } = await resolveEwsRequest(userId, body));
    } catch {
      return ErrorResponse.badRequest(
        "Invalid EWS connection settings",
      ).toResponse();
    }
    if (!config) {
      return ErrorResponse.badRequest("Missing configuration").toResponse();
    }
    const connection = config;
    const identity = ewsConnectionIdentity(connection);
    try {
      const discovered = await new EwsClient(
        config,
        runtime,
      ).discoverCalendars();
      if (
        !Array.isArray(body.calendarIds) ||
        body.calendarIds.length === 0 ||
        body.calendarIds.some((id) => typeof id !== "string")
      ) {
        return ErrorResponse.badRequest(
          "Select at least one calendar",
        ).toResponse();
      }
      const ids = new Set(body.calendarIds);
      const selected = discovered.filter(({ id }) => ids.has(id));
      if (
        selected.length !== ids.size ||
        selected.some((folder) => !folder.canRead)
      ) {
        return ErrorResponse.badRequest(
          "Selected calendars are unavailable or unreadable",
        ).toResponse();
      }
      if (
        typeof body.name !== "string" ||
        !body.name.trim() ||
        body.name.length > 200
      ) {
        return ErrorResponse.badRequest(
          "A connection name is required",
        ).toResponse();
      }
      const name = body.name.trim();
      const plan = await premiumService.getUserPlan(userId);
      if (!plan) {
        return ErrorResponse.internal(
          "Unable to resolve account allowance",
        ).toResponse();
      }
      const key = encryptionKey;
      const accountId = await database.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(9002, hashtext(${userId}))`,
        );
        if (body.accountId) {
          if (typeof body.accountId !== "string") {
            throw new TypeError("Invalid account");
          }
          const [existing] = await tx
            .select()
            .from(calendarAccountsTable)
            .where(
              and(
                eq(calendarAccountsTable.id, body.accountId),
                eq(calendarAccountsTable.userId, userId),
                eq(calendarAccountsTable.provider, "ews"),
              ),
            )
            .limit(1);
          if (!existing || existing.accountId !== identity) {
            throw new Error("Account unavailable");
          }
          // Existing folder IDs must remain valid: changing the server/mailbox is a new connection.
          const stored = await tx
            .select({ id: calendarsTable.externalCalendarId })
            .from(calendarsTable)
            .where(eq(calendarsTable.accountId, existing.id));
          if (
            stored.some(
              (folder) => !discovered.some((found) => found.id === folder.id),
            )
          ) {
            throw new Error("Existing calendars unavailable");
          }
          await tx
            .update(ewsCredentialsTable)
            .set({
              encryptedConfig: encryptPassword(JSON.stringify(connection), key),
            })
            .where(eq(ewsCredentialsTable.accountId, existing.id));
          await tx
            .update(calendarAccountsTable)
            .set({
              displayName: name,
              email: connection.mailbox ?? connection.impersonate ?? null,
              needsReauthentication: false,
              reauthenticationSource: null,
            })
            .where(eq(calendarAccountsTable.id, existing.id));
          return existing.id;
        }
        const [total] = await tx
          .select({ value: count() })
          .from(calendarAccountsTable)
          .where(eq(calendarAccountsTable.userId, userId));
        if ((total?.value ?? 0) >= premiumService.getAccountLimit(plan)) {
          throw new Error("Account limit reached");
        }
        const [account] = await tx
          .insert(calendarAccountsTable)
          .values({
            authType: "ews",
            accountId: identity,
            provider: "ews",
            userId,
            displayName: name,
              email: connection.mailbox ?? connection.impersonate ?? null,
          })
          .returning();
        if (!account) {
          throw new Error("Account creation failed");
        }
        await tx.insert(ewsCredentialsTable).values({
          accountId: account.id,
          encryptedConfig: encryptPassword(JSON.stringify(connection), key),
        });
        await insertSourceCalendars(
          createSourceCalendarInsertDependencies(tx),
          userId,
          selected.map((folder) => ({
            accountId: account.id,
            calendarType: "ews",
            externalCalendarId: folder.id,
            name: folder.name,
            originalName: folder.name,
            userId,
            capabilities: ["pull", ...((folder.canWrite && ["push"]) || [])],
          })),
        );
        return account.id;
      });
      await removeEwsSession(userId, body.sessionId);
      return Response.json({ accountId }, { status: 201 });
    } catch {
      // Never return provider bodies, SQL errors, passwords, or access tokens.
      return ErrorResponse.badRequest(
        "EWS connection could not be saved. Check access, selected calendars and account allowance.",
      ).toResponse();
    }
  }),
);
export { POST };
