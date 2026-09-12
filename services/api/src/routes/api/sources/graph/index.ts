import { withAuth, withWideEvent } from "@/utils/middleware";
import { withAuthorizedGraphSession, removeGraphSession } from "@/utils/graph-oauth-session";
import { importOAuthAccountCalendars } from "@/utils/oauth-sources";
import { createSafeFetch } from "@keeper.sh/calendar/safe-fetch";
import { safeFetchOptions } from "@/utils/safe-fetch-options";
import { database } from "@/context";
import { calendarAccountsTable, oauthCredentialsTable } from "@keeper.sh/database/schema";
import { and, eq } from "drizzle-orm";

const POST = withWideEvent(withAuth(async ({ userId, request }) => {
  try {
    const body = await request.json() as { sessionId?: unknown; accountId?: unknown };
    if (typeof body.sessionId !== "string") { throw new TypeError("Session required"); }
    const {sessionId} = body;
    const result = await withAuthorizedGraphSession(userId, sessionId, async (session) => {
      const {auth} = session.config;
      if (!auth.accessToken || !auth.refreshToken || !auth.expiresAt) { throw new Error("Missing tokens"); }
      const fetcher = createSafeFetch({ ...safeFetchOptions, timeoutMs: 15_000 });
      const response = await fetcher("https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName", {
        headers: { Authorization: `Bearer ${auth.accessToken}` }, redirect: "manual",
      });
      if (!response.ok) { throw new Error("Unable to identify Microsoft account"); }
      const info = await response.json() as { id?: unknown; mail?: unknown; userPrincipalName?: unknown };
      const email = info.mail || info.userPrincipalName;
      if (typeof info.id !== "string" || typeof email !== "string" || !email) { throw new Error("Invalid account identity"); }
      if (body.accountId) {
        if (typeof body.accountId !== "string") { throw new TypeError("Invalid account"); }
        const [account] = await database.select().from(calendarAccountsTable).where(and(
          eq(calendarAccountsTable.id, body.accountId), eq(calendarAccountsTable.userId, userId),
        )).limit(1);
        if (!account || account.provider !== "outlook" || account.accountId !== info.id) { throw new Error("Sign in with the original Microsoft account"); }
      }
      const accountId = await importOAuthAccountCalendars({
        accessToken: auth.accessToken, email,
        provider: "outlook", providerAccountId: info.id, userId,
      }, {
        provider: "outlook", email, accessToken: auth.accessToken,
        refreshToken: auth.refreshToken, expiresAt: new Date(auth.expiresAt),
        microsoftClientId: session.connection.clientId, microsoftTenant: session.connection.tenant,
        microsoftScope: session.config.auth.scope,
      });
      return { accountId };
    });
    await removeGraphSession(userId, sessionId);
    return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Graph connection failed. Check permissions and sign in with the intended account." }, {
      status: 400, headers: { "Cache-Control": "no-store" },
    });
  }
}));
const GET = withWideEvent(withAuth(async ({ userId, request }) => {
  const accountId = new URL(request.url).searchParams.get("accountId");
  if (!accountId) { return Response.json({ error: "Account required" }, { status: 400 }); }
  const [config] = await database.select({
    clientId: oauthCredentialsTable.microsoftClientId, tenant: oauthCredentialsTable.microsoftTenant, scope: oauthCredentialsTable.microsoftScope,
  }).from(calendarAccountsTable).innerJoin(oauthCredentialsTable,
    eq(calendarAccountsTable.oauthCredentialId, oauthCredentialsTable.id),
  ).where(and(eq(calendarAccountsTable.id, accountId), eq(calendarAccountsTable.userId, userId), eq(calendarAccountsTable.provider, "outlook"))).limit(1);
  return Response.json(config ?? {}, { headers: { "Cache-Control": "no-store" } });
}));
export { GET, POST };
